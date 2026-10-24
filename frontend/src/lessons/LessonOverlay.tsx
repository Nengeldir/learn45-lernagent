// A lesson opens over the map. After finishing, feedback and the agent's next step are shown here.
import { useEffect, useRef, useState } from 'react';
import type { Answer, Lesson, LessonResult } from '@l45/shared';
import { api } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';
import { useI18n } from '../lib/i18n.tsx';
import { useStore } from '../lib/store.tsx';
import { BasedOn, LessonSource, PlanStatus, planLabel } from '../map/NodePanel.tsx';
import { AiChat } from './AiChat.tsx';
import { MarkEvidence, MockSite } from './Checkable.tsx';
import { MissionCard } from './MissionCard.tsx';
import { Video } from './Video.tsx';

export function LessonOverlay({ nodeId, onClose }: { nodeId: string; onClose: (showNext: boolean) => void }) {
  const { view, setView } = useStore();
  const { t, lang, type, mode, level, source, trackName, lessonTitle } = useI18n();
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
    <div className="overlay" role="dialog" aria-modal="true" aria-label={lesson ? lessonTitle(lesson.id, lesson.title) : t('Lektion')}>
      <div className="overlay-panel" ref={ref} tabIndex={-1}>
        <header className="overlay-head">
          <div>
            {lesson && (
              <p className="meta">
                <span className="pill">{type(lesson.type)}</span>
                <span>{mode(lesson.mode)}</span>
                <span>{lesson.durationMin} {t('Min.')}</span>
                <span>{track ? trackName(track.id, track.name) : ''}</span>
                <span>{level(lesson.level)}</span>
              </p>
            )}
            <h2>{lesson ? lessonTitle(lesson.id, lesson.title) : ready ? t('Lektion wird geladen …') : missionTrack ? trackName(missionTrack.id, missionTrack.name) : ''}</h2>
            {lesson && !result && <p>{lesson.intro}</p>}
            {lesson && !result && lang !== 'de' && <p className="small muted">{t('Die Aufgabe bleibt auf Deutsch. Die Prüfung erkennt die deutschen Formulierungen.')}</p>}
            {lesson && <LessonSource lesson={lesson} />}
          </div>
          {result
            ? <button className="btn secondary" onClick={() => onClose(true)}><Icon name="map" size={16} />{t('Zur Karte')}</button>
            : <button className="icon-btn" onClick={() => onClose(false)} aria-label={t('Schliessen')} title={t('Schliessen')}><Icon name="close" size={20} /></button>}
        </header>

        {error && <p className="error" role="alert">{t(error)}</p>}
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
              <h3>{result.allMet ? t('Gelöst') : t('Noch nicht ganz')}</h3>
              <p>{result.summary}</p>
              <span className={`tag ${result.judgedBy === 'model' ? 'model' : result.judgedBy === 'keywords' ? 'prepared' : 'rule'}`}>
                {t('Geprüft durch: {by}', { by: result.judgedBy === 'model' ? t('KI') : result.judgedBy === 'keywords' ? t('Stichwörter (ohne KI)') : t('Regel') })}
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
              <div className="note"><strong>{t('Merksatz:')}</strong> {missed.map((m) => m!.ruleOfThumb).join(' ')}</div>
            )}
            {lesson.transfer && <div className="transfer"><strong>{t('Für deine Arbeit:')}</strong> {lesson.transfer}</div>}
            {rec && view && (
              <div className="next-card">
                <p className="eyebrow next">{t('Der Agent passt deine Karte an')}</p>
                <PlanStatus view={view} />
                <h3>{recNode ? t('Nächster Schritt: {label}', { label: lessonTitle(recNode.lessonId, recNode.label) }) : t('Alles erledigt')}</h3>
                <p>{t(rec.reason)}</p>
                <p className="small">{t(rec.why)}</p>
                {rec.basedOn?.length ? <div className="small"><strong>{t('Gestützt auf:')}</strong><BasedOn rec={rec} view={view} /></div> : null}
                <p className="small muted">{rec.ruleId} {t(rec.ruleName)}. {rec.tags.map((tag) => source(tag)).join(', ')}. {planLabel(rec, view, t)}</p>
                <button className="btn primary" onClick={() => onClose(true)}><Icon name="map" size={16} />{t('Auf der Karte ansehen')}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
