// Asked once per track, the first time it is opened: why does this matter for you?
// The mission ties every lesson of the agent to the learner's own work.
import { useState } from 'react';
import type { Track } from '@l45/shared';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.tsx';

export const MISSION_PRIVACY = 'Die KI sieht dein Ziel und deine Antworten, aber nicht deinen Namen.';

export function MissionCard({ track, onDone }: { track: Track; onDone: () => void }) {
  const { view, setView } = useStore();
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
      <h3>Wofür brauchst du das?</h3>
      <p>Dann passen die Beispiele besser zu deinem Alltag. Du kannst das später unter «Mein Konto» ändern.</p>
      <div className="choices">
        {suggestions.map((s) => (
          <button key={s} className="choice" aria-pressed={text === s} onClick={() => setText(s)}>{s}</button>
        ))}
      </div>
      <label className="field">
        <span>Oder schreib es in eigenen Worten</span>
        <textarea rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ich möchte …" />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy || text.trim().length < 3} onClick={() => send({ text })}>Weiter</button>
        <button className="btn quiet" disabled={busy} onClick={() => send({ skip: true })}>Überspringen</button>
      </div>
      <p className="small muted">{MISSION_PRIVACY}</p>
    </div>
  );
}
