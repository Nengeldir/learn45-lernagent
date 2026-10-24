// Asked once per track, the first time it is opened: why does this matter for you?
// The mission ties every lesson of the agent to the learner's own work.
import { useState } from 'react';
import type { Track } from '@l45/shared';
import { api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useStore } from '../lib/store.tsx';

export const MISSION_PRIVACY = 'Deine Mission und deine Antworten in den Lektionen gehen an die KI, dein Name nicht.';

export function MissionCard({ track, onDone }: { track: Track; onDone: () => void }) {
  const { view, setView } = useStore();
  const { t, trackName } = useI18n();
  const suggestions = track.mission?.suggestions ?? [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (body: { text?: string; skip?: boolean }) => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      setView(await api.mission(view.session.id, track.id, body));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mission-card">
      <p className="small muted">{t('Neu im Bereich «{name}»', { name: trackName(track.id, track.name) })}</p>
      <h3>{t('Wofür brauchst du das?')}</h3>
      <p>{t('Der Agent richtet die Beispiele danach aus. Du kannst die Mission später in den Einstellungen unter «Profil» ändern.')}</p>
      <div className="choices">
        {suggestions.map((s) => (
          <button key={s} className="choice" aria-pressed={text === t(s)} onClick={() => setText(t(s))}>{t(s)}</button>
        ))}
      </div>
      <label className="field">
        <span>{t('Oder in eigenen Worten')}</span>
        <textarea rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Ich … und will …')} />
      </label>
      {error && <p className="error" role="alert">{t(error)}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy || text.trim().length < 3} onClick={() => send({ text })}>{t('Übernehmen')}</button>
        <button className="btn quiet" disabled={busy} onClick={() => send({ skip: true })}>{t('Überspringen')}</button>
      </div>
      <p className="small muted">{t(MISSION_PRIVACY)} {t('Ohne Angabe nimmt der Agent: «{goal}»', { goal: track.mission?.default ? t(track.mission.default) : t('allgemeines Ziel') })}</p>
    </div>
  );
}
