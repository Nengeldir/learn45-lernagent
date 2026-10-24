// The default view: one topic as a single line of lessons, from finished ones to the next step and what comes
// after. Simpler than the mind map for learners new to computers; the whole map stays one tap away.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { SessionView } from '@l45/shared';
import { TYPE_LABEL } from '@l45/shared';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { trackColors } from '../map/layout.ts';
import { idleOwnTracks, LessonSource, NextLesson, PlanStatus, Reason } from '../map/NodePanel.tsx';
import { Podcast } from '../map/Podcast.tsx';
import { pathOf } from './order.ts';

/** Sideways offsets in px that make the line wind gently down the page. */
const WAVE = [0, 34, 60, 34, 0, -26];

export function LearningPath({ view, onStart, onAddTrack, onShowMap }: {
  view: SessionView;
  onStart: (nodeId: string) => void;
  onAddTrack: () => void;
  onShowMap: () => void;
}) {
  const { lessonOf } = useStore();
  const { session, recommendation: rec } = view;
  const tracks = view.skills.flatMap((s) => s.tracks);
  const recNode = session.nodes.find((n) => n.id === rec?.nodeId);
  const altNode = session.nodes.find((n) => n.id === rec?.alternativeNodeId);
  const colors = useMemo(() => trackColors(session.nodes), [session.nodes]);
  const [trackId, setTrackId] = useState<string | undefined>(recNode?.trackId ?? tracks[0]?.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const currentRef = useRef<HTMLLIElement>(null);

  // Follow the agent: when it suggests a lesson, show its topic with that lesson open.
  useEffect(() => {
    if (!recNode?.trackId) return;
    setTrackId(recNode.trackId);
    setOpenId(null);
  }, [recNode?.id, recNode?.trackId]);

  const track = tracks.find((t) => t.id === trackId) ?? tracks[0];
  const steps = useMemo(() => (track ? pathOf(session.nodes, track.id, session.events) : []), [session.nodes, session.events, track]);
  const current = steps.find((n) => n.state !== 'done');
  const open = steps.some((n) => n.id === openId) ? openId : current?.id;

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [track?.id, current?.id]);

  if (!track) {
    return (
      <div className="path-inner path-empty">
        <span className="empty-hero" aria-hidden="true"><Icon name="map" size={26} /></span>
        <h1 className="path-title">Was möchtest du lernen?</h1>
        <p>Wähle ein Thema. Der Lernagent stellt dir dann kurze Lektionen zusammen.</p>
        <button className="btn primary big" onClick={onAddTrack}><Icon name="plus" size={20} />Thema wählen</button>
      </div>
    );
  }

  const color = colors.get(track.id) ?? 'var(--ink)';
  const doneCount = steps.filter((n) => n.state === 'done').length;
  const mission = view.workspace.missions.find((m) => m.trackId === track.id);
  const idle = idleOwnTracks(view).some((t) => t.id === track.id);
  const choose = (id: string) => {
    setTrackId(id);
    setOpenId(null);
  };

  return (
    <div className="path-inner" style={{ ['--tc' as string]: color } as CSSProperties}>
      {tracks.length > 1 && (
        <nav className="path-topics" aria-label="Deine Themen">
          {tracks.map((t) => {
            const all = pathOf(session.nodes, t.id, session.events);
            return (
              <button key={t.id} className="topic-chip" aria-pressed={t.id === track.id} style={{ ['--tc' as string]: colors.get(t.id) } as CSSProperties} onClick={() => choose(t.id)}>
                <span className="topic-dot" aria-hidden="true" />
                {t.name}
                <span className="topic-count">{all.filter((n) => n.state === 'done').length}/{all.length}</span>
              </button>
            );
          })}
        </nav>
      )}

      <header className="path-head">
        <h1 className="path-title">{track.name}</h1>
        <div className="path-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Fortschritt">
          <span style={{ width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%` }} />
        </div>
        <p className="muted">{doneCount} von {steps.length} {steps.length === 1 ? 'Lektion' : 'Lektionen'} geschafft</p>
        {mission && <p className="small"><strong>Dein Ziel:</strong> {mission.text}</p>}
      </header>

      <PlanStatus view={view} />

      <ol className="path">
        {steps.map((n, i) => {
          const isOpen = n.id === open;
          const isCurrent = n.id === current?.id;
          const lesson = lessonOf(n.lessonId);
          return (
            <li
              key={n.id}
              ref={isCurrent ? currentRef : undefined}
              className={`step ${n.state === 'done' ? 'done' : isCurrent ? 'current' : 'later'}${isOpen ? ' open' : ''}`}
              style={{ ['--wave' as string]: `${WAVE[i % WAVE.length]}px` } as CSSProperties}
            >
              <button className="step-head" aria-expanded={isOpen} onClick={() => setOpenId(isOpen && !isCurrent ? null : n.id)}>
                <span className="step-node" aria-hidden="true">
                  {n.state === 'done' ? <Icon name="check" size={30} /> : isCurrent ? <Icon name="play" size={28} /> : i + 1}
                </span>
                <span className="step-text">
                  {isCurrent && <span className="eyebrow next">Als Nächstes</span>}
                  <span className="step-label">{n.label}</span>
                  <span className="step-meta">
                    {n.state === 'done'
                      ? n.result?.allMet ? 'Geschafft' : 'Teilweise geschafft'
                      : lesson ? `${TYPE_LABEL[lesson.type]} · etwa ${lesson.durationMin} ${lesson.durationMin === 1 ? 'Minute' : 'Minuten'}` : ''}
                  </span>
                </span>
              </button>

              {isOpen && lesson && (
                <div className="step-card">
                  <p>{lesson.intro}</p>
                  {n.state === 'done' && n.result && <p className="small muted">{n.result.summary}</p>}
                  <button className="btn primary big" onClick={() => onStart(n.id)}>
                    <Icon name="play" size={20} />{n.state === 'done' ? 'Nochmals machen' : 'Starten'}
                  </button>
                  {n.id === recNode?.id && rec && <Reason rec={rec} view={view} />}
                  {n.id === recNode?.id && altNode && (
                    <button className="btn quiet" onClick={() => { setTrackId(altNode.trackId); setOpenId(altNode.id); }}>Lieber etwas anderes</button>
                  )}
                  <LessonSource lesson={lesson} />
                </div>
              )}
            </li>
          );
        })}
        {/* With the AI the agent writes the next lesson after each result, so the line ends at the current step.
            A placeholder shows that it goes on. */}
        {(session.planning || (current && view.agentAvailable && steps.indexOf(current) === steps.length - 1)) && (
          <li className="step ghost" style={{ ['--wave' as string]: `${WAVE[steps.length % WAVE.length]}px` } as CSSProperties}>
            <div className="step-head">
              <span className="step-node" aria-hidden="true"><Icon name="sparkle" size={26} /></span>
              <span className="step-text">
                <span className="step-label">{session.planning ? 'Die nächste Lektion wird vorbereitet …' : 'Die nächste Lektion entsteht, sobald du diese geschafft hast.'}</span>
                <span className="step-meta">Der Lernagent passt sie an dich an.</span>
              </span>
            </div>
          </li>
        )}
      </ol>

      {!current && !session.planning && (
        <div className="path-end">
          <h2>Gut gemacht! Du hast alle Lektionen in diesem Thema geschafft.</h2>
          {idle && <NextLesson track={track} onFocus={() => setOpenId(null)} />}
          <button className="btn primary" onClick={onAddTrack}><Icon name="plus" size={18} />Neues Thema</button>
        </div>
      )}

      <Podcast key={track.id} sessionId={session.id} track={track} />

      <button className="linkbtn path-map" onClick={onShowMap}><Icon name="map" size={18} />Alle Themen als Karte ansehen</button>
    </div>
  );
}
