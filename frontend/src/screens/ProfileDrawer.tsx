// Profile and history: the three areas kept apart. Diagnostics (DCC, read-only), learning (history), transfer.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { localeOf, useI18n } from '../lib/i18n.tsx';
import { useStore } from '../lib/store.tsx';

const clock = (iso: string) => new Date(iso).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' });

export function ProfileDrawer({ onClose }: { onClose: () => void }) {
  const { view, setView, content } = useStore();
  const { t, level, source, trackName, lessonTitle } = useI18n();
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
  const tname = (id: string) => trackName(id, tracks.find((tr) => tr.id === id)?.name ?? id);
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
      <div className="drawer" role="dialog" aria-modal="true" aria-label={t('Profil und Verlauf')} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <header className="overlay-head">
          <h2>{t('Profil und Verlauf')}</h2>
          <button className="btn quiet" onClick={onClose}>{t('Schliessen')}</button>
        </header>
        {error && <p className="error">{error}</p>}

        <section>
          <h3>{t('DCC-Profil')}</h3>
          <p className="small muted">{t('Nur aus dem DCC. Lernen in dieser App verändert diese Werte nicht.')}</p>
          <table className="levels">
            <tbody>
              {content.skills.filter((s) => s.dccBased).flatMap((s) => s.tracks).map((tr) => (
                <tr key={tr.id}><td>{tr.dccArea} {trackName(tr.id, tr.name)}</td><td>{dcc.levels[tr.id] ? level(dcc.levels[tr.id]) : <span className="muted">{t('nicht erhoben')}</span>}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3>{t('Einstellungen')}</h3>
          <form className="row" onSubmit={(e) => { e.preventDefault(); patch({ timeBudgetMin: Number(minutes) }); }}>
            <label className="field grow">
              <span>{t('Zeit für heute in Minuten ({used} verbraucht)', { used: session.usedMin })}</span>
              <input type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </label>
            <button className="btn secondary">{t('Übernehmen')}</button>
          </form>
          <label className="switch">
            <input type="checkbox" checked={session.simulation} onChange={(e) => patch({ simulation: e.target.checked })} />
            <span>{t('KI-Verbindung für die Demo trennen (vorbereitete Inhalte, gekennzeichnet)')}</span>
          </label>
        </section>

        <section>
          <h3>{t('Entscheidungen des Agenten')}</h3>
          <ul className="log">
            {[...session.recommendations].reverse().map((r) => (
              <li key={r.id}>
                <div className="meta"><span>{clock(r.createdAt)}</span><strong>{r.ruleId} {r.ruleName}</strong><span>{r.status === 'open' ? t('offen') : r.status === 'accepted' ? t('angenommen') : t('abgelehnt')}</span></div>
                <p>{node(r.nodeId) ? lessonTitle(node(r.nodeId)?.lessonId, node(r.nodeId)!.label) : t('Für heute fertig')}{r.alternativeNodeId ? `. ${t('Alternative')}: ${lessonTitle(node(r.alternativeNodeId)?.lessonId, node(r.alternativeNodeId)?.label ?? '')}` : ''}</p>
                <p className="small muted">{r.observation} {r.tags.map((tag) => source(tag)).join(', ')}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>{t('Lernverlauf')}</h3>
          {session.events.length === 0 ? <p className="muted small">{t('Noch keine Lektion abgeschlossen.')}</p> : (
            <ul className="log">
              {[...session.events].reverse().map((e) => (
                <li key={e.id}>
                  <div className="meta"><span>{clock(e.at)}</span><span>{tname(e.trackId)}</span>{e.helpUsed && <span>{t('mit Hinweis')}</span>}</div>
                  <p><strong>{lessonTitle(node(e.nodeId)?.lessonId, node(e.nodeId)?.label ?? '')}</strong>: {e.result.summary}</p>
                </li>
              ))}
            </ul>
          )}
          {session.observations.length > 0 && (
            <>
              <h4>{t('Beobachtungen')}</h4>
              <ul className="log">
                {session.observations.map((o) => (
                  <li key={o.id} className={o.status}>{o.text} ({tname(o.trackId)}){o.status === 'outdated' ? t(', überholt') : ''}</li>
                ))}
              </ul>
            </>
          )}
          <p className="small muted">{t('KI-Aufrufe: {calls}, davon {fallback} mit Rückfall auf vorbereitete Inhalte.', { calls: session.modelCalls.length, fallback: session.modelCalls.filter((c) => c.fallback).length })}</p>
        </section>

        <section>
          <h3>{t('Transfer in den Arbeitsalltag')}</h3>
          {session.transfer.length === 0 ? <p className="muted small">{t('Nach jeder Lektion erscheint hier ein Hinweis für die Arbeit.')}</p> : (
            <ul className="log">
              {[...session.transfer].reverse().map((item, i) => <li key={i}><strong>{lessonTitle(undefined, item.lessonTitle)}:</strong> {item.text}</li>)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
