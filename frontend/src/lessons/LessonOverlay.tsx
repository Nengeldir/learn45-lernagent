// A lesson opens over the topic. After finishing, feedback is shown here; the learner then chooses what comes next.
import { useEffect, useRef, useState } from 'react';
import type { Answer, Lesson, LessonResult } from '@l45/shared';
import { TYPE_LABEL } from '@l45/shared';
import { api } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { LessonSource } from '../map/NodePanel.tsx';
import { AiChat } from './AiChat.tsx';
import { MarkEvidence, MockSite } from './Checkable.tsx';
import { MissionCard } from './MissionCard.tsx';
import { Video } from './Video.tsx';

export function LessonOverlay({ nodeId, onClose }: { nodeId: string; onClose: (showNext: boolean) => void }) {
  const { view, setView } = useStore();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<LessonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const sessionId = view!.session.id;
  // The first time a track is opened, the mission question comes before the lesson.
  const trackId = view?.session.nodes.find((n) => n.id === nodeId)?.trackId;
  const missionTrack = view?.skills.flatMap((s) => s.tracks).find((t) => t.id === trackId);
  const needsMission = Boolean(missionTrack && !view?.workspace.missions.some((m) => m.trackId === trackId));
  const [askMission] = useState(needsMission);
  const [missionDone, setMissionDone] = useState(false);
  const ready = !askMission || missionDone;

  useEffect(() => {
    if (!ready) return;
    api.start(sessionId, nodeId).then((r) => {
      setLesson(r.lesson);
      setNotice(r.switched ?? null);
      setView(r.view);
      started.current = Date.now();
    }).catch((e) => setError(e.message));
  }, [sessionId, nodeId, setView, ready]);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onComplete = async (answer: Answer) => {
    try {
      const r = await api.complete(sessionId, nodeId, answer, (Date.now() - started.current) / 60000);
      setResult(r.result);
      setView(r.view, r.generated);
      ref.current?.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const track = view?.skills.flatMap((s) => s.tracks).find((t) => t.id === lesson?.trackId);
  const missed = result?.criteria.filter((c) => c.status === 'missed').map((c) => track?.criteria.find((x) => x.id === c.key)).filter(Boolean) ?? [];

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={lesson?.title ?? 'Lektion'}>
      <div className="overlay-panel" ref={ref} tabIndex={-1}>
        <header className="overlay-head">
          <div>
            {lesson && (
              <p className="meta">
                <span className="pill">{TYPE_LABEL[lesson.type]}</span>
                <span>etwa {lesson.durationMin} {lesson.durationMin === 1 ? 'Minute' : 'Minuten'}</span>
              </p>
            )}
            <h2>{lesson?.title ?? (ready ? 'Lektion wird geladen …' : missionTrack?.name)}</h2>
            {lesson && !result && <p>{lesson.intro}</p>}
            {lesson && !result && <LessonSource lesson={lesson} />}
          </div>
          <button className="btn quiet small" onClick={() => onClose(Boolean(result))}><Icon name="close" size={18} />Schliessen</button>
        </header>

        {error && <p className="error" role="alert">{error}</p>}
        {!ready && missionTrack && <MissionCard track={missionTrack} onDone={() => setMissionDone(true)} />}
        {notice && !result && <p className="note">{notice}</p>}

        {lesson && !result && (
          <div className="lesson-body">
            {lesson.type === 'mark-evidence' && <MarkEvidence lesson={lesson} sessionId={sessionId} nodeId={nodeId} onComplete={onComplete} />}
            {lesson.type === 'mock-site' && <MockSite lesson={lesson} sessionId={sessionId} nodeId={nodeId} onComplete={onComplete} />}
            {lesson.type === 'video' && <Video lesson={lesson} prepareUrl={`/api/sessions/${encodeURIComponent(sessionId)}/nodes/${encodeURIComponent(nodeId)}/video`} onComplete={onComplete} />}
            {lesson.type === 'ai-chat' && <AiChat lesson={lesson} sessionId={sessionId} nodeId={nodeId} onComplete={onComplete} />}
          </div>
        )}

        {result && lesson && (
          <div className="feedback" aria-live="polite">
            <div className={`result ${result.allMet ? 'ok' : 'gap'}`}>
              <h3>{result.allMet ? 'Geschafft!' : 'Noch nicht ganz. Das ist normal beim Lernen.'}</h3>
              <p>{result.summary}</p>
            </div>
            <ul className="items">
              {result.items.map((it, i) => (
                <li key={i} className={it.correct ? 'ok' : 'no'}>
                  {it.label && <strong>{it.label}</strong>}
                  <span>{it.text}</span>
                </li>
              ))}
            </ul>
            {missed.length > 0 && (
              <div className="note"><strong>Merke dir:</strong> {missed.map((m) => m!.ruleOfThumb).join(' ')}</div>
            )}
            {lesson.transfer && <div className="transfer"><strong>Im Alltag:</strong> {lesson.transfer}</div>}
            <div className="next-card">
              <p className="eyebrow next">Wie geht es weiter?</p>
              <h3>Du wählst, was du als Nächstes lernst.</h3>
              <button className="btn primary big" onClick={() => onClose(true)}><Icon name="play" size={20} />Weiter</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
