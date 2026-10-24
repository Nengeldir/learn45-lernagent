// Podcast for one track: two hosts talk through its criteria and the learner's lessons. Made on request, then kept.
import { useEffect, useRef, useState } from 'react';
import type { PodcastLine, PodcastManifest, PodcastSpeaker, PodcastStatus, Track } from '@l45/shared';
import { ApiError, api } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const unavailable = 'Der Podcast ist gerade nicht erreichbar.';

/** Mount with key={track.id}: a new track starts from a clean state. */
export function Podcast({ sessionId, track }: { sessionId: string; track: Track }) {
  const [requested, setRequested] = useState(false);
  const [status, setStatus] = useState<PodcastStatus | null>(null);
  const [manifest, setManifest] = useState<PodcastManifest>();
  const [error, setError] = useState('');
  const [now, setNow] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (method: 'GET' | 'POST') => {
      let next: PodcastStatus;
      try {
        next = await api.podcast(sessionId, track.id, method);
      } catch (e) {
        // A failed narration answers 503 but still carries the script.
        if (e instanceof ApiError && e.body.state === 'error') next = e.body as unknown as PodcastStatus;
        else return void (active && setError(e instanceof Error ? e.message : unavailable));
      }
      if (!active) return;
      setStatus(next);
      if (next.state === 'building') timer = setTimeout(() => void check('GET'), 1500);
      if (next.state === 'ready') {
        try {
          if (!/^\/podcasts\/[\w-]+\/manifest\.json$/.test(next.manifestUrl)) throw new Error(unavailable);
          const res = await fetch(next.manifestUrl);
          if (!res.ok) throw new Error(unavailable);
          const m = await res.json() as PodcastManifest;
          if (active) setManifest(m);
        } catch {
          if (active) setError(unavailable);
        }
      }
    };
    void check(requested ? 'POST' : 'GET');
    return () => { active = false; clearTimeout(timer); };
  }, [sessionId, track.id, requested]);

  const seek = (start: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = start;
    void el.play();
  };

  return (
    <section className="podcast" aria-labelledby={`podcast-${track.id}`}>
      <h3 id={`podcast-${track.id}`} className="podcast-head"><Icon name="headphones" size={18} />Zum Anhören</h3>
      {error ? <p className="error small" role="alert">{error}</p>
        : !status ? <p className="small muted" role="status">Wird geladen …</p>
        : status.state === 'idle' ? (
          <>
            <p className="small">Zwei Stimmen erklären dir in etwa drei Minuten das Wichtigste zu diesem Thema. Wie ein kurzes Radiogespräch.</p>
            <button className="btn secondary block" onClick={() => setRequested(true)}><Icon name="headphones" size={16} />Podcast erstellen</button>
          </>
        ) : status.state === 'building' ? (
          <div role="status" className="podcast-progress">
            <p className="small">{status.step === 'script' ? 'Das Gespräch wird geschrieben …' : `Stimmen: ${status.completed} von ${status.total} Beiträgen fertig.`}</p>
            <progress max={status.step === 'script' ? undefined : status.total} value={status.step === 'script' ? undefined : status.completed} />
            <p className="small muted">Beim ersten Mal dauert das etwas. Danach ist der Podcast gespeichert.</p>
          </div>
        ) : status.state === 'error' ? (
          <>
            <p className="note small" role="alert">{status.message}</p>
            {status.script && <Transcript hosts={status.script.hosts} lines={status.script.lines} open />}
          </>
        ) : !manifest ? <p className="small muted" role="status">Wird geladen …</p> : (
          <>
            <audio ref={audio} controls preload="metadata" src={manifest.audioUrl} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
            <p className="small source-line">
              {manifest.scriptBy === 'model'
                ? <span className="tag model">Von der KI geschrieben</span>
                : <span className="tag prepared">Ohne KI zusammengestellt</span>}
              <span className="muted">{clock(manifest.duration)} Min., mit {manifest.hosts.a} und {manifest.hosts.b}</span>
            </p>
            <Transcript hosts={manifest.hosts} lines={manifest.lines} now={now} onSeek={seek} />
          </>
        )}
    </section>
  );
}

function Transcript({ hosts, lines, now, onSeek, open }: {
  hosts: Record<PodcastSpeaker, string>;
  /** start: seconds in the audio, when there is audio */
  lines: (PodcastLine & { start?: number })[];
  now?: number;
  onSeek?: (start: number) => void;
  open?: boolean;
}) {
  const current = now === undefined ? -1 : lines.findLastIndex((l) => (l.start ?? Infinity) <= now);
  return (
    <details className="podcast-transcript" open={open}>
      <summary>Gespräch lesen</summary>
      <ol>
        {lines.map((line, i) => {
          const body = <><strong className={`host ${line.speaker}`}>{hosts[line.speaker]}</strong> {line.text}</>;
          return (
            <li key={i} className={i === current ? 'current' : undefined} aria-current={i === current ? 'true' : undefined}>
              {onSeek && line.start !== undefined ? <button onClick={() => onSeek(line.start!)}>{body}</button> : <p>{body}</p>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
