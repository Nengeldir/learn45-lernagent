// Side panel next to the map: the agent's next step with its reasons, or details of a selected node.
import { useState } from 'react';
import type { Lesson, MapNode, Recommendation, SessionView, Track } from '@l45/shared';
import { LERNSTAND_LABEL } from '@l45/shared';
import { NextTopics } from '../lessons/NextTopics.tsx';
import { api } from '../lib/api.ts';
import { localeOf, useI18n } from '../lib/i18n.tsx';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { buildLines, climbStops, routeOf } from './subwayLayout.ts';

type T = (de: string, vars?: Record<string, string | number>) => string;
const same: T = (de) => de;

const LEVEL_TEXT: Record<string, string> = { Grundstufe: 'keins oder wenig', Mittelstufe: 'etwas', Fortgeschritten: 'viel' };

/** Own tracks in which nothing is left to do. */
const idleOwnTracks = (view: SessionView): Track[] =>
  view.skills.find((s) => s.id === 'custom')?.tracks.filter((t) => !view.session.nodes.some((n) => n.kind === 'lesson' && n.trackId === t.id && n.state !== 'done' && n.state !== 'skipped')) ?? [];

/** Own tracks have no prepared lessons. When nothing is open there, the learner can ask for the next one. */
function NextLesson({ track, onFocus }: { track: Track; onFocus: (nodeId: string | null) => void }) {
  const { view, setView } = useStore();
  const { t, trackName } = useI18n();
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
      <button className="btn secondary block" disabled={busy} onClick={go}><Icon name="sparkle" size={16} />{busy ? t('Lektion wird erstellt …') : t('Neue Lektion in «{name}»', { name: trackName(track.id, track.name) })}</button>
      {error && <p className="error small" role="alert">{t(error)}</p>}
    </div>
  );
}

/** Which plan this is: the agent's (A1), the rules' while the agent still works, or the rules' alone. */
export function planLabel(rec: Recommendation, view: SessionView, t: T = same) {
  if (rec.ruleId === 'A1') return t('Agent-Plan');
  if (rec.provisional) return t('vorläufig');
  return view.agentAvailable ? t('Regel') : t('Plan nach Regeln');
}

/** The records and events a recommendation cites, in words. */
export function BasedOn({ rec, view }: { rec: Recommendation; view: SessionView }) {
  const { t, lessonTitle } = useI18n();
  if (!rec.basedOn?.length) return null;
  const { records } = view.workspace;
  const { events, nodes } = view.session;
  return (
    <ul className="based-on">
      {rec.basedOn.map((id) => {
        const r = records.find((x) => x.id === id);
        const e = events.find((x) => x.id === id);
        const text = r ? `${r.id}: ${r.title}` : e ? `${t('Ergebnis «{label}»', { label: lessonTitle(e.lessonId, nodes.find((n) => n.id === e.nodeId)?.label ?? e.lessonId) })}: ${e.result.summary}` : id;
        return <li key={id}>{text}</li>;
      })}
    </ul>
  );
}

/** Shown while the planner agent works on the next step. */
export function PlanStatus({ view }: { view: SessionView }) {
  const { t } = useI18n();
  if (view.session.planning) {
    return <p className="planning" role="status"><span className="dot-pulse" aria-hidden="true" />{t('Agent plant … Bis dahin gilt der vorläufige Vorschlag nach Regeln.')}</p>;
  }
  if (!view.agentAvailable) return <p className="small muted">{t('Plan nach Regeln: Ohne KI plant der Agent mit den Regeln und den vorbereiteten Lektionen.')}</p>;
  return null;
}

/** Where a lesson comes from. Only lessons the AI wrote are marked: their examples are invented. */
export function LessonSource({ lesson }: { lesson: Lesson }) {
  const { view } = useStore();
  const { t } = useI18n();
  // In own tracks the AI proposed the sources too; prepared tracks have vetted ones.
  const own = view?.skills.some((s) => s.id === 'custom' && s.tracks.some((t) => t.id === lesson.trackId));
  if (lesson.source === 'model') {
    return (
      <p className="small source-line">
        <span className="tag model">{t('Von der KI erstellt')}</span>
        <span className="tag model">{t('Beispiel erfunden')}</span>
        {lesson.primarySource && <> {t('Quelle:')} <a href={lesson.primarySource.url} target="_blank" rel="noreferrer">{lesson.primarySource.title}</a></>}
        {own && <span className="muted">{t('(von der KI vorgeschlagen)')}</span>}
      </p>
    );
  }
  return <p className="small source-line"><span className="tag prepared">{t('Vorbereitet')}</span></p>;
}

