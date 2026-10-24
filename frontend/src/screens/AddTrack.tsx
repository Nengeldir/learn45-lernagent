// Adds a track to the map. Either an own topic (the agent plans it with the AI: criteria, sources, a first
// lesson) or a prepared track from the catalog (vetted sources and lessons, works without the AI).
import { useEffect, useRef, useState } from 'react';
import type { DccLevel, Lesson, SessionView } from '@l45/shared';
import { api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
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
  const { t, level, skillName, trackName } = useI18n();
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
  const onMap = new Set(view.skills.flatMap((s) => s.tracks.map((x) => x.id)));
  const catalog = content.skills.map((s) => ({ skill: s, open: s.tracks.filter((x) => !onMap.has(x.id)) })).filter((x) => x.open.length);

  const run = async (what: string, fn: () => Promise<{ view: SessionView; generated: Lesson[] }>) => {
    setBusy(what);
    setError(null);
    try {
      const r = await fn();
      setView(r.view, r.generated);
      onAdded(r.view.recommendation?.nodeId || undefined);
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
            <h2 id="add-track-title">{t('Was willst du lernen?')}</h2>
            <p className="muted">{t('Der Agent plant nur für Bereiche, die du wählst. Du kannst später weitere hinzufügen.')}</p>
          </div>
          <button className="icon-btn" disabled={Boolean(busy)} onClick={onClose} aria-label={t('Schliessen')} title={t('Schliessen')}><Icon name="close" size={20} /></button>
        </header>
        {error && <p className="error" role="alert">{t(error)}</p>}

        <div className="add-grid">
          <section aria-labelledby="add-own">
            <h3 id="add-own">{t('Eigenes Thema')}</h3>
            <p className="small muted">{t('Der Agent plant den Bereich mit der KI: was du können musst, passende Quellen und einen ersten Einstieg.')}</p>
            <form className="add-own" onSubmit={(e) => {
              e.preventDefault();
              run('own', () => api.createTrack(sessionId, { topic, goal: goal.trim() || undefined, selfLevel: prior }));
            }}>
              <label className="field">
                <span>{t('Thema')}</span>
                <input type="text" value={topic} maxLength={120} placeholder={t('z. B. Security+ Prüfung bestehen')} onChange={(e) => setTopic(e.target.value)} disabled={Boolean(busy)} />
              </label>
              <div className="chips" aria-label={t('Beispiele')}>
                {EXAMPLES.map((x) => <button key={x} type="button" className="chip" disabled={Boolean(busy)} onClick={() => setTopic(t(x))}>{t(x)}</button>)}
              </div>
              <label className="field">
                <span>{t('Wofür brauchst du es? (freiwillig, wird deine Mission)')}</span>
                <textarea rows={2} maxLength={300} value={goal} placeholder={t('Ich … und will …')} onChange={(e) => setGoal(e.target.value)} disabled={Boolean(busy)} />
              </label>
              <fieldset className="prior">
                <legend>{t('Vorwissen')}</legend>
                <div className="seg" role="radiogroup" aria-label={t('Vorwissen')}>
                  {PRIOR.map((p) => (
                    <button key={p.level} type="button" role="radio" aria-checked={prior === p.level} disabled={Boolean(busy)} onClick={() => setPrior(p.level)}>{t(p.label)}</button>
                  ))}
                </div>
              </fieldset>
              <div className="row">
                <button className="btn primary" disabled={!view.canCreateTracks || topic.trim().length < 3 || Boolean(busy)}><Icon name="sparkle" size={16} />{t('Bereich planen')}</button>
              </div>
              {busy === 'own' && (
                <p className="planning" role="status"><span className="dot-pulse" aria-hidden="true" />{t('Der Agent plant «{topic}» und erstellt einen Einstieg. Das dauert bis zu einer Minute.', { topic: topic.trim() })}</p>
              )}
              {!view.canCreateTracks && <p className="note small">{t('Eigene Bereiche plant der Agent mit KI. Gerade ist keine KI verbunden. Ein vorbereiteter Bereich geht auch ohne.')}</p>}
              <p className="small muted">{t('An die KI gehen Thema, Wofür und Vorwissen, dein Name nicht. Die Quellen schlägt die KI vor. Behalten werden nur Adressen, die beim Anlegen erreichbar sind.')}</p>
            </form>
          </section>

          <section aria-labelledby="add-catalog">
            <h3 id="add-catalog">{t('Vorbereitete Bereiche')}</h3>
            <p className="small muted">{t('Mit geprüften Quellen und vorbereiteten Lektionen. Geht auch ohne KI.')}</p>
            {catalog.length === 0 && <p className="small muted">{t('Alle vorbereiteten Bereiche sind schon auf deiner Karte.')}</p>}
            {catalog.map(({ skill, open }) => (
              <div key={skill.id} className="catalog-skill">
                <div className="catalog-head">
                  <h4>{skillName(skill.id, skill.name)}</h4>
                  {open.length > 1 && (
                    <button className="linkbtn small" disabled={Boolean(busy)} onClick={() => add(open.map((x) => x.id))}>{t('Alle {n} hinzufügen', { n: open.length })}</button>
                  )}
                </div>
                <ul className="catalog">
                  {open.map((tr) => (
                    <li key={tr.id}>
                      <button className="choice" disabled={Boolean(busy)} onClick={() => add([tr.id])}>
                        <strong>{trackName(tr.id, tr.name)}</strong>
                        <span className="small muted">
                          {skill.dccBased ? t('DCC: {level}', { level: level(view.dcc.levels[tr.id]) }) : t('ohne DCC-Position')} · {t('{n} Kriterien', { n: tr.criteria.length })}
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
