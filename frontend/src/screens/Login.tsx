import { useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DccLevel, DccResultFile } from '@l45/shared';
import { DCC_LEVELS } from '@l45/shared';
import { api } from '../lib/api.ts';
import { LangSwitch, useI18n } from '../lib/i18n.tsx';
import { useStore } from '../lib/store.tsx';

const SAMPLES = [
  { file: 'dcc-gemischt.json', label: 'Gemischt' },
  { file: 'dcc-fortgeschritten.json', label: 'Eher fortgeschritten' },
  { file: 'dcc-teilweise.json', label: 'Nur teilweise erhoben' },
];

export function Login() {
  const { content, setView } = useStore();
  const { t, level, trackName } = useI18n();
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
      if (data?.type !== 'dcc-result' || !Array.isArray(data.areas)) throw new Error(t('kein DCC-Resultat'));
      setFile({ name: f.name, data });
    } catch {
      setFile(null);
      setError(t('«{name}» ist keine gültige DCC-Resultatdatei. Nimm eine der Beispieldateien als Vorlage.', { name: f.name }));
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
      <div className="lang-float">
        <LangSwitch />
      </div>
      <section className="login-intro">
        <h1>{t('Lernagent')}</h1>
        <p className="lead">{t('Dein DCC-Profil wird zu einer Lernkarte. Der Agent plant Lektionen in allen fünf Bereichen, schlägt den nächsten Schritt vor und sagt, warum.')}</p>
        <MiniMap />
        <p className="small muted">{t('Prototyp für Learn45. Anmeldung ohne Passwort, nur erfundene Daten.')}</p>
      </section>

      <section className="login-card" aria-label={t('Anmelden')}>
        <h2>{t('Anmelden')}</h2>
        <label className="field">
          <span>{t('Dein Name')}</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={40} />
        </label>
        <label className="field">
          <span>{t('Zeit für heute')}</span>
          <select value={time} onChange={(e) => setTime(Number(e.target.value))}>
            {[5, 10, 15, 30, 45].map((m) => <option key={m} value={m}>{m} {t('Minuten')}</option>)}
          </select>
        </label>

        <fieldset className="dcc-box">
          <legend>{t('DCC-Profil')}</legend>
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={mode === 'file'} onClick={() => setMode('file')}>{t('Resultat laden')}</button>
            <button role="tab" aria-selected={mode === 'manual'} onClick={() => setMode('manual')}>{t('Stufen eingeben')}</button>
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
                {file ? <strong>{file.name}</strong> : <span>{t('DCC-Resultat (JSON) hierher ziehen oder auswählen')}</span>}
              </label>
              <p className="small muted">
                {t('Beispieldateien')}:{' '}
                {SAMPLES.map((s, i) => (
                  <span key={s.file}>
                    <a href={`/dcc-beispiele/${s.file}`} download>{t(s.label)}</a>
                    {i < SAMPLES.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
              {file && (
                <table className="levels">
                  <tbody>
                    {tracks.map((t) => (
                      <tr key={t.id}>
                        <td>{t.dccArea} {trackName(t.id, t.name)}</td>
                        <td>{levelOf(t.dccArea) ? level(levelOf(t.dccArea)) : <span className="muted">{level(null)}</span>}</td>
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
                    <td><label htmlFor={`lv-${t.id}`}>{t.dccArea} {trackName(t.id, t.name)}</label></td>
                    <td>
                      <select id={`lv-${t.id}`} value={levels[t.id] ?? ''} onChange={(e) => setLevels({ ...levels, [t.id]: (e.target.value || null) as DccLevel | null })}>
                        <option value="">{level(null)}</option>
                        {DCC_LEVELS.map((l) => <option key={l} value={l}>{level(l)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small muted">{t('Die DCC-Werte bleiben unverändert. Lernen in der App stuft nichts hoch. «Nicht erhoben» heisst nicht geringe Kompetenz.')}</p>
        </fieldset>

        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={!ready || busy} onClick={submit}>
          {busy ? t('Lernkarte wird erstellt …') : t('Lernkarte erstellen')}
        </button>
      </section>
    </div>
  );
}

/** Small static drawing of the knowledge map: five DCC lines leave one station and climb towards the peak. */
function MiniMap() {
  // Top to bottom in the bundle; reach = how far each line is already built.
  const lines = [['var(--c-info)', 96], ['var(--c-komm)', 70], ['var(--c-inhalte)', 108], ['var(--c-sicherheit)', 52], ['var(--c-problem)', 84]] as const;
  const gap = 8;
  const top = 118;
  return (
    <svg viewBox="0 0 320 220" className="minimap" aria-hidden="true">
      <path d="M0 210 L70 150 L110 168 L222 44 L268 108 L296 92 L320 108 V220 H0 Z" fill="var(--surface-2)" />
      <path d="M222 44 L240 69 L230 64 L221 72 L211 63 L204 66 Z" fill="var(--surface)" />
      <path d="M222 44 V24" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <path d="M222 24 L238 29 L222 34 Z" fill="var(--trail)" />
      {lines.map(([c, reach], i) => {
        const y = 166 + i * gap;
        const x = 96 + i * gap * Math.tan(Math.PI / 8);
        const at = (t: number) => `${x + t} ${y - t}`;
        const stops = [30, 60, 90].filter((t) => t < reach - 8);
        return (
          <g key={c}>
            <path d={`M${at(reach)} L${at(top)}`} stroke={c} strokeWidth="2.5" strokeDasharray="1 6" strokeLinecap="round" />
            <path d={`M40 ${y} H${x} L${at(reach)}`} stroke={c} strokeWidth="5" fill="none" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx="70" cy={y} r="2" fill="#fff" />
            {stops.map((t) => <circle key={t} cx={x + t} cy={y - t} r="2" fill="#fff" />)}
            <circle cx={x + reach} cy={y - reach} r="5.5" fill="var(--surface)" stroke={c} strokeWidth="3" />
          </g>
        );
      })}
      <rect x="30" y="158" width="20" height={4 * gap + 16} rx="10" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
    </svg>
  );
}
