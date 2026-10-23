// Side panel next to the map: the agent's next step with its reasons, or details of a selected node.
import type { MapNode, Recommendation, SessionView } from '@l45/shared';
import { MODE_LABEL, SOURCE_LABEL, TYPE_LABEL } from '@l45/shared';
import { useStore } from '../lib/store.tsx';

function Reason({ rec }: { rec: Recommendation }) {
  return (
    <dl className="reason">
      <div><dt>Was der Agent gesehen hat</dt><dd>{rec.observation}</dd></div>
      <div><dt>Vorschlag</dt><dd>{rec.reason}</dd></div>
      <div><dt>Warum das jetzt hilft</dt><dd>{rec.why}</dd></div>
      <div>
        <dt>Regel</dt>
        <dd>
          {rec.ruleId} {rec.ruleName}{' '}
          {rec.tags.map((t) => <span key={t} className={`tag ${t}`}>{SOURCE_LABEL[t]}</span>)}
        </dd>
      </div>
    </dl>
  );
}

export function NodePanel({
  view, selected, onSelect, onStart, onMoreTime,
}: {
  view: SessionView;
  selected: MapNode | null;
  onSelect: (id: string | null) => void;
  onStart: (nodeId: string) => void;
  onMoreTime: () => void;
}) {
  const { lessonOf, content } = useStore();
  const { session, recommendation: rec, dcc } = view;
  const byId = (id?: string) => session.nodes.find((n) => n.id === id);
  const recNode = byId(rec?.nodeId);
  const altNode = byId(rec?.alternativeNodeId);
  const trackName = (id?: string) => content?.skills.flatMap((s) => s.tracks).find((t) => t.id === id)?.name ?? '';

  // --- Default: the next step ---
  if (!selected) {
    return (
      <div className="panel-inner">
        <p className="eyebrow-free muted small">Nächster Schritt</p>
        {recNode && rec ? (
          <>
            <h2>{recNode.label}</h2>
            <LessonFacts node={recNode} />
            <Reason rec={rec} />
            <div className="row">
              <button className="btn primary" onClick={() => onStart(recNode.id)}>Starten</button>
              {altNode && <button className="btn secondary" onClick={() => onSelect(altNode.id)}>Alternative ansehen</button>}
            </div>
          </>
        ) : (
          <>
            <h2>Für heute fertig</h2>
            {rec && <Reason rec={rec} />}
            <button className="btn secondary" onClick={onMoreTime}>10 Minuten mehr</button>
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
        <button className="linkbtn small" onClick={() => onSelect(null)}>Zurück zum nächsten Schritt</button>
        <p className="muted small">{trackName(selected.trackId)}</p>
        <h2>{selected.label}</h2>
        <LessonFacts node={selected} />
        <p>{lesson.intro}</p>
        {selected.addedByAgent && <p className="note small">Diesen Knoten hat der Agent nach deinen Ergebnissen neu hinzugefügt.</p>}
        {isRec && rec && <Reason rec={rec} />}
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
    const skill = content?.skills.find((s) => s.tracks.some((t) => t.id === selected.trackId));
    const lv = selected.trackId ? dcc.levels[selected.trackId] : null;
    const lessons = session.nodes.filter((n) => n.kind === 'lesson' && n.trackId === selected.trackId);
    return (
      <div className="panel-inner">
        <button className="linkbtn small" onClick={() => onSelect(null)}>Zurück zum nächsten Schritt</button>
        <h2>{selected.label}</h2>
        <p>
          {skill?.dccBased ? (
            <>DCC-Position: <strong>{lv ?? 'nicht erhoben'}</strong> <span className="muted small">(aus dem DCC, wird hier nicht verändert)</span></>
          ) : 'Kein DCC-Bereich. Der Agent plant hier nur aus deinem Lernverlauf.'}
        </p>
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
      </div>
    );
  }

  if (selected.kind === 'skill') {
    const skill = content?.skills.find((s) => s.id === selected.skillId);
    return (
      <div className="panel-inner">
        <button className="linkbtn small" onClick={() => onSelect(null)}>Zurück zum nächsten Schritt</button>
        <h2>{selected.label}</h2>
        <p>{skill?.dccBased ? 'Die fünf Kompetenzbereiche nach DigComp 2.2. Die Stufen kommen aus deinem DCC-Profil.' : 'Zusätzlicher Bereich ohne DCC-Position. Er zeigt, dass der Lernagent auch für andere Lernziele funktioniert.'}</p>
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
