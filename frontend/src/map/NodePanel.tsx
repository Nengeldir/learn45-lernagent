// Side panel next to the map: the agent's next step with its reasons, or details of a selected node.
// Learners are new to computers: one clear action per view, plain words, the agent's reasoning behind "Mehr erfahren".
import { useState } from 'react';
import type { Lesson, MapNode, Recommendation, SessionView, Track } from '@l45/shared';
import { LERNSTAND_LABEL, SOURCE_LABEL, TYPE_LABEL } from '@l45/shared';
import { NextTopics } from '../lessons/NextTopics.tsx';
import { api } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { Podcast } from './Podcast.tsx';

const LEVEL_TEXT: Record<string, string> = { Grundstufe: 'keins oder wenig', Mittelstufe: 'etwas', Fortgeschritten: 'viel' };

/** Own tracks in which nothing is left to do. */
export const idleOwnTracks = (view: SessionView): Track[] =>
  view.skills.find((s) => s.id === 'custom')?.tracks.filter((t) => !view.session.nodes.some((n) => n.kind === 'lesson' && n.trackId === t.id && n.state !== 'done' && n.state !== 'skipped')) ?? [];

/** Own tracks have no prepared lessons. When nothing is open there, the learner can ask for the next one. */
export function NextLesson({ track, onFocus }: { track: Track; onFocus: (nodeId: string | null) => void }) {
  const { view, setView } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!view?.canCreateTracks) return null;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.nextLesson(view.session.id, track.id);
      setView(r.view, r.generated);
      onFocus(r.view.recommendation?.nodeId || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button className="btn secondary block" disabled={busy} onClick={go}><Icon name="sparkle" size={16} />{busy ? 'Lektion wird erstellt …' : `Noch eine Lektion zu «${track.name}»`}</button>
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  );
}

/** Which plan this is: the agent's (A1), the rules' while the agent still works, or the rules' alone. */
export function planLabel(rec: Recommendation, view: SessionView) {
  if (rec.ruleId === 'A1') return 'Agent-Plan';
  if (rec.provisional) return 'vorläufig';
  return view.agentAvailable ? 'Regel' : 'Plan nach Regeln';
}

/** The records and events a recommendation cites, in words. */
export function BasedOn({ rec, view }: { rec: Recommendation; view: SessionView }) {
  if (!rec.basedOn?.length) return null;
  const { records } = view.workspace;
  const { events, nodes } = view.session;
  return (
    <ul className="based-on">
      {rec.basedOn.map((id) => {
        const r = records.find((x) => x.id === id);
        const e = events.find((x) => x.id === id);
        const text = r ? r.title : e ? `Ergebnis «${nodes.find((n) => n.id === e.nodeId)?.label ?? e.lessonId}»: ${e.result.summary}` : id;
        return <li key={id}>{text}</li>;
      })}
    </ul>
  );
}

/** Shown while the planner agent works on the next step. */
export function PlanStatus({ view }: { view: SessionView }) {
  if (!view.session.planning) return null;
  return <p className="planning" role="status"><span className="dot-pulse" aria-hidden="true" />Der Lernagent sucht die beste nächste Lektion für dich …</p>;
}

/** Where a lesson comes from. Only lessons the AI wrote are marked: their examples are invented. */
export function LessonSource({ lesson }: { lesson: Lesson }) {
  if (lesson.source !== 'model') return null;
  return (
    <p className="small muted source-line">
      Von der KI geschrieben. Die Beispiele sind erfunden.
      {lesson.primarySource && <> Mehr dazu: <a href={lesson.primarySource.url} target="_blank" rel="noreferrer">{lesson.primarySource.title}</a></>}
    </p>
  );
}

/** One plain sentence why, the full reasoning on request. */
export function Reason({ rec, view }: { rec: Recommendation; view: SessionView }) {
  return (
    <>
      <p className="why">{rec.why}</p>
      <details className="more">
        <summary>Warum dieser Vorschlag?</summary>
        <dl className="reason">
          <div><dt>Das hat der Lernagent bemerkt</dt><dd>{rec.observation}</dd></div>
          <div><dt>Sein Vorschlag</dt><dd>{rec.reason}</dd></div>
          {rec.basedOn?.length ? <div><dt>Er stützt sich auf</dt><dd><BasedOn rec={rec} view={view} /></dd></div> : null}
          <div>
            <dt>Technische Angaben</dt>
            <dd className="small muted">
              {rec.ruleId} {rec.ruleName} · {rec.tags.map((t) => SOURCE_LABEL[t]).join(', ')} · {planLabel(rec, view)}
            </dd>
          </div>
        </dl>
      </details>
    </>
  );
}

