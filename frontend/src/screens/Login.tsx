import { useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DccLevel, DccResultFile } from '@l45/shared';
import { DCC_LEVELS } from '@l45/shared';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.tsx';

const SAMPLES = [
  { file: 'dcc-gemischt.json', label: 'Gemischt' },
  { file: 'dcc-fortgeschritten.json', label: 'Eher fortgeschritten' },
  { file: 'dcc-teilweise.json', label: 'Nur teilweise erhoben' },
];

export function Login() {
  const { content, setView } = useStore();
  const nav = useNavigate();
  const tracks = useMemo(() => content?.skills.filter((s) => s.dccBased).flatMap((s) => s.tracks) ?? [], [content]);
  const [name, setName] = useState('');
  const [time, setTime] = useState(15);
  const [mode, setMode] = useState<'file' | 'manual'>('file');
  const [file, setFile] = useState<{ name: string; data: DccResultFile } | null>(null);
  const [levels, setLevels] = useState<Record<string, DccLevel | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const readFile = async (f: File) => {
    setError(null);
    try {
      const data = JSON.parse(await f.text()) as DccResultFile;
      if (data?.type !== 'dcc-result' || !Array.isArray(data.areas)) throw new Error('kein DCC-Resultat');
      setFile({ name: f.name, data });
    } catch {
      setFile(null);
      setError(`«${f.name}» ist keine gültige DCC-Resultatdatei. Nimm eine der Beispieldateien als Vorlage.`);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  };

  const ready = name.trim().length > 0 && (mode === 'manual' || file);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.login({
        name,
        timeBudgetMin: time,
        ...(mode === 'file' && file ? { dccFile: file.data, fileName: file.name } : { levels }),
      });
      setView(v, []);
      nav('/karte');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const levelOf = (area?: string) => file?.data.areas.find((a) => a.area === area)?.level ?? null;

  return (
    <div className="login">
      <section className="login-intro">
        <h1>Lernagent</h1>
        <p className="lead">Dein DCC-Profil wird zu einer Lernkarte. Der Agent plant Lektionen in allen fünf Bereichen, schlägt den nächsten Schritt vor und sagt, warum.</p>
        <MiniMap />
        <p className="small muted">Prototyp für Learn45. Anmeldung ohne Passwort, nur erfundene Daten.</p>
      </section>

      <section className="login-card" aria-label="Anmelden">
        <h2>Anmelden</h2>
        <label className="field">
          <span>Dein Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={40} />
        </label>
        <label className="field">
          <span>Zeit für heute</span>
          <select value={time} onChange={(e) => setTime(Number(e.target.value))}>
            {[5, 10, 15, 30, 45].map((m) => <option key={m} value={m}>{m} Minuten</option>)}
          </select>
        </label>

        <fieldset className="dcc-box">
          <legend>DCC-Profil</legend>
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={mode === 'file'} onClick={() => setMode('file')}>Resultat laden</button>
            <button role="tab" aria-selected={mode === 'manual'} onClick={() => setMode('manual')}>Stufen eingeben</button>
          </div>

          {mode === 'file' ? (
            <>
              <label
                className={`drop${drag ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
              >
                <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
                {file ? <strong>{file.name}</strong> : <span>DCC-Resultat (JSON) hierher ziehen oder auswählen</span>}
              </label>
              <p className="small muted">
                Beispieldateien:{' '}
                {SAMPLES.map((s, i) => (
                  <span key={s.file}>
                    <a href={`/dcc-beispiele/${s.file}`} download>{s.label}</a>
                    {i < SAMPLES.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
              {file && (
                <table className="levels">
                  <tbody>
                    {tracks.map((t) => (
                      <tr key={t.id}>
                        <td>{t.dccArea} {t.name}</td>
                        <td>{levelOf(t.dccArea) ?? <span className="muted">nicht erhoben</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <table className="levels">
              <tbody>
                {tracks.map((t) => (
                  <tr key={t.id}>
                    <td><label htmlFor={`lv-${t.id}`}>{t.dccArea} {t.name}</label></td>
                    <td>
                      <select id={`lv-${t.id}`} value={levels[t.id] ?? ''} onChange={(e) => setLevels({ ...levels, [t.id]: (e.target.value || null) as DccLevel | null })}>
                        <option value="">nicht erhoben</option>
                        {DCC_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small muted">Die DCC-Werte bleiben unverändert. Lernen in der App stuft nichts hoch. «Nicht erhoben» heisst nicht geringe Kompetenz.</p>
        </fieldset>

        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={!ready || busy} onClick={submit}>
          {busy ? 'Lernkarte wird erstellt …' : 'Lernkarte erstellen'}
        </button>
      </section>
    </div>
  );
}

/** Small static drawing of the mind map, as in the team sketch. */
function MiniMap() {
  const tracks = [[-122, 'var(--c-info)'], [-58, 'var(--c-problem)'], [8, 'var(--c-sicherheit)'], [188, 'var(--c-inhalte)'], [148, 'var(--c-komm)']] as const;
  const d = { x: 150, y: 95 };
  return (
    <svg viewBox="0 0 300 260" className="minimap" aria-hidden="true">
      <path d={`M150 205 L${d.x} ${d.y}`} stroke="var(--ink)" strokeWidth="4" />
      <path d="M150 205 L70 240 M150 205 L230 240" stroke="var(--ink)" strokeWidth="4" />
      {tracks.map(([a, c]) => {
        const r = (a * Math.PI) / 180;
        const x = d.x + Math.cos(r) * 70;
        const y = d.y + Math.sin(r) * 70;
        const x2 = x + Math.cos(r) * 38;
        const y2 = y + Math.sin(r) * 38;
        return (
          <g key={a}>
            <path d={`M${d.x} ${d.y} L${x} ${y}`} stroke={c} strokeWidth="3" />
            <path d={`M${x} ${y} L${x2} ${y2}`} stroke={c} strokeWidth="2" strokeDasharray="2 5" />
            <circle cx={x} cy={y} r="8" fill={c} />
            <circle cx={x2} cy={y2} r="5" fill="var(--surface)" stroke={c} strokeWidth="2" />
          </g>
        );
      })}
      <circle cx={d.x} cy={d.y} r="16" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
      <circle cx="70" cy="240" r="11" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
      <circle cx="230" cy="240" r="11" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
      <circle cx="150" cy="205" r="20" fill="var(--ink)" />
    </svg>
  );
}
