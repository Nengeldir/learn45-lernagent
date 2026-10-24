// Settings, in tabs that keep the areas apart: general settings and account, the profile (DCC read-only,
// Lernstand, missions), what was learned (records, Merkblatt, history, transfer) and the agent's decisions.
import { useEffect, useRef, useState } from 'react';
import type { Mission, SessionView, Track } from '@l45/shared';
import { LERNSTAND_LABEL, RECORD_KIND_LABEL, SOURCE_LABEL } from '@l45/shared';
import { MISSION_PRIVACY } from '../lessons/MissionCard.tsx';
import { api } from '../lib/api.ts';
import { Icon, type IconName } from '../lib/icons.tsx';
import { localeOf, useI18n } from '../lib/i18n.tsx';
import { useStore } from '../lib/store.tsx';

const time = (iso: string) => new Date(iso).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' });
const date = (iso: string) => new Date(iso).toLocaleDateString(localeOf());

export const STATUS: Record<string, string> = { online: 'KI an', offline: 'Ohne KI', simulation: 'KI simuliert aus' };

type Tab = 'general' | 'profile' | 'learning' | 'agent';
const TABS: { id: Tab; label: string; icon: IconName; intro: string }[] = [
  { id: 'general', label: 'Allgemein', icon: 'settings', intro: 'KI-Verbindung und Konto.' },
  { id: 'profile', label: 'Profil', icon: 'user', intro: 'DCC-Profil, Lernstand und deine Missionen.' },
  { id: 'learning', label: 'Lernen', icon: 'book', intro: 'Was du gezeigt und erledigt hast.' },
  { id: 'agent', label: 'Agent', icon: 'agent', intro: 'Wie der Agent entschieden hat und warum.' },
];

