// Side panel next to the map: the agent's next step with its reasons, or details of a selected node.
import type { MapNode, Recommendation, SessionView } from '@l45/shared';
import { localeOf, useI18n } from '../lib/i18n.tsx';
import { useStore } from '../lib/store.tsx';
import { buildLines, climbStops, routeOf } from './subwayLayout.ts';

function Reason({ rec }: { rec: Recommendation }) {
  const { t, source } = useI18n();
  return (
    <dl className="reason">
      <div><dt>{t('Was der Agent gesehen hat')}</dt><dd>{rec.observation}</dd></div>
      <div><dt>{t('Vorschlag')}</dt><dd>{rec.reason}</dd></div>
      <div><dt>{t('Warum das jetzt hilft')}</dt><dd>{rec.why}</dd></div>
      <div>
        <dt>{t('Regel')}</dt>
        <dd>
          {rec.ruleId} {rec.ruleName}{' '}
          {rec.tags.map((tag) => <span key={tag} className={`tag ${tag}`}>{source(tag)}</span>)}
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
  const { view, content, lessonOf } = useStore();
  const { t } = useI18n();
  if (!node.trackId || !view || !content) return null;
  const line = buildLines(view.session.nodes, content.skills, view.dcc, lessonOf).find((l) => l.trackId === node.trackId);
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
  view, selected, onSelect, onStart, onMoreTime, onShowMountain, onShowKnot,
}: {
  view: SessionView;
  selected: MapNode | null;
  onSelect: (id: string | null) => void;
  onStart: (nodeId: string) => void;
  onMoreTime: () => void;
  onShowMountain?: (trackId: string, nodeId?: string) => void;
  onShowKnot?: (nodeId: string) => void;
}) {
  const { lessonOf, content } = useStore();
  const { t, level, lessonTitle, trackName, skillName } = useI18n();
  const { session, recommendation: rec, dcc } = view;
  const byId = (id?: string) => session.nodes.find((n) => n.id === id);
  const recNode = byId(rec?.nodeId);
  const altNode = byId(rec?.alternativeNodeId);
  const trackOf = (id?: string) => content?.skills.flatMap((s) => s.tracks).find((tr) => tr.id === id)?.name ?? '';
  const labelOf = (n?: MapNode) => (n ? lessonTitle(n.lessonId, n.kind === 'track' ? trackName(n.trackId, n.label) : n.kind === 'skill' ? skillName(n.skillId, n.label) : n.label) : '');

  // --- Default: the next step ---
  if (!selected) {
    return (
      <div className="panel-inner">
        <p className="eyebrow-free muted small">{t('Nächster Schritt')}</p>
        {recNode && rec ? (
          <>
            <h2>{labelOf(recNode)}</h2>
            <LessonFacts node={recNode} />
            <Reason rec={rec} />
            <div className="row">
              <button className="btn primary" onClick={() => onStart(recNode.id)}>{t('Starten')}</button>
              {altNode && <button className="btn secondary" onClick={() => onSelect(altNode.id)}>{t('Alternative ansehen')}</button>}
            </div>
            <ViewLinks node={recNode} onShowMountain={onShowMountain} onShowKnot={onShowKnot} />
          </>
        ) : (
          <>
            <h2>{t('Für heute fertig')}</h2>
            {rec && <Reason rec={rec} />}
            <button className="btn secondary" onClick={onMoreTime}>{t('10 Minuten mehr')}</button>
          </>
        )}
        <Legend />
      </div>
    );
  }

  const lesson = lessonOf(selected.lessonId);

  if (selected.kind === 'lesson' && lesson) {
    const isRec = selected.state === 'recommended';
    const isAlt = selected.state === 'alternative';
    return (
      <div className="panel-inner">
        <button className="linkbtn small" onClick={() => onSelect(null)}>{t('Zurück zum nächsten Schritt')}</button>
        <p className="muted small">{trackName(selected.trackId, trackOf(selected.trackId))}</p>
        <h2>{labelOf(selected)}</h2>
        <LessonFacts node={selected} />
        <p>{lesson.intro}</p>
        {selected.addedByAgent && <p className="note small">{t('Diesen Knoten hat der Agent nach deinen Ergebnissen neu hinzugefügt.')}</p>}
        {isRec && rec && <Reason rec={rec} />}
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
        <div className="row">
          <button className="btn primary" onClick={() => onStart(selected.id)}>
            {isAlt ? t('Alternative starten') : selected.state === 'done' ? t('Nochmals') : t('Starten')}
          </button>
          {isRec && altNode && <button className="btn secondary" onClick={() => onSelect(altNode.id)}>{t('Lieber etwas anderes')}</button>}
        </div>
        <ViewLinks node={selected} onShowMountain={onShowMountain} onShowKnot={onShowKnot} />
      </div>
    );
  }

  if (selected.kind === 'track') {
    const skill = content?.skills.find((s) => s.tracks.some((t) => t.id === selected.trackId));
    const lv = selected.trackId ? dcc.levels[selected.trackId] : null;
    const lessons = session.nodes.filter((n) => n.kind === 'lesson' && n.trackId === selected.trackId);
    return (
      <div className="panel-inner">
        <button className="linkbtn small" onClick={() => onSelect(null)}>{t('Zurück zum nächsten Schritt')}</button>
        <h2>{trackName(selected.trackId, selected.label)}</h2>
        <p>
          {skill?.dccBased ? (
            <>{t('DCC-Position:')} <strong>{level(lv)}</strong> <span className="muted small">{t('(aus dem DCC, wird hier nicht verändert)')}</span></>
          ) : t('Kein DCC-Bereich. Der Agent plant hier nur aus deinem Lernverlauf.')}
        </p>
        <ViewLinks node={selected} onShowMountain={onShowMountain} onShowKnot={onShowKnot} />
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
      </div>
    );
  }

  if (selected.kind === 'skill') {
    const skill = content?.skills.find((s) => s.id === selected.skillId);
    return (
      <div className="panel-inner">
        <button className="linkbtn small" onClick={() => onSelect(null)}>{t('Zurück zum nächsten Schritt')}</button>
        <h2>{skillName(selected.skillId, selected.label)}</h2>
        <p>{skill?.dccBased ? t('Die fünf Kompetenzbereiche nach DigComp 2.2. Die Stufen kommen aus deinem DCC-Profil.') : t('Zusätzlicher Bereich ohne DCC-Position. Er zeigt, dass der Lernagent auch für andere Lernziele funktioniert.')}</p>
      </div>
    );
  }

  // Start node: profile
  return (
    <div className="panel-inner">
      <button className="linkbtn small" onClick={() => onSelect(null)}>{t('Zurück zum nächsten Schritt')}</button>
      <h2>{session.userName}</h2>
      <p className="small muted">
        {t('DCC-Profil')} {dcc.source === 'file' ? t('aus «{file}»', { file: dcc.fileName ?? t('Datei') }) : t('von Hand eingegeben')}
        {dcc.assessedOn ? t(', erhoben am {date}', { date: new Date(dcc.assessedOn).toLocaleDateString(langLocale()) }) : ''}
      </p>
      <table className="levels">
        <tbody>
          {content?.skills.filter((s) => s.dccBased).flatMap((s) => s.tracks).map((tr) => (
            <tr key={tr.id}><td>{tr.dccArea} {trackName(tr.id, tr.name)}</td><td>{dcc.levels[tr.id] ? level(dcc.levels[tr.id]) : <span className="muted">{t('nicht erhoben')}</span>}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function langLocale() {
  return localeOf();
}

function stateLabel(n: MapNode, t: (de: string) => string) {
  switch (n.state) {
    case 'recommended': return t('nächster Schritt');
    case 'alternative': return t('Alternative');
    case 'done': return n.result?.allMet ? t('gelöst') : t('mit Lücken');
    case 'skipped': return t('übersprungen');
    default: return t('geplant');
  }
}

function LessonFacts({ node }: { node: MapNode }) {
  const { lessonOf, view, content } = useStore();
  const { t, type, mode, level } = useI18n();
  const l = lessonOf(node.lessonId);
  if (!l) return null;
  const route = view && content ? routeOf(view.session.nodes, content.skills, view.dcc, lessonOf, node.id) : undefined;
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
