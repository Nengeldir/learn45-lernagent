// Profile and history: the three areas kept apart. Diagnostics (DCC, read-only), learning (history), transfer.
import { useEffect, useRef, useState } from 'react';
import { SOURCE_LABEL } from '@l45/shared';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.tsx';

const time = (iso: string) => new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

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
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>Lernverlauf</h3>
          {session.events.length === 0 ? <p className="muted small">Noch keine Lektion abgeschlossen.</p> : (
            <ul className="log">
              {[...session.events].reverse().map((e) => (
                <li key={e.id}>
                  <div className="meta"><span>{time(e.at)}</span><span>{tname(e.trackId)}</span>{e.helpUsed && <span>mit Hinweis</span>}</div>
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
          <p className="small muted">KI-Aufrufe: {session.modelCalls.length}, davon {session.modelCalls.filter((c) => c.fallback).length} mit Rückfall auf vorbereitete Inhalte.</p>
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
