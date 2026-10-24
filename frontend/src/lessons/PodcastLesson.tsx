import { ButtonLabel } from '../lib/ButtonLabel.tsx';
// A podcast lesson: two voices talk about one topic, then a few questions. The audio is narrated the first time the
// lesson is opened; if that fails, the conversation can still be read.
import { useEffect, useRef, useState } from 'react';
import type { Answer, PodcastLesson as Lesson, PodcastManifest, PodcastStatus } from '@l45/shared';
import { ApiError, api } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';
import { LessonProgress, QuestionCard } from './LessonActivity.tsx';

const HOSTS = { a: 'Mira', b: 'Jonas' } as const;
const unavailable = 'Das Gespräch ist gerade nicht zu hören. Du kannst es unten lesen.';

export function PodcastLesson({ lesson, sessionId, nodeId, onComplete }: {
  lesson: Lesson;
  sessionId: string;
  nodeId: string;
  onComplete: (a: Answer) => Promise<void>;
}) {
  const [status, setStatus] = useState<PodcastStatus | null>(null);
  const [manifest, setManifest] = useState<PodcastManifest>();
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
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
    void el.play().catch(() => setFailed(true));
  };
  const timed = manifest?.lines;
  const current = timed ? timed.findLastIndex((l) => l.start <= now) : -1;

  const quiz = asking || failed;
  const transcript = <ol>{lesson.content.lines.map((line, i) => {
    const body = <><strong className={`host ${line.speaker}`}>{HOSTS[line.speaker]}</strong> {line.text}</>;
    const start = timed?.[i]?.start;
    return <li key={i} className={i === current ? 'current' : undefined} aria-current={i === current ? 'true' : undefined}>{start !== undefined ? <button onClick={() => seek(start)}>{body}</button> : <p>{body}</p>}</li>;
  })}</ol>;

  return <div className="podcast-lesson">
    <LessonProgress completed={Object.keys(answers).length} total={questions.length} label="Deine Wissens-Checks" detail={quiz ? `${Object.keys(answers).length} / ${questions.length} Checks` : 'Zuerst zuhören, dann ausprobieren'} />
    <div className={`podcast${quiz ? ' is-quizzing' : ''}`}>
      {!quiz && <p className="podcast-head"><Icon name="headphones" size={20} />{HOSTS.a} und {HOSTS.b} im Gespräch</p>}
      {failed ? <p className="small muted">{unavailable}</p> : !manifest ? <div role="status" className="podcast-progress"><p className="small">Das Gespräch wird vorbereitet{status?.state === 'building' && status.total ? ` (${status.completed} von ${status.total})` : ''} …</p><progress max={status?.state === 'building' ? status.total : undefined} value={status?.state === 'building' ? status.completed : undefined} /></div>
        : <audio ref={audio} controls preload="metadata" src={manifest.audioUrl} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} onEnded={() => setAsking(true)} onError={() => setFailed(true)} />}
      <details className="podcast-transcript"><summary><ButtonLabel variants={['Gespräch nachlesen', 'Gespräch mitlesen']}>{quiz ? 'Gespräch nachlesen' : 'Gespräch mitlesen'}</ButtonLabel></summary>{transcript}</details>
    </div>
    {quiz && questions.length > 0 ? <QuestionCard key={questionIndex} prompt={questions[questionIndex].prompt} options={questions[questionIndex].options} index={questionIndex} total={questions.length}
      check={(option) => ({ type: 'quiz', questionIndex, option })} continueLabel={questionIndex + 1 === questions.length ? 'Lektion abschliessen' : 'Nächste Frage'} onContinue={async (option) => {
        const next = { ...answers, [questionIndex]: option };
        setAnswers(next);
        if (questionIndex + 1 === questions.length) await onComplete({ type: 'podcast', answers: next });
        else setQuestionIndex(questionIndex + 1);
      }} /> : <div className="activity-actions"><button className="btn primary" onClick={() => { audio.current?.pause(); setAsking(true); }}>Zum Wissens-Check<Icon name="chevron" size={17} /></button></div>}
  </div>;
}
