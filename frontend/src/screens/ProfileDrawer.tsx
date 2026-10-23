// Profile and history: the areas kept apart. Diagnostics (DCC, read-only), learning (history, teaching
// workspace, Lernstand), transfer.
import { useEffect, useRef, useState } from 'react';
import type { Mission, SessionView, Track } from '@l45/shared';
import { LERNSTAND_LABEL, RECORD_KIND_LABEL, SOURCE_LABEL } from '@l45/shared';
import { MISSION_PRIVACY } from '../lessons/MissionCard.tsx';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.tsx';

const time = (iso: string) => new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
const date = (iso: string) => new Date(iso).toLocaleDateString('de-CH');

/** Changing a mission takes two steps: write, then confirm. Only then the agent uses it. */
function MissionRow({ track, mission, onSave }: { track: Track; mission?: Mission; onSave: (text: string, confirm: boolean) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState(mission?.text ?? '');
  const reset = () => {
    setEditing(false);
    setConfirming(false);
    setText(mission?.text ?? '');
  };
  const next = async () => {
    if (mission) setConfirming(true);
    else if (await onSave(text, false)) reset();
  };
  return (
    <li>
      <div className="meta">
        <strong>{track.name}</strong>
        {mission?.status === 'default' && <span>Standard (übersprungen)</span>}
        {!mission && <span>noch offen</span>}
      </div>
      {!editing ? (
        <p>
          {mission?.text ?? <span className="muted">Wird beim ersten Start einer Lektion gefragt.</span>}{' '}
          <button className="linkbtn small" onClick={() => setEditing(true)}>{mission ? 'Ändern' : 'Festlegen'}</button>
        </p>
      ) : (
        <div className="mission-edit">
          <textarea rows={2} maxLength={300} value={text} disabled={confirming} onChange={(e) => setText(e.target.value)} aria-label={`Mission für ${track.name}`} />
          {confirming ? (
            <div className="row">
              <span className="small">Neue Mission übernehmen? Der Agent plant ab jetzt danach.</span>
              <button className="btn primary small" onClick={async () => { if (await onSave(text, true)) reset(); }}>Ja, ändern</button>
              <button className="btn quiet small" onClick={() => setConfirming(false)}>Zurück</button>
            </div>
          ) : (
            <div className="row">
              <button className="btn secondary small" disabled={text.trim().length < 3 || text.trim() === mission?.text} onClick={next}>Weiter</button>
              <button className="btn quiet small" onClick={reset}>Abbrechen</button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Records({ view, tname }: { view: SessionView; tname: (id: string) => string }) {
  const { records } = view.workspace;
  if (!records.length) return <p className="muted small">Noch keine. Ein Eintrag entsteht erst, wenn du etwas ohne Hilfe gezeigt hast. Behandelt ist nicht gelernt.</p>;
  const item = (r: (typeof records)[number]) => (
    <li key={r.id} className={r.status === 'active' ? '' : 'outdated'}>
      <div className="meta">
        <strong>{r.id}</strong>
        <span>{RECORD_KIND_LABEL[r.kind]}</span>
        <span>{tname(r.trackId)}</span>
        <span>{r.author === 'agent' ? 'vom Agenten' : 'nach Regel'}</span>
        {r.status !== 'active' && <span>{r.status.replace('superseded by', 'ersetzt durch')}</span>}
      </div>
      <p><strong>{r.title}</strong> {r.body}</p>
      <p className="small muted">Belege: {r.evidence.join(', ')}</p>
    </li>
  );
  const old = records.filter((r) => r.status !== 'active');
  return (
    <>
      <ul className="log">{records.filter((r) => r.status === 'active').map(item)}</ul>
      {old.length > 0 && (
        <>
          <h4>Ersetzt</h4>
          <ul className="log">{old.map(item)}</ul>
        </>
      )}
    </>
  );
}

export function ProfileDrawer({ onClose }: { onClose: () => void }) {
  const { view, setView, content } = useStore();
  const [minutes, setMinutes] = useState(String(view?.session.timeBudgetMin ?? 15));
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!view || !content) return null;
  const { session, dcc } = view;
  const ws = view.workspace;
  const tracks = content.skills.flatMap((s) => s.tracks);
  const tname = (id: string) => tracks.find((t) => t.id === id)?.name ?? id;
  const node = (id: string) => session.nodes.find((n) => n.id === id);

  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      setView(await api.patch(session.id, body));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveMission = async (trackId: string, text: string, confirm: boolean) => {
    setError(null);
    try {
      setView(await api.mission(session.id, trackId, { text, confirm }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Profil und Verlauf" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <header className="overlay-head">
          <h2>Profil und Verlauf</h2>
          <button className="btn quiet" onClick={onClose}>Schliessen</button>
        </header>
        {error && <p className="error">{error}</p>}

        <section>
          <h3>DCC-Profil</h3>
          <p className="small muted">Nur aus dem DCC. Lernen in dieser App verändert diese Werte nicht.</p>
          <table className="levels">
            <tbody>
              {content.skills.filter((s) => s.dccBased).flatMap((s) => s.tracks).map((t) => (
                <tr key={t.id}><td>{t.dccArea} {t.name}</td><td>{dcc.levels[t.id] ?? <span className="muted">nicht erhoben</span>}</td></tr>
              ))}
            </tbody>
          </table>
          {ws.dccSnapshots.length > 1 && (
            <p className="small muted">
              DCC-Stände: {ws.dccSnapshots.map((d) => `${date(d.at)} (${d.source === 'file' ? d.fileName ?? 'Datei' : 'von Hand'})`).join(', ')}. Es gilt der neueste.
            </p>
          )}
        </section>

        <section>
          <h3>Lernstand (aus dem Lernen, kein DCC)</h3>
          <p className="small muted">Aus deinen Lerneinträgen. «unbekannt» heisst: noch keine Belege, nicht: schwach. Die DCC-Stufen oben bleiben davon unberührt.</p>
          {tracks.map((t) => {
            const stand = ws.lernstand.filter((l) => l.trackId === t.id);
            const known = stand.filter((l) => l.state !== 'unbekannt').length;
            return (
              <details key={t.id} className="lernstand-track">
                <summary>{t.name} <span className="muted small">({known} von {stand.length} mit Belegen)</span></summary>
                <ul className="lernstand">
                  {stand.map((l) => (
                    <li key={l.criterion}>
                      <span className="grow">{t.criteria.find((c) => c.id === l.criterion)?.label ?? l.criterion}</span>
                      <span className={`ls ${l.state}`}>{LERNSTAND_LABEL[l.state]}</span>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </section>

        <section>
          <h3>Mission pro Bereich</h3>
          <p className="small muted">{MISSION_PRIVACY}</p>
          <ul className="log">
            {tracks.map((t) => {
              const m = ws.missions.find((x) => x.trackId === t.id);
              return <MissionRow key={`${t.id}-${m?.updatedAt ?? ''}`} track={t} mission={m} onSave={(text, confirm) => saveMission(t.id, text, confirm)} />;
            })}
          </ul>
        </section>

        <section>
          <h3>Lerneinträge</h3>
          <Records view={view} tname={tname} />
        </section>

        <section>
          <h3>Merkblatt</h3>
          {tracks.every((t) => !ws.reference[t.id]?.length) ? <p className="muted small">Wächst mit dem, was du ohne Hilfe zeigst.</p> : (
            tracks.filter((t) => ws.reference[t.id]?.length).map((t) => (
              <div key={t.id} className="merkblatt">
                <h4>{t.name}</h4>
                <ul>
                  {ws.reference[t.id].map((e) => (
                    <li key={`${e.section}-${e.title}`}><strong>{e.title}{e.section === 'term' ? ' (Begriff)' : ''}:</strong> {e.text}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {ws.notes.length > 0 && (
            <>
              <h4>Notizen des Agenten zu deinen Vorlieben</h4>
              <ul className="log">{ws.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </>
          )}
        </section>

        <section>
          <h3>Einstellungen</h3>
          <form className="row" onSubmit={(e) => { e.preventDefault(); patch({ timeBudgetMin: Number(minutes) }); }}>
            <label className="field grow">
              <span>Zeit für heute in Minuten ({session.usedMin} verbraucht)</span>
              <input type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </label>
            <button className="btn secondary">Übernehmen</button>
          </form>
          <label className="switch">
            <input type="checkbox" checked={session.simulation} onChange={(e) => patch({ simulation: e.target.checked })} />
            <span>KI-Verbindung für die Demo trennen (vorbereitete Inhalte, gekennzeichnet)</span>
          </label>
        </section>

        <section>
          <h3>Entscheidungen des Agenten</h3>
          <ul className="log">
            {[...session.recommendations].reverse().map((r) => (
              <li key={r.id}>
                <div className="meta"><span>{time(r.createdAt)}</span><strong>{r.ruleId} {r.ruleName}</strong><span>{r.status === 'open' ? 'offen' : r.status === 'accepted' ? 'angenommen' : 'abgelehnt'}</span></div>
                <p>{node(r.nodeId)?.label ?? 'Für heute fertig'}{r.alternativeNodeId ? `. Alternative: ${node(r.alternativeNodeId)?.label}` : ''}</p>
                <p className="small muted">{r.observation} {r.tags.map((t) => SOURCE_LABEL[t]).join(', ')}</p>
                {r.basedOn?.length ? <p className="small muted">Gestützt auf: {r.basedOn.join(', ')}</p> : null}
              </li>
            ))}
          </ul>
          {session.plannerRuns.length > 0 && (
            <>
              <h4>Läufe des Planer-Agenten</h4>
              <ul className="log">
                {[...session.plannerRuns].reverse().map((r) => (
                  <li key={r.id}>
                    <div className="meta">
                      <span>{time(r.startedAt)}</span>
                      <span>{tname(r.trackId)}</span>
                      <strong>{r.outcome === 'accepted' ? 'Plan übernommen' : r.outcome === 'running' ? 'läuft' : 'Plan nach Regeln'}</strong>
                      <span>{r.steps} Schritte</span>
                    </div>
                    <p className="small">{r.note}</p>
                    {r.tools.length > 0 && <p className="small muted">Werkzeuge: {r.tools.join(', ')}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section>
          <h3>Lernverlauf</h3>
          {session.events.length === 0 ? <p className="muted small">Noch keine Lektion abgeschlossen.</p> : (
            <ul className="log">
              {[...session.events].reverse().map((e) => (
                <li key={e.id}>
                  <div className="meta"><span>{date(e.at)} {time(e.at)}</span><span>{tname(e.trackId)}</span>{e.helpUsed && <span>mit Hinweis</span>}<span>{e.id}</span></div>
                  <p><strong>{node(e.nodeId)?.label}</strong>: {e.result.summary}</p>
                </li>
              ))}
            </ul>
          )}
          {session.observations.length > 0 && (
            <>
              <h4>Beobachtungen</h4>
              <ul className="log">
                {session.observations.map((o) => (
                  <li key={o.id} className={o.status}>{o.text} ({tname(o.trackId)}){o.status === 'outdated' ? ', überholt' : ''}</li>
                ))}
              </ul>
            </>
          )}
          <p className="small muted">KI-Aufrufe in dieser Sitzung: {session.modelCalls.length}, davon {session.modelCalls.filter((c) => c.fallback).length} mit Rückfall auf vorbereitete Inhalte oder Regeln.</p>
        </section>

        <section>
          <h3>Transfer in den Arbeitsalltag</h3>
          {session.transfer.length === 0 ? <p className="muted small">Nach jeder Lektion erscheint hier ein Hinweis für die Arbeit.</p> : (
            <ul className="log">
              {[...session.transfer].reverse().map((t, i) => <li key={i}><strong>{t.lessonTitle}:</strong> {t.text}</li>)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