function Reason({ rec, view }: { rec: Recommendation; view: SessionView }) {
  const { t, source } = useI18n();
  return (
    <dl className="reason">
      <div><dt>{t('Was der Agent gesehen hat')}</dt><dd>{t(rec.observation)}</dd></div>
      <div><dt>{t('Vorschlag')}</dt><dd>{t(rec.reason)}</dd></div>
      <div><dt>{t('Warum das jetzt hilft')}</dt><dd>{t(rec.why)}</dd></div>
      {rec.basedOn?.length ? <div><dt>{t('Gestützt auf')}</dt><dd><BasedOn rec={rec} view={view} /></dd></div> : null}
      <div>
        <dt>{t('Regel')}</dt>
        <dd>
          {rec.ruleId} {t(rec.ruleName)}{' '}
          {rec.tags.map((tag) => <span key={tag} className={`tag ${tag}`}>{source(tag)}</span>)}
          <span className={`tag${rec.provisional ? ' provisional' : ''}`}>{planLabel(rec, view, t)}</span>
        </dd>
      </div>
    </dl>
  );
}

/** Links between the two views: a knot opens its mountain, a station shows its knot. */
function ViewLinks({
  node, onShowMountain, onShowKnot,
}: {
  node: MapNode;
  onShowMountain?: (trackId: string, nodeId?: string) => void;
  onShowKnot?: (nodeId: string) => void;
}) {
  const { view, lessonOf } = useStore();
  const { t } = useI18n();
  if (!node.trackId || !view) return null;
  const line = buildLines(view.session.nodes, view.skills, view.dcc, lessonOf).find((l) => l.trackId === node.trackId);
  if (!line || (!onShowMountain && !onShowKnot)) return null;
  return (
    <div className="row view-links">
      {onShowMountain && (
        <button className="btn secondary small" onClick={() => onShowMountain(node.trackId!, node.kind === 'lesson' ? node.id : undefined)}>
          {'▲ '}{node.kind === 'lesson' ? t('Auf dem Berg {name} zeigen', { name: line.mountain.name }) : t('Berg {name} öffnen', { name: line.mountain.name })}
        </button>
      )}
      {onShowKnot && <button className="btn quiet small" onClick={() => onShowKnot(node.id)}>{t('Im Wissensknoten zeigen')}</button>}
    </div>
  );
}

