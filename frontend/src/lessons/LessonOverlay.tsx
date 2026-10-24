// A lesson opens over the topic. After finishing, feedback is shown here; the learner then chooses what comes next.
import { useEffect, useRef, useState } from 'react';
import type { Answer, CompletionReward, Lesson, LessonResult } from '@l45/shared';
import { TYPE_LABEL, lessonXp } from '@l45/shared';
import { api } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { RewardCelebration } from '../rewards/Rewards.tsx';
import { LessonSource } from '../map/NodePanel.tsx';
import { AiChat } from './AiChat.tsx';
import { MarkEvidence, MockSite } from './Checkable.tsx';
import { LessonActivityProvider } from './LessonActivity.tsx';
import { PodcastLesson } from './PodcastLesson.tsx';
import { Video } from './Video.tsx';

export function LessonOverlay({ nodeId, onClose }: { nodeId: string; onClose: (showNext: boolean) => void }) {
  const { view, setView } = useStore();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<LessonResult | null>(null);
  const [reward, setReward] = useState<CompletionReward | null>(null);
  const completing = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const sessionId = view!.session.id;
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.start(sessionId, nodeId).then((r) => {
      setLesson(r.lesson);
      setNotice(r.switched ?? null);
      setView(r.view);
      started.current = Date.now();
    }).catch((e) => setError(e.message));
  }, [sessionId, nodeId, setView]);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onComplete = async (answer: Answer) => {
    if (completing.current) return;
    completing.current = true;
    setError(null);
    try {
      const r = await api.complete(sessionId, nodeId, answer, (Date.now() - started.current) / 60000);
      setResult(r.result);
      setReward(r.reward);
      setView(r.view, r.generated);
      contentRef.current?.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      completing.current = false;
    }
  };

  const track = view?.skills.flatMap((s) => s.tracks).find((t) => t.id === lesson?.trackId);
  const previousXp = lesson ? view!.session.events.reduce((best, event) => event.lessonId === lesson.id && event.trackId === lesson.trackId ? Math.max(best, lessonXp(event.result)) : best, 0) : 0;
  const missed = result?.criteria.filter((c) => c.status === 'missed').map((c) => track?.criteria.find((x) => x.id === c.key)).filter(Boolean) ?? [];

  return (
    <div className="overlay lesson-overlay" role="dialog" aria-modal="true" aria-label={lesson?.title ?? 'Lektion'}>
      <div className="overlay-panel lesson-shell" ref={ref} tabIndex={-1}>
        <header className="overlay-head">
          <div>
            {lesson && (
              <p className="meta">
                <span className="pill">{TYPE_LABEL[lesson.type]}</span>
                {!result && <span className="pill xp-preview"><Icon name="star" size={14} />{previousXp === 0 ? 'Bis zu 100 XP' : previousXp < 100 ? `Noch ${100 - previousXp} XP möglich` : 'Zum Festigen'}</span>}
                <span>etwa {lesson.durationMin} {lesson.durationMin === 1 ? 'Minute' : 'Minuten'}</span>
              </p>
            )}
            <h2>{lesson?.title ?? 'Lektion wird geladen …'}</h2>

          </div>
          <button className="btn quiet small lesson-close" aria-label="Schliessen" onClick={() => onClose(Boolean(result))}><Icon name="close" size={18} /><span>Schliessen</span></button>
        </header>

        <div className="lesson-content" ref={contentRef}>
        {lesson && !result && <details className="lesson-brief"><summary>Hinweise</summary><p>{lesson.intro}</p><LessonSource lesson={lesson} /></details>}
        {error && <p className="error" role="alert">{error}</p>}
        {notice && !result && <p className="note">{notice}</p>}

        {lesson && !result && (
          <LessonActivityProvider sessionId={sessionId} nodeId={nodeId}><div className={`lesson-body lesson-${lesson.type}`}>
            {lesson.type === 'mark-evidence' && <MarkEvidence lesson={lesson} sessionId={sessionId} nodeId={nodeId} onComplete={onComplete} />}
            {lesson.type === 'mock-site' && <MockSite lesson={lesson} sessionId={sessionId} nodeId={nodeId} onComplete={onComplete} />}
            {lesson.type === 'video' && <Video lesson={lesson} prepareUrl={`/api/sessions/${encodeURIComponent(sessionId)}/nodes/${encodeURIComponent(nodeId)}/video`} onComplete={onComplete} />}
            {lesson.type === 'ai-chat' && <AiChat lesson={lesson} sessionId={sessionId} nodeId={nodeId} onComplete={onComplete} />}
            {lesson.type === 'podcast' && <PodcastLesson lesson={lesson} sessionId={sessionId} nodeId={nodeId} onComplete={onComplete} />}
          </div></LessonActivityProvider>
        )}

        {result && lesson && (
          <div className="feedback" aria-live="polite">
            {reward && view && <RewardCelebration reward={reward} progress={view.rewards} trackId={lesson.trackId} trackName={track?.name ?? "Dein Thema"} />}
            <div className={`result ${result.allMet ? 'ok' : 'gap'}`}>
              <h3>{result.allMet ? 'Geschafft!' : 'Noch nicht ganz.'}</h3>
              <p>{result.summary}</p>
            </div>
            <details className="result-review"><summary>Antworten ({result.items.filter((item) => item.correct).length}/{result.items.length} richtig)</summary><ul className="items">
              {result.items.map((it, i) => (
                <li key={i} className={it.correct ? 'ok' : 'no'}>
                  {it.label && <strong>{it.label}</strong>}
                  <span>{it.text}</span>
                </li>
              ))}
            </ul></details>
            {missed.length > 0 && (
              <div className="note"><strong>Merke dir:</strong> {missed.map((m) => m!.ruleOfThumb).join(' ')}</div>
            )}
            {lesson.transfer && <div className="transfer"><strong>Im Alltag:</strong> {lesson.transfer}</div>}

          </div>
        )}
        </div>
        {result && <footer className="lesson-result-actions"><button className="btn primary" onClick={() => onClose(true)}>Weiterlernen<Icon name="chevron" size={18} /></button></footer>}
      </div>
    </div>
  );
}