/** Changing a mission takes two steps: write, then confirm. Only then the agent uses it. */
function MissionRow({ track, mission, onSave }: { track: Track; mission?: Mission; onSave: (text: string, confirm: boolean) => Promise<boolean> }) {
  const { t, trackName } = useI18n();
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
        <strong>{trackName(track.id, track.name)}</strong>
        {mission?.status === 'default' && <span>{t('Standard (übersprungen)')}</span>}
        {!mission && <span>{t('noch offen')}</span>}
      </div>
      {!editing ? (
        <p>
          {mission?.text ? t(mission.text) : <span className="muted">{t('Wird beim ersten Start einer Lektion gefragt.')}</span>}{' '}
          <button className="linkbtn small" onClick={() => setEditing(true)}>{mission ? t('Ändern') : t('Festlegen')}</button>
        </p>
      ) : (
        <div className="mission-edit">
          <textarea rows={2} maxLength={300} value={text} disabled={confirming} onChange={(e) => setText(e.target.value)} aria-label={t('Mission für {name}', { name: trackName(track.id, track.name) })} />
          {confirming ? (
            <div className="row">
              <span className="small">{t('Neue Mission übernehmen? Der Agent plant ab jetzt danach.')}</span>
              <button className="btn primary small" onClick={async () => { if (await onSave(text, true)) reset(); }}>{t('Ja, ändern')}</button>
              <button className="btn quiet small" onClick={() => setConfirming(false)}>{t('Zurück')}</button>
            </div>
          ) : (
            <div className="row">
              <button className="btn secondary small" disabled={text.trim().length < 3 || text.trim() === mission?.text} onClick={next}>{t('Weiter')}</button>
              <button className="btn quiet small" onClick={reset}>{t('Abbrechen')}</button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Records({ view, tname }: { view: SessionView; tname: (id: string) => string }) {
  const { t } = useI18n();
  const { records } = view.workspace;
  if (!records.length) return <p className="muted small">{t('Noch keine. Ein Eintrag entsteht erst, wenn du etwas ohne Hilfe gezeigt hast. Behandelt ist nicht gelernt.')}</p>;
  const item = (r: (typeof records)[number]) => (
    <li key={r.id} className={r.status === 'active' ? '' : 'outdated'}>
      <div className="meta">
        <strong>{r.id}</strong>
        <span>{t(RECORD_KIND_LABEL[r.kind])}</span>
        <span>{tname(r.trackId)}</span>
        <span>{r.author === 'agent' ? t('vom Agenten') : t('nach Regel')}</span>
        {r.status !== 'active' && <span>{r.status.replace('superseded by', t('ersetzt durch'))}</span>}
      </div>
      <p><strong>{r.title}</strong> {r.body}</p>
      <p className="small muted">{t('Belege:')} {r.evidence.join(', ')}</p>
    </li>
  );
  const old = records.filter((r) => r.status !== 'active');
  return (
    <>
      <ul className="log">{records.filter((r) => r.status === 'active').map(item)}</ul>
      {old.length > 0 && (
        <>
          <h5>{t('Ersetzt')}</h5>
          <ul className="log">{old.map(item)}</ul>
        </>
      )}
    </>
  );
}

export function Settings({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const { view, setView, content } = useStore();
  const { t, level, trackName, nodeLabel } = useI18n();
  const [tab, setTab] = useState<Tab>('general');
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
  // The learner's tracks: prepared ones they added and their own. The DCC table lists the whole DCC.
  const tracks = view.skills.flatMap((s) => s.tracks);
  const tname = (id: string) => {
    const tk = tracks.find((x) => x.id === id);
    return tk ? trackName(tk.id, tk.name) : id;
  };
  const node = (id: string) => session.nodes.find((n) => n.id === id);
  const label = (id: string) => {
    const n = node(id);
    return n ? nodeLabel(n) : undefined;
  };
  const current = TABS.find((tk) => tk.id === tab)!;

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

  // Arrow keys move between tabs, as in a native tab list.
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((tk) => tk.id === tab);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length].id;
    setTab(next);
    document.getElementById(`settings-tab-${next}`)?.focus();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label={t('Bereiche der Einstellungen')} onKeyDown={onTabKey}>
          <h2 id="settings-title">{t('Einstellungen')}</h2>
          {TABS.map((tk) => (
            <button
              key={tk.id}
              id={`settings-tab-${tk.id}`}
              role="tab"
              aria-selected={tab === tk.id}
              aria-controls="settings-panel"
              tabIndex={tab === tk.id ? 0 : -1}
              onClick={() => setTab(tk.id)}
            >
              <Icon name={tk.icon} />{t(tk.label)}
            </button>
          ))}
        </nav>

        <div className="settings-body" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
          <header className="settings-head">
            <div>
              <h3>{t(current.label)}</h3>
              <p className="small muted">{t(current.intro)}</p>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label={t('Schliessen')}><Icon name="close" size={20} /></button>
          </header>
          {error && <p className="error" role="alert">{t(error)}</p>}

          {tab === 'general' && (
            <>
              <section>
                <h4>{t('KI')}</h4>
                <div className="setting-group">
                  <div className="setting-row">
                    <div className="text">
                      <strong>{t('Status')}</strong>
                      <span>{t('Ohne KI kommen Gesprächsantworten und Hinweise aus vorbereiteten Texten.')}</span>
                    </div>
                    <span className={`status ${view.modelStatus}`}>{t(STATUS[view.modelStatus] ?? '')}</span>
                  </div>
                  <label className="setting-row switch">
                    <span className="text">
                      <strong>{t('KI-Verbindung für die Demo trennen')}</strong>
                      <span>{t('Die App nutzt dann vorbereitete Inhalte und kennzeichnet sie.')}</span>
                    </span>
                    <input type="checkbox" role="switch" checked={session.simulation} onChange={(e) => patch({ simulation: e.target.checked })} />
                  </label>
                </div>
              </section>
              <section>
                <h4>{t('Konto')}</h4>
                <div className="setting-group">
                  <div className="setting-row">
                    <div className="row">
                      <span className="avatar" aria-hidden="true">{session.userName.slice(0, 1).toUpperCase()}</span>
                      <div className="text">
                        <strong>{session.userName}</strong>
                        <span>{t('Sitzung {n} · seit {date}', { n: session.sessionNo, date: date(session.createdAt) })}</span>
                      </div>
                    </div>
                    <button className="btn secondary small" onClick={onLogout}><Icon name="logout" size={16} />{t('Abmelden')}</button>
                  </div>
                </div>
                <div className="stats">
                  <div><strong>{session.events.length}</strong><span>{t('Lektionen erledigt')}</span></div>
                  <div><strong>{tracks.length}</strong><span>{t('Bereiche')}</span></div>
                  <div><strong>{ws.records.filter((r) => r.status === 'active').length}</strong><span>{t('Lerneinträge')}</span></div>
                </div>
                <p className="small muted">{t('Prototyp für Learn45. Anmeldung ohne Passwort, nur erfundene Daten.')}</p>
              </section>
            </>
          )}

          {tab === 'profile' && (
            <>
              <section>
                <h4>{t('DCC-Profil')}</h4>
                <p className="small muted">{t('Nur aus dem DCC. Lernen in dieser App verändert diese Werte nicht.')}</p>
                <div className="setting-group">
                  <table className="levels">
                    <tbody>
                      {content.skills.filter((s) => s.dccBased).flatMap((s) => s.tracks).map((tk) => (
                        <tr key={tk.id}><td>{tk.dccArea} {trackName(tk.id, tk.name)}</td><td>{dcc.levels[tk.id] ? level(dcc.levels[tk.id]) : <span className="muted">{t('nicht erhoben')}</span>}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ws.dccSnapshots.length > 1 && (
                  <p className="small muted">
                    {t('DCC-Stände:')} {ws.dccSnapshots.map((d) => `${date(d.at)} (${d.source === 'file' ? d.fileName ?? t('Datei') : t('von Hand')})`).join(', ')}. {t('Es gilt der neueste.')}
                  </p>
                )}
              </section>

              <section>
                <h4>{t('Lernstand (aus dem Lernen, kein DCC)')}</h4>
                <p className="small muted">{t('Aus deinen Lerneinträgen. «unbekannt» heisst: noch keine Belege, nicht: schwach. Die DCC-Stufen oben bleiben davon unberührt.')}</p>
                {tracks.length === 0 && <p className="small muted">{t('Noch keine Bereiche auf deiner Karte.')}</p>}
                <div>
                  {tracks.map((tk) => {
                    const stand = ws.lernstand.filter((l) => l.trackId === tk.id);
                    const known = stand.filter((l) => l.state !== 'unbekannt').length;
                    return (
                      <details key={tk.id} className="lernstand-track">
                        <summary>{trackName(tk.id, tk.name)} <span className="muted small">({t('{known} von {total} mit Belegen', { known, total: stand.length })})</span></summary>
                        <ul className="lernstand">
                          {stand.map((l) => (
                            <li key={l.criterion}>
                              <span className="grow">{tk.criteria.find((c) => c.id === l.criterion)?.label ?? l.criterion}</span>
                              <span className={`ls ${l.state}`}>{t(LERNSTAND_LABEL[l.state])}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    );
                  })}
                </div>
              </section>

              <section>
                <h4>{t('Mission pro Bereich')}</h4>
                <p className="small muted">{t(MISSION_PRIVACY)}</p>
                {tracks.length === 0 && <p className="small muted">{t('Eine Mission gehört zu einem Bereich. Füge zuerst einen hinzu.')}</p>}
                <ul className="log">
                  {tracks.map((tk) => {
                    const m = ws.missions.find((x) => x.trackId === tk.id);
                    return <MissionRow key={`${tk.id}-${m?.updatedAt ?? ''}`} track={tk} mission={m} onSave={(text, confirm) => saveMission(tk.id, text, confirm)} />;
                  })}
                </ul>
              </section>
            </>
          )}

          {tab === 'learning' && (
            <>
              <section>
                <h4>{t('Lerneinträge')}</h4>
                <Records view={view} tname={tname} />
              </section>

              <section>
                <h4>{t('Merkblatt')}</h4>
                {tracks.every((tk) => !ws.reference[tk.id]?.length) ? <p className="muted small">{t('Wächst mit dem, was du ohne Hilfe zeigst.')}</p> : (
                  tracks.filter((tk) => ws.reference[tk.id]?.length).map((tk) => (
                    <div key={tk.id} className="merkblatt">
                      <h5>{trackName(tk.id, tk.name)}</h5>
                      <ul>
                        {ws.reference[tk.id].map((e) => (
                          <li key={`${e.section}-${e.title}`}><strong>{e.title}{e.section === 'term' ? ` (${t('Begriff')})` : ''}:</strong> {e.text}</li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
                {ws.notes.length > 0 && (
                  <>
                    <h5>{t('Notizen des Agenten zu deinen Vorlieben')}</h5>
                    <ul className="log">{ws.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                  </>
                )}
              </section>

              <section>
                <h4>{t('Lernverlauf')}</h4>
                {session.events.length === 0 ? <p className="muted small">{t('Noch keine Lektion abgeschlossen.')}</p> : (
                  <ul className="log">
                    {[...session.events].reverse().map((e) => (
                      <li key={e.id}>
                        <div className="meta"><span>{date(e.at)} {time(e.at)}</span><span>{tname(e.trackId)}</span>{e.helpUsed && <span>{t('mit Hinweis')}</span>}<span>{e.id}</span></div>
                        <p><strong>{label(e.nodeId)}</strong>: {e.result.summary}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {session.observations.length > 0 && (
                  <>
                    <h5>{t('Beobachtungen')}</h5>
                    <ul className="log">
                      {session.observations.map((o) => (
                        <li key={o.id} className={o.status}>{o.text} ({tname(o.trackId)}){o.status === 'outdated' ? t(', überholt') : ''}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <section>
                <h4>{t('Transfer in den Arbeitsalltag')}</h4>
                {session.transfer.length === 0 ? <p className="muted small">{t('Nach jeder Lektion erscheint hier ein Hinweis für die Arbeit.')}</p> : (
                  <ul className="log">
                    {[...session.transfer].reverse().map((tk, i) => <li key={i}><strong>{tk.lessonTitle}:</strong> {tk.text}</li>)}
                  </ul>
                )}
              </section>
            </>
          )}

          {tab === 'agent' && (
            <>
              <section>
                <h4>{t('Entscheidungen des Agenten')}</h4>
                {session.recommendations.length === 0 && <p className="muted small">{t('Noch keine. Füge einen Bereich hinzu.')}</p>}
                <ul className="log">
                  {[...session.recommendations].reverse().map((r) => (
                    <li key={r.id}>
                      <div className="meta"><span>{time(r.createdAt)}</span><strong>{r.ruleId} {t(r.ruleName)}</strong><span>{t(r.status === 'open' ? 'offen' : r.status === 'accepted' ? 'angenommen' : 'abgelehnt')}</span></div>
                      <p>{label(r.nodeId) ?? t('Kein nächster Schritt')}{r.alternativeNodeId ? `. ${t('Alternative')}: ${label(r.alternativeNodeId)}` : ''}</p>
                      <p className="small muted">{t(r.observation)} {r.tags.map((tk) => t(SOURCE_LABEL[tk])).join(', ')}</p>
                      {r.basedOn?.length ? <p className="small muted">{t('Gestützt auf:')} {r.basedOn.join(', ')}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
              {session.plannerRuns.length > 0 && (
                <section>
                  <h4>{t('Läufe des Planer-Agenten')}</h4>
                  <ul className="log">
                    {[...session.plannerRuns].reverse().map((r) => (
                      <li key={r.id}>
                        <div className="meta">
                          <span>{time(r.startedAt)}</span>
                          <span>{tname(r.trackId)}</span>
                          <strong>{t(r.outcome === 'accepted' ? 'Plan übernommen' : r.outcome === 'running' ? 'läuft' : 'Plan nach Regeln')}</strong>
                          <span>{t('{n} Schritte', { n: r.steps })}</span>
                        </div>
                        <p className="small">{r.note}</p>
                        {r.tools.length > 0 && <p className="small muted">{t('Werkzeuge:')} {r.tools.join(', ')}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="small muted">{t('KI-Aufrufe in dieser Sitzung: {calls}, davon {fallback} mit Rückfall auf vorbereitete Inhalte oder Regeln.', { calls: session.modelCalls.length, fallback: session.modelCalls.filter((c) => c.fallback).length })}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