export function NodePanel({
  view, selected, onSelect, onStart, onAddTrack, onFocus, onShowMountain, onShowKnot,
}: {
  view: SessionView;
  selected: MapNode | null;
  onSelect: (id: string | null) => void;
  onStart: (nodeId: string) => void;
  onAddTrack: () => void;
  /** Move the map to a node, e.g. a lesson that was just made */
  onFocus: (nodeId: string | null) => void;
  onShowMountain?: (trackId: string, nodeId?: string) => void;
  onShowKnot?: (nodeId: string) => void;
}) {
  const { lessonOf, content } = useStore();
  const { t, lang, level, lessonTitle, trackName: trackLabel, skillName } = useI18n();
  const { session, recommendation: rec, dcc } = view;
  const byId = (id?: string) => session.nodes.find((n) => n.id === id);
  // A started recommendation counts as accepted and leaves the view; its node still shows what comes next.
  const recNode = byId(rec?.nodeId) ?? session.nodes.find((n) => n.kind === 'lesson' && n.state === 'recommended');
  const altNode = byId(rec?.alternativeNodeId);
  const trackName = (id?: string) => trackLabel(id, view.skills.flatMap((s) => s.tracks).find((tr) => tr.id === id)?.name ?? '');
  const labelOf = (n?: MapNode) => (n ? lessonTitle(n.lessonId, n.kind === 'track' ? trackLabel(n.trackId, n.label) : n.kind === 'skill' ? skillName(n.skillId, n.label) : n.label) : '');

  // --- Empty map: choose what to learn ---
  if (!selected && !view.skills.length) {
    return (
      <div className="panel-inner">
        <span className="empty-hero" aria-hidden="true"><Icon name="map" size={26} /></span>
        <p className="eyebrow">{t("Los geht's")}</p>
        <h2>{t('Was willst du lernen?')}</h2>
        <p>{t('Deine Karte ist noch leer. Wähle ein eigenes Thema, zum Beispiel «Security+ Prüfung bestehen», oder einen vorbereiteten Bereich.')}</p>
        <button className="btn primary block" onClick={onAddTrack}><Icon name="plus" size={16} />{t('Bereich hinzufügen')}</button>
        <p className="small muted">
          {view.canCreateTracks
            ? t('Für ein eigenes Thema plant der Agent mit der KI, was du können musst, sucht Quellen und erstellt einen Einstieg.')
            : t('Ohne KI stehen die vorbereiteten Bereiche zur Wahl. Eigene Themen plant der Agent nur mit KI.')}
        </p>
      </div>
    );
  }

  // --- Default: choose the next topic and format. Topic previews on the map open the same chooser. ---
  const nextTrackId = selected?.topicId ? selected.trackId : recNode?.trackId ?? session.events.at(-1)?.trackId ?? view.skills.flatMap((s) => s.tracks)[0]?.id;
  if ((!selected || selected.topicId) && nextTrackId) {
    return (
      <div className="panel-inner">
        <NextTopics key={`${nextTrackId}:${selected?.topicId ?? 'next'}`} trackId={nextTrackId} initialTopicId={selected?.topicId} onStart={onStart} onFocus={onFocus} />
        {recNode && <ViewLinks node={recNode} onShowMountain={onShowMountain} onShowKnot={onShowKnot} />}
        <button className="btn secondary block" onClick={onAddTrack}><Icon name="plus" size={16} />{t('Bereich hinzufügen')}</button>
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
        <h2>{labelOf(selected)}</h2>
        <LessonFacts node={selected} />
        <p>{lesson.intro}</p>
        <LessonSource lesson={lesson} />
        {selected.addedByAgent && <p className="note small">{t('Diesen Knoten hat der Agent nach deinen Ergebnissen neu hinzugefügt.')}</p>}
        {isAlt && recNode && (
          <p className="note">{t('Das ist die Alternative zur Empfehlung «{label}». Wenn du sie startest, merkt sich der Agent, dass du die Empfehlung abgelehnt hast.', { label: labelOf(recNode) })}</p>
        )}
        {selected.state === 'planned' && <p className="small muted">{t('Geplant. Du kannst sie freiwillig jederzeit starten.')}</p>}
        {selected.state === 'done' && selected.result && (
          <div className={`result ${selected.result.allMet ? 'ok' : 'gap'}`}>
            <strong>{selected.result.allMet ? t('Gelöst') : t('Mit Lücken')}{selected.helpUsed ? t(', mit Hinweis') : ''}</strong>
            <p className="small">{selected.result.summary}</p>
          </div>
        )}
        <div className="panel-actions">
          <button className="btn primary" onClick={() => onStart(selected.id)}>
            <Icon name="play" size={16} />{isAlt ? t('Alternative starten') : selected.state === 'done' ? t('Nochmals') : t('Starten')}
          </button>
          {isRec && altNode && <button className="btn secondary" onClick={() => onSelect(altNode.id)}>{t('Lieber etwas anderes')}</button>}
        </div>
        <ViewLinks node={selected} onShowMountain={onShowMountain} onShowKnot={onShowKnot} />
        {isRec && rec && <><PlanStatus view={view} /><Reason rec={rec} view={view} /></>}
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
        <h2>{labelOf(selected)}</h2>
        <p>
          {skill?.dccBased ? (
            <>{t('DCC-Position:')} <strong>{level(lv)}</strong> <span className="muted small">{t('(aus dem DCC, wird hier nicht verändert)')}</span></>
          ) : track?.custom ? (
            <>{t('Eigenes Thema: «{topic}». Vorwissen nach deiner Angabe: {level}.', { topic: track.custom.topic, level: t(LEVEL_TEXT[track.custom.selfLevel]) })} <span className="muted small">{t('Kriterien und Quellen hat die KI vorgeschlagen.')}</span></>
          ) : t('Kein DCC-Bereich. Der Agent plant hier nur aus deinem Lernverlauf.')}
        </p>
        <ViewLinks node={selected} onShowMountain={onShowMountain} onShowKnot={onShowKnot} />
        <p className="small"><strong>{t('Mission:')}</strong> {mission ? mission.text : <span className="muted">{t('noch offen, wird beim ersten Start gefragt')}</span>}</p>
        <h3 className="small-head">{t('Lernstand (aus dem Lernen, kein DCC)')}</h3>
        <ul className="lernstand">
          {stand.map((l) => (
            <li key={l.criterion}>
              <span className="grow">{track?.criteria.find((c) => c.id === l.criterion)?.label ?? l.criterion}</span>
              <span className={`ls ${l.state}`}>{t(LERNSTAND_LABEL[l.state])}</span>
            </li>
          ))}
        </ul>
        <ul className="nodelist">
          {lessons.map((n) => (
            <li key={n.id}>
              <button onClick={() => onSelect(n.id)}>
                <span className={`dotmark ${n.state}`} aria-hidden="true" />
                <span className="grow">{lessonTitle(n.lessonId, n.label)}</span>
                <span className="muted small">{stateLabel(n, t)}</span>
              </button>
            </li>
          ))}
        </ul>
        {track && <NextTopics key={track.id} trackId={track.id} onStart={onStart} onFocus={onFocus} />}
        {track?.custom && (
          <>
            <h3 className="small-head">{t('Quellen')}</h3>
            <ul className="sources small">
              {track.custom.sources.map((x) => (
                <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer">{x.title}</a>{x.note ? `: ${x.note}` : ''}</li>
              ))}
            </ul>
            <p className="small muted">{t('Von der KI vorgeschlagen und beim Anlegen erreichbar, aber nicht von Menschen geprüft.')}</p>
            {idleOwnTracks(view).some((tr) => tr.id === track.id) && <NextLesson track={track} onFocus={onFocus} />}
          </>
        )}
      </div>
    );
  }

  if (selected.kind === 'skill') {
    const skill = view.skills.find((s) => s.id === selected.skillId);
    const text = skill?.dccBased
      ? t('Kompetenzbereiche nach DigComp 2.2. Die Stufen kommen aus deinem DCC-Profil.')
      : skill?.id === 'custom'
        ? t('Deine eigenen Themen. Der Agent hat sie mit der KI geplant und erzeugt die Lektionen dazu.')
        : t('Bereich ohne DCC-Position. Der Agent plant hier nur aus deinem Lernverlauf.');
    return (
      <div className="panel-inner">
        <BackLink onClick={() => onSelect(null)} />
        <h2>{labelOf(selected)}</h2>
        <p>{text}</p>
        <button className="btn secondary block" onClick={onAddTrack}><Icon name="plus" size={16} />{t('Bereich hinzufügen')}</button>
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
      <p className="small muted">
        {t('DCC-Profil')} {dcc.source === 'file' ? t('aus «{file}»', { file: dcc.fileName ?? t('Datei') }) : t('von Hand eingegeben')}
        {dcc.assessedOn ? t(', erhoben am {date}', { date: new Date(dcc.assessedOn).toLocaleDateString(localeOf(lang)) }) : ''}
      </p>
      <table className="levels">
        <tbody>
          {content?.skills.filter((s) => s.dccBased).flatMap((s) => s.tracks).map((tr) => (
            <tr key={tr.id}><td>{tr.dccArea} {trackLabel(tr.id, tr.name)}</td><td>{dcc.levels[tr.id] ? level(dcc.levels[tr.id]) : <span className="muted">{t('nicht erhoben')}</span>}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stateLabel(n: MapNode, t: T) {
  switch (n.state) {
    case 'recommended': return t('nächster Schritt');
    case 'alternative': return t('Alternative');
    case 'done': return n.result?.allMet ? t('gelöst') : t('mit Lücken');
    case 'skipped': return t('übersprungen');
    default: return t('geplant');
  }
}

function LessonFacts({ node }: { node: MapNode }) {
  const { lessonOf, view } = useStore();
  const { t, type, mode, level } = useI18n();
  const l = lessonOf(node.lessonId);
  if (!l) return null;
  const route = view ? routeOf(view.session.nodes, view.skills, view.dcc, lessonOf, node.id) : undefined;
  const pitch = route ? climbStops(route.line.stops, route.line.mountain.metres).find((s) => s.node.id === node.id) : undefined;
  return (
    <>
      <p className="facts">
        <span className="pill">{type(l.type)}</span>
        <span>{mode(l.mode)}</span>
        <span>{l.durationMin} {t('Min.')}</span>
        <span>{level(l.level)}</span>
      </p>
      {route && pitch && (
        <p className="small">
          {t('{mountain} · {metres} m · {level}. Die Meter sind dieser Übungsweg. Sie ändern das DCC nicht.', {
            mountain: route.line.mountain.name,
            metres: pitch.metres,
            level: level(pitch.level),
          })}
        </p>
      )}
    </>
  );
}

function Legend() {
  const { t } = useI18n();
  return (
    <div className="legend" aria-label={t('Legende')}>
      <span><i className="lg rec" />{t('nächster Schritt')}</span>
      <span><i className="lg alt" />{t('Alternative')}</span>
      <span><i className="lg planned" />{t('geplant')}</span>
      <span><i className="lg done" />{t('erledigt')}</span>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return <button className="linkbtn small back" onClick={onClick}><Icon name="back" size={16} />{t('Zurück zum nächsten Schritt')}</button>;
}
