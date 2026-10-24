// Side panel next to the map: the agent's next step with its reasons, or details of a selected node.
import { useState } from 'react';
import type { Lesson, MapNode, Recommendation, SessionView, Track } from '@l45/shared';
import { LERNSTAND_LABEL, MODE_LABEL, SOURCE_LABEL, TYPE_LABEL } from '@l45/shared';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.tsx';

const LEVEL_TEXT: Record<string, string> = { Grundstufe: 'keins oder wenig', Mittelstufe: 'etwas', Fortgeschritten: 'viel' };

/** Own tracks in which nothing is left to do. */
const idleOwnTracks = (view: SessionView): Track[] =>
  view.skills.find((s) => s.id === 'custom')?.tracks.filter((t) => !view.session.nodes.some((n) => n.kind === 'lesson' && n.trackId === t.id && n.state !== 'done' && n.state !== 'skipped')) ?? [];

/** Own tracks have no prepared lessons. When nothing is open there, the learner can ask for the next one. */
function NextLesson({ track, onFocus }: { track: Track; onFocus: (nodeId: string | null) => void }) {
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
      <button className="btn secondary" disabled={busy} onClick={go}>{busy ? 'Lektion wird erstellt …' : `Neue Lektion in «${track.name}»`}</button>
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
        const text = r ? `${r.id}: ${r.title}` : e ? `Ergebnis «${nodes.find((n) => n.id === e.nodeId)?.label ?? e.lessonId}»: ${e.result.summary}` : id;
        return <li key={id}>{text}</li>;
      })}
    </ul>
  );
}

/** Shown while the planner agent works on the next step. */
export function PlanStatus({ view }: { view: SessionView }) {
  if (view.session.planning) {
    return <p className="planning" role="status"><span className="dot-pulse" aria-hidden="true" />Agent plant … Bis dahin gilt der vorläufige Vorschlag nach Regeln.</p>;
  }
  if (!view.agentAvailable) return <p className="small muted">Plan nach Regeln: Ohne KI plant der Agent mit den Regeln und den vorbereiteten Lektionen.</p>;
  return null;
}

/** Where a lesson comes from: made by the AI (with its source) or prepared. */
export function LessonSource({ lesson }: { lesson: Lesson }) {
  const { view } = useStore();
  // In own tracks the AI proposed the sources too; prepared tracks have vetted ones.
  const own = view?.skills.some((s) => s.id === 'custom' && s.tracks.some((t) => t.id === lesson.trackId));
  if (lesson.source === 'model') {
    return (
      <p className="small source-line">
        <span className="tag model">Von der KI erstellt</span>
        <span className="tag model">Beispiel erfunden</span>
        {lesson.primarySource && <> Quelle: <a href={lesson.primarySource.url} target="_blank" rel="noreferrer">{lesson.primarySource.title}</a></>}
        {own && <span className="muted">(von der KI vorgeschlagen)</span>}
      </p>
    );
  }
  return <p className="small source-line"><span className="tag prepared">Vorbereitet</span></p>;
}

function Reason({ rec, view }: { rec: Recommendation; view: SessionView }) {
  return (
    <dl className="reason">
      <div><dt>Was der Agent gesehen hat</dt><dd>{rec.observation}</dd></div>
      <div><dt>Vorschlag</dt><dd>{rec.reason}</dd></div>
      <div><dt>Warum das jetzt hilft</dt><dd>{rec.why}</dd></div>
      {rec.basedOn?.length ? <div><dt>Gestützt auf</dt><dd><BasedOn rec={rec} view={view} /></dd></div> : null}
      <div>
        <dt>Regel</dt>
        <dd>
          {rec.ruleId} {rec.ruleName}{' '}
          {rec.tags.map((t) => <span key={t} className={`tag ${t}`}>{SOURCE_LABEL[t]}</span>)}
          <span className={`tag${rec.provisional ? ' provisional' : ''}`}>{planLabel(rec, view)}</span>
        </dd>
      </div>
    </dl>
  );
}

