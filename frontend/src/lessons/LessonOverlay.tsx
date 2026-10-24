// A lesson opens over the map. After finishing, feedback and the agent's next step are shown here.
import { useEffect, useRef, useState } from 'react';
import type { Answer, Lesson, LessonResult } from '@l45/shared';
import { MODE_LABEL, SOURCE_LABEL, TYPE_LABEL } from '@l45/shared';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.tsx';
import { BasedOn, LessonSource, PlanStatus, planLabel } from '../map/NodePanel.tsx';
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
  const rec = view?.recommendation;
  const recNode = view?.session.nodes.find((n) => n.id === rec?.nodeId);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={lesson?.title ?? 'Lektion'}>
      <div className="overlay-panel" ref={ref} tabIndex={-1}>
        <header className="overlay-head">
          <div>
            {lesson && (
              <p className="meta">
                <span className="pill">{TYPE_LABEL[lesson.type]}</span>
                <span>{MODE_LABEL[lesson.mode]}</span>
                <span>{lesson.durationMin} Min.</span>
                <span>{track?.name}</span>
                <span>{lesson.level}</span>
              </p>
            )}
            <h2>{lesson?.title ?? (ready ? 'Lektion wird geladen …' : missionTrack?.name)}</h2>
            {lesson && !result && <p>{lesson.intro}</p>}
            {lesson && <LessonSource lesson={lesson} />}
          </div>
          <button className="btn quiet" onClick={() => onClose(Boolean(result))}>{result ? 'Zur Karte' : 'Schliessen'}</button>
        </header>

        {error && <p className="error" role="alert">{error}</p>}
        {!ready && missionTrack && <MissionCard track={missionTrack} onDone={() => setMissionDone(true)} />}
        {notice && !result && <p className="note">{notice}</p>}

        {lesson && !result && (
          <div className="lesson-body">
            {lesson.type === 'mark-evidence' && <MarkEvidence lesson={lesson} sessionId={sessionId} nodeId={nodeId} onComplete={onComplete} />}
            {lesson.type === 'mock-site' && <MockSite lesson={lesson} sessionId={sessionId} nodeId={nodeId} onComplete={onComplete} />}
            {lesson.type === 'video' && <Video lesson={lesson} onComplete={onComplete} />}
            {lesson.type === 'ai-chat' && <AiChat lesson={lesson} sessionId={sessionId} nodeId={nodeId} onComplete={onComplete} />}
          </div>
        )}

        {result && lesson && (
          <div className="feedback" aria-live="polite">
            <div className={`result ${result.allMet ? 'ok' : 'gap'}`}>
              <h3>{result.allMet ? 'Gelöst' : 'Noch nicht ganz'}</h3>
              <p>{result.summary}</p>
              <span className={`tag ${result.judgedBy === 'model' ? 'model' : result.judgedBy === 'keywords' ? 'prepared' : 'rule'}`}>
                Geprüft durch: {result.judgedBy === 'model' ? 'KI' : result.judgedBy === 'keywords' ? 'Stichwörter (ohne KI)' : 'Regel'}
              </span>
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
              <div className="note"><strong>Merksatz:</strong> {missed.map((m) => m!.ruleOfThumb).join(' ')}</div>
            )}
            {lesson.transfer && <div className="transfer"><strong>Für deine Arbeit:</strong> {lesson.transfer}</div>}
            {rec && view && (
              <div className="next-card">
                <p className="small muted">Der Agent passt deine Karte an</p>
                <PlanStatus view={view} />
                <h3>{recNode ? `Nächster Schritt: ${recNode.label}` : 'Für heute fertig'}</h3>
                <p>{rec.reason}</p>
                <p className="small">{rec.why}</p>
                {rec.basedOn?.length ? <div className="small"><strong>Gestützt auf:</strong><BasedOn rec={rec} view={view} /></div> : null}
                <p className="small muted">{rec.ruleId} {rec.ruleName}. {rec.tags.map((t) => SOURCE_LABEL[t]).join(', ')}. {planLabel(rec, view)}</p>
                <button className="btn primary" onClick={() => onClose(true)}>Auf der Karte ansehen</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
