// A podcast lesson: two voices talk about one topic, then a few questions. The audio is narrated the first time the
// lesson is opened; if that fails, the conversation can still be read.
import { useEffect, useRef, useState } from 'react';
import type { Answer, PodcastLesson as Lesson, PodcastManifest, PodcastStatus } from '@l45/shared';
import { ApiError, api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Icon } from '../lib/icons.tsx';

const HOSTS = { a: 'Mira', b: 'Jonas' } as const;
const unavailable = 'Das Gespräch ist gerade nicht zu hören. Du kannst es unten lesen.';

export function PodcastLesson({ lesson, sessionId, nodeId, onComplete }: {
  lesson: Lesson;
  sessionId: string;
  nodeId: string;
  onComplete: (a: Answer) => Promise<void>;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<PodcastStatus | null>(null);
  const [manifest, setManifest] = useState<PodcastManifest>();
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const questions = lesson.content.questions;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (method: 'GET' | 'POST') => {
      let next: PodcastStatus;
      try {
        next = await api.podcast(sessionId, nodeId, method);
      } catch (e) {
        // A failed narration answers 503 with its status.
        if (e instanceof ApiError && e.body.state === 'error') next = e.body as unknown as PodcastStatus;
        else return void (active && setFailed(true));
      }
      if (!active) return;
      setStatus(next);
      if (next.state === 'building') timer = setTimeout(() => void check('GET'), 1500);
      if (next.state === 'error') setFailed(true);
      if (next.state === 'ready') {
        try {
          if (!/^\/podcasts\/[\w-]+\/manifest\.json$/.test(next.manifestUrl)) throw new Error(unavailable);
          const res = await fetch(next.manifestUrl);
          if (!res.ok) throw new Error(unavailable);
          const m = await res.json() as PodcastManifest;
          if (active) setManifest(m);
        } catch {
          if (active) setFailed(true);
        }
      }
    };
    void check('POST');
    return () => { active = false; clearTimeout(timer); };
  }, [sessionId, nodeId]);

  const seek = (start: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = start;
    void el.play();
  };
  const timed = manifest?.lines;
  const current = timed ? timed.findLastIndex((l) => l.start <= now) : -1;
  const ready = questions.every((_, i) => answers[i] !== undefined);

  return (
    <>
      <div className="podcast">
        <p className="podcast-head"><Icon name="headphones" size={20} />{t('{a} und {b} im Gespräch', { a: HOSTS.a, b: HOSTS.b })}</p>
        {failed ? (
          <p className="note small" role="alert">{t(unavailable)}</p>
        ) : !manifest ? (
          <div role="status" className="podcast-progress">
            <p className="small">{status?.state === 'building' && status.total ? t('Das Gespräch wird vorbereitet ({n} von {total}) …', { n: status.completed, total: status.total }) : t('Das Gespräch wird vorbereitet …')}</p>
            <progress max={status?.state === 'building' ? status.total : undefined} value={status?.state === 'building' ? status.completed : undefined} />
          </div>
        ) : (
          <audio ref={audio} controls preload="metadata" src={manifest.audioUrl} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} onEnded={() => setAsking(true)} />
        )}
        <details className="podcast-transcript" open={failed}>
          <summary>{t('Gespräch mitlesen')}</summary>
          <ol>
            {lesson.content.lines.map((line, i) => {
              const body = <><strong className={`host ${line.speaker}`}>{HOSTS[line.speaker]}</strong> {line.text}</>;
              const start = timed?.[i]?.start;
              return (
                <li key={i} className={i === current ? 'current' : undefined} aria-current={i === current ? 'true' : undefined}>
                  {start !== undefined ? <button onClick={() => seek(start)}>{body}</button> : <p>{body}</p>}
                </li>
              );
            })}
          </ol>
        </details>
      </div>

      {asking || failed ? (
        <div className="podcast-questions">
          <h3>{t('Fragen zum Gespräch')}</h3>
          {questions.map((q, i) => (
            <fieldset key={i} className="podcast-question">
              <legend>{q.prompt}</legend>
              <div className="choices">
                {q.options.map((o, k) => (
                  <button key={k} className="choice" aria-pressed={answers[i] === k} onClick={() => setAnswers({ ...answers, [i]: k })}>{o}</button>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="actions">
            {!ready && <span className="small muted">{t('Wähle bei jeder Frage eine Antwort.')}</span>}
            <button
              className="btn primary"
              disabled={busy || !ready}
              onClick={async () => {
                setBusy(true);
                try {
                  await onComplete({ type: 'podcast', answers });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('Fertig')}
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <span className="small muted">{t('Nach dem Gespräch kommen {n} kurze Fragen.', { n: questions.length })}</span>
          <button className="btn quiet" onClick={() => setAsking(true)}>{t('Direkt zu den Fragen')}</button>
        </div>
      )}
    </>
  );
}