export function NodePanel({
  view, selected, onSelect, onStart, onAddTrack, onFocus,
}: {
  view: SessionView;
  selected: MapNode | null;
  onSelect: (id: string | null) => void;
  onStart: (nodeId: string) => void;
  onAddTrack: () => void;
  /** Move the map to a node, e.g. a lesson that was just made */
  onFocus: (nodeId: string | null) => void;
}) {
  const { lessonOf, content } = useStore();
  const { session, recommendation: rec, dcc } = view;
  const byId = (id?: string) => session.nodes.find((n) => n.id === id);
  // A started recommendation counts as accepted and leaves the view; its node still shows what comes next.
  const recNode = byId(rec?.nodeId) ?? session.nodes.find((n) => n.kind === 'lesson' && n.state === 'recommended');
  const altNode = byId(rec?.alternativeNodeId);
  const trackName = (id?: string) => view.skills.flatMap((s) => s.tracks).find((t) => t.id === id)?.name ?? '';

  // --- Empty map: choose what to learn ---
  if (!selected && !view.skills.length) {
    return (
      <div className="panel-inner">
        <span className="empty-hero" aria-hidden="true"><Icon name="map" size={26} /></span>
        <h2>Was möchtest du lernen?</h2>
        <p>Wähle ein Thema. Der Lernagent stellt dir dann kurze Lektionen zusammen.</p>
        <button className="btn primary big block" onClick={onAddTrack}><Icon name="plus" size={20} />Thema wählen</button>
      </div>
    );
  }

  // --- Default: choose the next topic and format. Topic previews on the map open the same chooser. ---
  const nextTrackId = selected?.topicId ? selected.trackId : recNode?.trackId ?? session.events.at(-1)?.trackId ?? view.skills.flatMap((s) => s.tracks)[0]?.id;
  if ((!selected || selected.topicId) && nextTrackId) {
    return (
      <div className="panel-inner">
        <NextTopics key={`${nextTrackId}:${selected?.topicId ?? 'next'}`} trackId={nextTrackId} initialTopicId={selected?.topicId} onStart={onStart} onFocus={onFocus} />
        <button className="btn secondary block" onClick={onAddTrack}><Icon name="plus" size={16} />Neues Thema</button>
      </div>
    );
  }

  if (!selected) return null;
  const lesson = lessonOf(selected.lessonId);

  if (selected.kind === 'lesson' && lesson) {
    const isRec = selected.state === 'recommended';
    const isAlt = selected.state === 'alternative';
    return (
      <div className="panel-inner">
        <BackLink onClick={() => onSelect(null)} />
        <p className="eyebrow">{trackName(selected.trackId)}</p>
        <h2>{selected.label}</h2>
        <LessonFacts node={selected} />
        <p>{lesson.intro}</p>
        {selected.state === 'done' && selected.result && (
          <div className={`result ${selected.result.allMet ? 'ok' : 'gap'}`}>
            <strong>{selected.result.allMet ? 'Geschafft' : 'Teilweise geschafft'}</strong>
            <p className="small">{selected.result.summary}</p>
          </div>
        )}
        <button className="btn primary big block" onClick={() => onStart(selected.id)}>
          <Icon name="play" size={20} />{selected.state === 'done' ? 'Nochmals machen' : 'Starten'}
        </button>
        {isAlt && recNode && <p className="small muted">Vorgeschlagen war eigentlich «{recNode.label}». Du darfst aber frei wählen.</p>}
        {isRec && rec && <><PlanStatus view={view} /><Reason rec={rec} view={view} /></>}
        {isRec && altNode && <button className="btn quiet block" onClick={() => onSelect(altNode.id)}>Lieber etwas anderes</button>}
        <LessonSource lesson={lesson} />
      </div>
    );
  }

  if (selected.kind === 'track') {
    const skill = view.skills.find((s) => s.tracks.some((t) => t.id === selected.trackId));
    const lv = selected.trackId ? dcc.levels[selected.trackId] : null;
    const lessons = session.nodes.filter((n) => n.kind === 'lesson' && n.trackId === selected.trackId);
    const done = lessons.filter((n) => n.state === 'done').length;
    const track = skill?.tracks.find((t) => t.id === selected.trackId);
    const mission = view.workspace.missions.find((m) => m.trackId === selected.trackId);
    const stand = view.workspace.lernstand.filter((l) => l.trackId === selected.trackId);
    return (
      <div className="panel-inner">
        <BackLink onClick={() => onSelect(null)} />
        <h2>{selected.label}</h2>
        <p>{done} von {lessons.length} {lessons.length === 1 ? 'Lektion' : 'Lektionen'} geschafft.</p>
        {mission && <p className="small"><strong>Dein Ziel:</strong> {mission.text}</p>}
        <ul className="nodelist">
          {lessons.map((n) => (
            <li key={n.id}>
              <button onClick={() => onSelect(n.id)}>
                <span className={`dotmark ${n.state}`} aria-hidden="true" />
                <span className="grow">{n.label}</span>
                <span className="muted small">{stateLabel(n)}</span>
              </button>
            </li>
          ))}
        </ul>
        {track && <NextTopics key={track.id} trackId={track.id} onStart={onStart} onFocus={onFocus} />}
        {track && <Podcast key={track.id} sessionId={session.id} track={track} />}
        <details className="more">
          <summary>Mehr erfahren</summary>
          {stand.length > 0 && (
            <>
              <h3 className="small-head">Was du schon kannst</h3>
              <ul className="lernstand">
                {stand.map((l) => (
                  <li key={l.criterion}>
                    <span className="grow">{track?.criteria.find((c) => c.id === l.criterion)?.label ?? l.criterion}</span>
                    <span className={`ls ${l.state}`}>{LERNSTAND_LABEL[l.state]}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="small muted">
            {skill?.dccBased
              ? <>Deine Stufe im DCC-Test: {lv ?? 'nicht erhoben'}. Das Lernen hier ändert diese Stufe nicht.</>
              : track?.custom
                ? <>Dein eigenes Thema. Vorwissen nach deiner Angabe: {LEVEL_TEXT[track.custom.selfLevel]}. Die KI hat das Thema geplant.</>
                : 'Der Lernagent plant hier nach dem, was du bisher gemacht hast.'}
          </p>
          {track?.custom && track.custom.sources.length > 0 && (
            <>
              <h3 className="small-head">Quellen</h3>
              <ul className="sources small">
                {track.custom.sources.map((x) => (
                  <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer">{x.title}</a>{x.note ? `: ${x.note}` : ''}</li>
                ))}
              </ul>
              <p className="small muted">Die KI hat diese Quellen vorgeschlagen. Ein Mensch hat sie nicht geprüft.</p>
            </>
          )}
        </details>
      </div>
    );
  }

  if (selected.kind === 'skill') {
    return (
      <div className="panel-inner">
        <BackLink onClick={() => onSelect(null)} />
        <h2>{selected.label}</h2>
        <p>Tippe auf der Karte auf ein Thema, um seine Lektionen zu sehen.</p>
        <button className="btn secondary block" onClick={onAddTrack}><Icon name="plus" size={16} />Neues Thema</button>
      </div>
    );
  }

  // Start node: the learner
  const dccTracks = content?.skills.filter((s) => s.dccBased).flatMap((s) => s.tracks) ?? [];
  const done = session.nodes.filter((n) => n.kind === 'lesson' && n.state === 'done').length;
  return (
    <div className="panel-inner">
      <BackLink onClick={() => onSelect(null)} />
      <h2>{session.userName}</h2>
      <p>Du hast {done} {done === 1 ? 'Lektion' : 'Lektionen'} geschafft.</p>
      {dccTracks.some((t) => dcc.levels[t.id]) && (
        <details className="more">
          <summary>Deine Stufen im DCC-Test</summary>
          <table className="levels">
            <tbody>
              {dccTracks.map((t) => (
                <tr key={t.id}><td>{t.name}</td><td>{dcc.levels[t.id] ?? <span className="muted">nicht erhoben</span>}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function stateLabel(n: MapNode) {
  switch (n.state) {
    case 'recommended': return 'als Nächstes';
    case 'alternative': return 'zur Wahl';
    case 'done': return n.result?.allMet ? 'geschafft' : 'teilweise';
    case 'skipped': return 'übersprungen';
    default: return 'später';
  }
}

function LessonFacts({ node }: { node: MapNode }) {
  const { lessonOf } = useStore();
  const l = lessonOf(node.lessonId);
  if (!l) return null;
  return (
    <p className="facts">
      <span className="pill">{TYPE_LABEL[l.type]}</span>
      <span>etwa {l.durationMin} {l.durationMin === 1 ? 'Minute' : 'Minuten'}</span>
    </p>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return <button className="btn quiet small back" onClick={onClick}><Icon name="back" size={18} />Zurück</button>;
}
