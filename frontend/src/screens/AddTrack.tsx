// Adds a track to the map. Either a prepared track from the catalog (vetted sources and lessons, works without
// the AI) or an own topic (the agent plans it with the AI: criteria and sources; the learner then picks the first lesson).
// Prepared topics come first: picking from a list is easier than typing for learners new to computers.
// The goal ("Wofür?") is not asked here; the mission card asks it when the first lesson starts.
import { useEffect, useRef, useState } from 'react';
import type { DccLevel, Lesson, SessionView } from '@l45/shared';
import { api } from '../lib/api.ts';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';

const PRIOR: { level: DccLevel; label: string }[] = [
  { level: 'Grundstufe', label: 'Wenig' },
  { level: 'Mittelstufe', label: 'Etwas' },
  { level: 'Fortgeschritten', label: 'Viel' },
];
const EXAMPLES = ['Sichere Passwörter', 'Fotos vom Handy auf den Computer', 'Videoanrufe mit der Familie'];

export function AddTrack({ onClose, onAdded }: { onClose: () => void; onAdded: (nodeId?: string) => void }) {
  const { view, content, setView } = useStore();
  const [topic, setTopic] = useState('');
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
            <h2 id="add-track-title">Was möchtest du lernen?</h2>
            <p className="muted">Wähle ein Thema. Du kannst später jederzeit weitere dazunehmen.</p>
          </div>
          <button className="btn quiet small" disabled={Boolean(busy)} onClick={onClose}><Icon name="close" size={18} />Schliessen</button>
        </header>
        {error && <p className="error" role="alert">{error}</p>}

        <div className="add-grid">
          <section aria-labelledby="add-catalog">
            <h3 id="add-catalog">Fertige Themen</h3>
            {catalog.length === 0 && <p className="small muted">Du hast schon alle fertigen Themen auf deiner Karte.</p>}
            {catalog.map(({ skill, open }) => (
              <div key={skill.id} className="catalog-skill">
                <div className="catalog-head">
                  <h4>{skill.name}</h4>
                  {open.length > 1 && (
                    <button className="linkbtn small" disabled={Boolean(busy)} onClick={() => add(open.map((t) => t.id))}>Alle nehmen</button>
                  )}
                </div>
                <ul className="catalog">
                  {open.map((t) => (
                    <li key={t.id}>
                      <button className="choice" disabled={Boolean(busy)} onClick={() => add([t.id])}>
                        <strong>{t.name}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section aria-labelledby="add-own">
            <h3 id="add-own">Eigenes Thema</h3>
            {!view.canCreateTracks ? (
              <p className="small muted">Eigene Themen gehen nur mit KI. Gerade ist keine KI verbunden. Wähle bitte ein fertiges Thema.</p>
            ) : (
              <form className="add-own" onSubmit={(e) => {
                e.preventDefault();
                run('own', () => api.createTrack(sessionId, { topic, selfLevel: prior, deferLesson: true }));
              }}>
                <label className="field">
                  <span>Worüber möchtest du etwas lernen?</span>
                  <input type="text" value={topic} maxLength={120} placeholder="z. B. Sichere Passwörter" onChange={(e) => setTopic(e.target.value)} disabled={Boolean(busy)} />
                </label>
                <div className="chips" aria-label="Beispiele">
                  {EXAMPLES.map((x) => <button key={x} type="button" className="chip" disabled={Boolean(busy)} onClick={() => setTopic(x)}>{x}</button>)}
                </div>
                <fieldset className="prior">
                  <legend>Wie viel weisst du schon darüber?</legend>
                  <div className="seg" role="radiogroup" aria-label="Vorwissen">
                    {PRIOR.map((p) => (
                      <button key={p.level} type="button" role="radio" aria-checked={prior === p.level} disabled={Boolean(busy)} onClick={() => setPrior(p.level)}>{p.label}</button>
                    ))}
                  </div>
                </fieldset>
                <button className="btn primary big" disabled={topic.trim().length < 3 || Boolean(busy)}><Icon name="sparkle" size={20} />Los geht's</button>
                {busy === 'own' && (
                  <p className="planning" role="status"><span className="dot-pulse" aria-hidden="true" />Die KI plant «{topic.trim()}» für dich. Danach wählst du deine erste Lektion.</p>
                )}
                <p className="small muted">Die KI bekommt nur dein Thema, nicht deinen Namen.</p>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
