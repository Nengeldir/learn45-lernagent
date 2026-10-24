// Adds a track to the map. Either an own topic (the agent plans it with the AI: criteria, sources, a first
// lesson) or a prepared track from the catalog (vetted sources and lessons, works without the AI).
import { useEffect, useRef, useState } from 'react';
import type { DccLevel, Lesson, SessionView } from '@l45/shared';
import { api } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';

const PRIOR: { level: DccLevel; label: string }[] = [
  { level: 'Grundstufe', label: 'Keins oder wenig' },
  { level: 'Mittelstufe', label: 'Etwas' },
  { level: 'Fortgeschritten', label: 'Viel' },
];
const EXAMPLES = ['Security+ Prüfung bestehen', 'Excel-Formeln für Auswertungen', 'Spanisch für die Reise'];

export function AddTrack({ onClose, onAdded }: { onClose: () => void; onAdded: (nodeId?: string) => void }) {
  const { view, content, setView } = useStore();
  const [topic, setTopic] = useState('');
  const [goal, setGoal] = useState('');
  const [prior, setPrior] = useState<DccLevel>('Grundstufe');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  if (!view || !content) return null;
  const sessionId = view.session.id;
  const onMap = new Set(view.skills.flatMap((s) => s.tracks.map((t) => t.id)));
  const catalog = content.skills.map((s) => ({ skill: s, open: s.tracks.filter((t) => !onMap.has(t.id)) })).filter((x) => x.open.length);

  const run = async (what: string, fn: () => Promise<{ view: SessionView; generated: Lesson[]; trackId?: string }>) => {
    setBusy(what);
    setError(null);
    try {
      const r = await fn();
      setView(r.view, r.generated);
      onAdded(r.trackId ? `t-${r.trackId}` : r.view.recommendation?.nodeId || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };
  const add = (ids: string[]) => run(ids.join(','), () => api.addTracks(sessionId, ids));

  return (
    <div className="overlay" onClick={() => !busy && onClose()}>
      <div className="overlay-panel add-track" role="dialog" aria-modal="true" aria-labelledby="add-track-title" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <header className="overlay-head">
          <div>
            <h2 id="add-track-title">Was willst du lernen?</h2>
            <p className="muted">Der Agent plant nur für Bereiche, die du wählst. Du kannst später weitere hinzufügen.</p>
          </div>
          <button className="icon-btn" disabled={Boolean(busy)} onClick={onClose} aria-label="Schliessen" title="Schliessen"><Icon name="close" size={20} /></button>
        </header>
        {error && <p className="error" role="alert">{error}</p>}

        <div className="add-grid">
          <section aria-labelledby="add-own">
            <h3 id="add-own">Eigenes Thema</h3>
            <p className="small muted">Der Agent plant den Bereich mit passenden Quellen. Danach wählst du dein erstes Thema und das Format.</p>
            <form className="add-own" onSubmit={(e) => {
              e.preventDefault();
              run('own', () => api.createTrack(sessionId, { topic, goal: goal.trim() || undefined, selfLevel: prior, deferLesson: true }));
            }}>
              <label className="field">
                <span>Thema</span>
                <input type="text" value={topic} maxLength={120} placeholder="z. B. Security+ Prüfung bestehen" onChange={(e) => setTopic(e.target.value)} disabled={Boolean(busy)} />
              </label>
              <div className="chips" aria-label="Beispiele">
                {EXAMPLES.map((x) => <button key={x} type="button" className="chip" disabled={Boolean(busy)} onClick={() => setTopic(x)}>{x}</button>)}
              </div>
              <label className="field">
                <span>Wofür brauchst du es? (freiwillig, wird deine Mission)</span>
                <textarea rows={2} maxLength={300} value={goal} placeholder="Ich … und will …" onChange={(e) => setGoal(e.target.value)} disabled={Boolean(busy)} />
              </label>
              <fieldset className="prior">
                <legend>Vorwissen</legend>
                <div className="seg" role="radiogroup" aria-label="Vorwissen">
                  {PRIOR.map((p) => (
                    <button key={p.level} type="button" role="radio" aria-checked={prior === p.level} disabled={Boolean(busy)} onClick={() => setPrior(p.level)}>{p.label}</button>
                  ))}
                </div>
              </fieldset>
              <div className="row">
                <button className="btn primary" disabled={!view.canCreateTracks || topic.trim().length < 3 || Boolean(busy)}><Icon name="sparkle" size={16} />Bereich planen</button>
              </div>
              {busy === 'own' && (
                <p className="planning" role="status"><span className="dot-pulse" aria-hidden="true" />Der Agent plant «{topic.trim()}». Anschliessend wählst du Thema und Format deiner ersten Lektion.</p>
              )}
              {!view.canCreateTracks && <p className="note small">Eigene Bereiche plant der Agent mit KI. Gerade ist keine KI verbunden. Ein vorbereiteter Bereich geht auch ohne.</p>}
              <p className="small muted">An die KI gehen Thema, Wofür und Vorwissen, dein Name nicht. Die Quellen schlägt die KI vor. Behalten werden nur Adressen, die beim Anlegen erreichbar sind.</p>
            </form>
          </section>

          <section aria-labelledby="add-catalog">
            <h3 id="add-catalog">Vorbereitete Bereiche</h3>
            <p className="small muted">Mit geprüften Quellen und vorbereiteten Lektionen. Geht auch ohne KI.</p>
            {catalog.length === 0 && <p className="small muted">Alle vorbereiteten Bereiche sind schon auf deiner Karte.</p>}
            {catalog.map(({ skill, open }) => (
              <div key={skill.id} className="catalog-skill">
                <div className="catalog-head">
                  <h4>{skill.name}</h4>
                  {open.length > 1 && (
                    <button className="linkbtn small" disabled={Boolean(busy)} onClick={() => add(open.map((t) => t.id))}>Alle {open.length} hinzufügen</button>
                  )}
                </div>
                <ul className="catalog">
                  {open.map((t) => (
                    <li key={t.id}>
                      <button className="choice" disabled={Boolean(busy)} onClick={() => add([t.id])}>
                        <strong>{t.name}</strong>
                        <span className="small muted">
                          {skill.dccBased ? `DCC: ${view.dcc.levels[t.id] ?? 'nicht erhoben'}` : 'ohne DCC-Position'} · {t.criteria.length} Kriterien
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