export function NodePanel({
  view, selected, onSelect, onStart, onMoreTime, onAddTrack, onFocus,
}: {
  view: SessionView;
  selected: MapNode | null;
  onSelect: (id: string | null) => void;
  onStart: (nodeId: string) => void;
  onMoreTime: () => void;
  onAddTrack: () => void;
  /** Move the map to a node, e.g. a lesson that was just made */
  onFocus: (nodeId: string | null) => void;
}) {
  const { lessonOf, content } = useStore();
  const { session, recommendation: rec, dcc } = view;
  const byId = (id?: string) => session.nodes.find((n) => n.id === id);
  const recNode = byId(rec?.nodeId);
  const altNode = byId(rec?.alternativeNodeId);
  const trackName = (id?: string) => view.skills.flatMap((s) => s.tracks).find((t) => t.id === id)?.name ?? '';

  // --- Empty map: choose what to learn ---
  if (!selected && !view.skills.length) {
    return (
      <div className="panel-inner">
        <p className="muted small">Los geht's</p>
        <h2>Was willst du lernen?</h2>
        <p>Deine Karte ist noch leer. Wähle ein eigenes Thema, zum Beispiel «Security+ Prüfung bestehen», oder einen vorbereiteten Bereich.</p>
        <div className="row"><button className="btn primary" onClick={onAddTrack}>Bereich hinzufügen</button></div>
        <p className="small muted">
          {view.canCreateTracks
            ? 'Für ein eigenes Thema plant der Agent mit der KI, was du können musst, sucht Quellen und erstellt einen Einstieg.'
            : 'Ohne KI stehen die vorbereiteten Bereiche zur Wahl. Eigene Themen plant der Agent nur mit KI.'}
        </p>
      </div>
    );
  }

  // --- Default: the next step ---
  if (!selected) {
    return (
      <div className="panel-inner">
        <p className="eyebrow-free muted small">Nächster Schritt</p>
        <PlanStatus view={view} />
        {recNode && rec ? (
          <>
            <h2>{recNode.label}</h2>
            <LessonFacts node={recNode} />
            <Reason rec={rec} view={view} />
            <div className="row">
              <button className="btn primary" onClick={() => onStart(recNode.id)}>Starten</button>
              {altNode && <button className="btn secondary" onClick={() => onSelect(altNode.id)}>Alternative ansehen</button>}
            </div>
          </>
        ) : (
          <>
            <h2>{session.planning ? 'Nächster Schritt wird geplant' : view.remainingMin > 0 ? 'Alles erledigt' : 'Für heute fertig'}</h2>
            {rec && !session.planning && <Reason rec={rec} view={view} />}
            {session.planning ? null : view.remainingMin > 0 ? (
              <>
                {idleOwnTracks(view).map((t) => <NextLesson key={t.id} track={t} onFocus={onFocus} />)}
                <div className="row"><button className="btn secondary" onClick={onAddTrack}>Bereich hinzufügen</button></div>
              </>
            ) : (
              <button className="btn secondary" onClick={onMoreTime}>10 Minuten mehr</button>
            )}
          </>
        )}
        <Legend />
        <p className="small muted">
          {view.agentAvailable
            ? 'Mit KI startet jeder Bereich mit einem Einstieg. Nach jeder Lektion erzeugt der Agent die nächste passende Lektion. Vorbereitete Lektionen nimmt er nur, wenn das nicht klappt.'
            : 'Ohne KI: Die Karte zeigt die vorbereiteten Lektionen, die Regeln wählen den nächsten Schritt.'}
        </p>
      </div>
    );
  }

  const lesson = lessonOf(selected.lessonId);

  if (selected.kind === 'lesson' && lesson) {
    const isRec = selected.state === 'recommended';
    const isAlt = selected.state === 'alternative';
    return (
      <div className="panel-inner">
        <button className="linkbtn small" onClick={() => onSelect(null)}>Zurück zum nächsten Schritt</button>
        <p className="muted small">{trackName(selected.trackId)}</p>
        <h2>{selected.label}</h2>
        <LessonFacts node={selected} />
        <p>{lesson.intro}</p>
        <LessonSource lesson={lesson} />
        {selected.addedByAgent && <p className="note small">Diesen Knoten hat der Agent nach deinen Ergebnissen neu hinzugefügt.</p>}
        {isRec && rec && <><PlanStatus view={view} /><Reason rec={rec} view={view} /></>}
        {isAlt && recNode && (
          <p className="note">Das ist die Alternative zur Empfehlung «{recNode.label}». Wenn du sie startest, merkt sich der Agent, dass du die Empfehlung abgelehnt hast.</p>
        )}
        {selected.state === 'planned' && <p className="small muted">Geplant. Du kannst sie freiwillig jederzeit starten.</p>}
        {selected.state === 'done' && selected.result && (
          <div className={`result ${selected.result.allMet ? 'ok' : 'gap'}`}>
            <strong>{selected.result.allMet ? 'Gelöst' : 'Mit Lücken'}{selected.helpUsed ? ', mit Hinweis' : ''}</strong>
            <p className="small">{selected.result.summary}</p>
          </div>
        )}
        <div className="row">
          <button className="btn primary" onClick={() => onStart(selected.id)}>
            {isAlt ? 'Alternative starten' : selected.state === 'done' ? 'Nochmals' : 'Starten'}
          </button>
          {isRec && altNode && <button className="btn secondary" onClick={() => onSelect(altNode.id)}>Lieber etwas anderes</button>}
        </div>
      </div>
    );
  }

  if (selected.kind === 'track') {
    const skill = view.skills.find((s) => s.tracks.some((t) => t.id === selected.trackId));
    const lv = selected.trackId ? dcc.levels[selected.trackId] : null;
    const lessons = session.nodes.filter((n) => n.kind === 'lesson' && n.trackId === selected.trackId);
    const track = skill?.tracks.find((t) => t.id === selected.trackId);
    const mission = view.workspace.missions.find((m) => m.trackId === selected.trackId);
    const stand = view.workspace.lernstand.filter((l) => l.trackId === selected.trackId);
    return (
      <div className="panel-inner">
        <button className="linkbtn small" onClick={() => onSelect(null)}>Zurück zum nächsten Schritt</button>
        <h2>{selected.label}</h2>
        <p>
          {skill?.dccBased ? (
            <>DCC-Position: <strong>{lv ?? 'nicht erhoben'}</strong> <span className="muted small">(aus dem DCC, wird hier nicht verändert)</span></>
          ) : track?.custom ? (
            <>Eigenes Thema: «{track.custom.topic}». Vorwissen nach deiner Angabe: {LEVEL_TEXT[track.custom.selfLevel]}. <span className="muted small">Kriterien und Quellen hat die KI vorgeschlagen.</span></>
          ) : 'Kein DCC-Bereich. Der Agent plant hier nur aus deinem Lernverlauf.'}
        </p>
        <p className="small"><strong>Mission:</strong> {mission ? mission.text : <span className="muted">noch offen, wird beim ersten Start gefragt</span>}</p>
        <h3 className="small-head">Lernstand (aus dem Lernen, kein DCC)</h3>
        <ul className="lernstand">
          {stand.map((l) => (
            <li key={l.criterion}>
              <span className="grow">{track?.criteria.find((c) => c.id === l.criterion)?.label ?? l.criterion}</span>
              <span className={`ls ${l.state}`}>{LERNSTAND_LABEL[l.state]}</span>
            </li>
          ))}
        </ul>
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
        {track?.custom && (
          <>
            <h3 className="small-head">Quellen</h3>
            <ul className="sources small">
              {track.custom.sources.map((x) => (
                <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer">{x.title}</a>{x.note ? `: ${x.note}` : ''}</li>
              ))}
            </ul>
            <p className="small muted">Von der KI vorgeschlagen und beim Anlegen erreichbar, aber nicht von Menschen geprüft.</p>
            {idleOwnTracks(view).some((t) => t.id === track.id) && <NextLesson track={track} onFocus={onFocus} />}
          </>
        )}
      </div>
    );
  }

  if (selected.kind === 'skill') {
    const skill = view.skills.find((s) => s.id === selected.skillId);
    const text = skill?.dccBased
      ? 'Kompetenzbereiche nach DigComp 2.2. Die Stufen kommen aus deinem DCC-Profil.'
      : skill?.id === 'custom'
        ? 'Deine eigenen Themen. Der Agent hat sie mit der KI geplant und erzeugt die Lektionen dazu.'
        : 'Bereich ohne DCC-Position. Der Agent plant hier nur aus deinem Lernverlauf.';
    return (
      <div className="panel-inner">
        <button className="linkbtn small" onClick={() => onSelect(null)}>Zurück zum nächsten Schritt</button>
        <h2>{selected.label}</h2>
        <p>{text}</p>
        <div className="row"><button className="btn secondary small" onClick={onAddTrack}>Bereich hinzufügen</button></div>
      </div>
    );
  }

  // Start node: profile
  return (
    <div className="panel-inner">
      <button className="linkbtn small" onClick={() => onSelect(null)}>Zurück zum nächsten Schritt</button>
      <h2>{session.userName}</h2>
      <p className="small muted">DCC-Profil {dcc.source === 'file' ? `aus «${dcc.fileName ?? 'Datei'}»` : 'von Hand eingegeben'}{dcc.assessedOn ? `, erhoben am ${new Date(dcc.assessedOn).toLocaleDateString('de-CH')}` : ''}</p>
      <table className="levels">
        <tbody>
          {content?.skills.filter((s) => s.dccBased).flatMap((s) => s.tracks).map((t) => (
            <tr key={t.id}><td>{t.dccArea} {t.name}</td><td>{dcc.levels[t.id] ?? <span className="muted">nicht erhoben</span>}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stateLabel(n: MapNode) {
  switch (n.state) {
    case 'recommended': return 'nächster Schritt';
    case 'alternative': return 'Alternative';
    case 'done': return n.result?.allMet ? 'gelöst' : 'mit Lücken';
    case 'skipped': return 'übersprungen';
    default: return 'geplant';
  }
}

function LessonFacts({ node }: { node: MapNode }) {
  const { lessonOf } = useStore();
  const l = lessonOf(node.lessonId);
  if (!l) return null;
  return (
    <p className="facts">
      <span className="pill">{TYPE_LABEL[l.type]}</span>
      <span>{MODE_LABEL[l.mode]}</span>
      <span>{l.durationMin} Min.</span>
      <span>{l.level}</span>
    </p>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Legende">
      <span><i className="lg rec" />nächster Schritt</span>
      <span><i className="lg alt" />Alternative</span>
      <span><i className="lg planned" />geplant</span>
      <span><i className="lg done" />erledigt</span>
    </div>
  );
}
