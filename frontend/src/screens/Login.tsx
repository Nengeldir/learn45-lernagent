import { useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DccLevel, DccResultFile, LoginConflict } from '@l45/shared';
import { DCC_LEVELS } from '@l45/shared';
import { api, ApiError } from '../lib/api.ts';
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
  const [mode, setMode] = useState<'file' | 'manual'>('file');
  const [file, setFile] = useState<{ name: string; data: DccResultFile } | null>(null);
  const [levels, setLevels] = useState<Record<string, DccLevel | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [conflict, setConflict] = useState<LoginConflict | null>(null);

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

  // The DCC profile is optional: it only sets the levels of the prepared Digitale-Kompetenz tracks.
  const ready = name.trim().length > 0;

  const submit = async (resume?: 'continue' | 'new') => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.login({
        name,
        resume,
        ...(mode === 'file' && file ? { dccFile: file.data, fileName: file.name } : { levels: mode === 'manual' ? levels : {} }),
      });
      setConflict(null);
      setView(v, resume === 'continue' ? await api.generated(v.session.id) : []);
      nav('/karte');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body.code === 'learner-exists') setConflict(e.body as unknown as LoginConflict);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const levelOf = (area?: string) => file?.data.areas.find((a) => a.area === area)?.level ?? null;

  return (
    <div className="login">
      <section className="login-intro">
        <h1>Lernagent</h1>
        <p className="lead">Lerne den Umgang mit dem Computer in kleinen Schritten. Du wählst ein Thema, der Lernagent zeigt dir immer, was als Nächstes kommt.</p>
        <MiniMap />
        <p className="small muted">Prototyp für Learn45. Anmeldung ohne Passwort, nur erfundene Daten.</p>
      </section>

      <section className="login-card" aria-label="Anmelden">
        <h2>Willkommen!</h2>
        <label className="field">
          <span>Wie heisst du?</span>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setConflict(null); }}
            onKeyDown={(e) => e.key === 'Enter' && ready && !busy && !conflict && submit()}
            autoComplete="given-name"
            maxLength={40}
          />
        </label>

        {/* Optional and only for the prepared Digitale-Kompetenz tracks, so it stays closed unless asked for. */}
        <details className="dcc-box more">
          <summary>Ich habe ein DCC-Resultat (freiwillig)</summary>
          <p className="small muted">Nur nötig, wenn du einen DCC-Test gemacht hast. Sonst einfach weiter.</p>
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
        </details>

        {error && <p className="error" role="alert">{error}</p>}
        {conflict ? (
          <div className="choice-card" role="alert">
            <p>
              <strong>Willkommen zurück, {conflict.name}!</strong>{' '}
              Du hast schon {conflict.lessonsDone} {conflict.lessonsDone === 1 ? 'Lektion' : 'Lektionen'} geschafft.
            </p>
            <div className="row">
              <button className="btn primary big" disabled={busy} onClick={() => submit('continue')}>Weitermachen</button>
              <button className="btn secondary" disabled={busy} onClick={() => submit('new')}>Neu anfangen</button>
            </div>
            <p className="small muted">Neu anfangen gibt dir eine leere Karte. Dein alter Stand bleibt gespeichert.</p>
          </div>
        ) : (
          <button className="btn primary big block" disabled={!ready || busy} onClick={() => submit()}>
            {busy ? 'Einen Moment …' : "Los geht's"}
          </button>
        )}
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
