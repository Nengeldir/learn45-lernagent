import { useEffect, useRef, useState } from 'react';
import type { Answer, VideoLesson, VideoVisual } from '@l45/shared';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Progress 0..1 through the current scene while playing. */
function useSceneProgress(playing: boolean, seconds: number, sceneKey: number, onEnd: () => void) {
  const [p, setP] = useState(0);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    setP(reduced() ? 1 : 0);
  }, [sceneKey]);
  useEffect(() => {
    if (!playing) return;
    if (reduced()) {
      const id = setTimeout(() => endRef.current(), seconds * 1000);
      return () => clearTimeout(id);
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setP((prev) => {
        const next = Math.min(1, prev + dt / seconds);
        if (next >= 1) queueMicrotask(() => endRef.current());
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, seconds, sceneKey]);
  return p;
}

const INK = '#e6ece7';
const DIM = '#8fa39a';
const YELLOW = '#f5c400';
const RED = '#ff8a7a';

function NextWord({ p, chosen }: { p: number; chosen: boolean }) {
  const words: [string, number][] = [['Montag', 0.46], ['Dienstag', 0.21], ['Mittwoch', 0.17], ['Freitag', 0.1], ['Juni', 0.06]];
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="Balken: wie gut passt welches nächste Wort">
      <text x="16" y="30" fill={INK} fontSize="15">Das Team trifft sich nächsten{chosen && p > 0.5 ? '' : ' …'}</text>
      {chosen && p > 0.5 && <text x="226" y="30" fill={YELLOW} fontSize="15" fontWeight="700">Montag.</text>}
      {words.map(([w, v], i) => {
        const y = 56 + i * 26;
        const width = 190 * v * Math.min(1, p * 1.6) / 0.46;
        const highlight = chosen && i === 0;
        return (
          <g key={w}>
            <text x="16" y={y + 13} fill={highlight ? YELLOW : DIM} fontSize="13">{w}</text>
            <rect x="92" y={y} width={width} height="16" rx="3" fill={highlight ? YELLOW : DIM} opacity={highlight ? 1 : 0.7} />
          </g>
        );
      })}
      <text x="16" y="192" fill={DIM} fontSize="10">Beispielwerte zur Veranschaulichung</text>
    </svg>
  );
}

function InventedDetail({ p }: { p: number }) {
  const show = (t: number) => (p >= t ? 1 : 0.15);
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="Notiz und Zusammenfassung im Vergleich">
      <text x="16" y="24" fill={DIM} fontSize="12">Notiz</text>
      <text x="16" y="44" fill={INK} fontSize="13">Das Team trifft sich nächste Woche.</text>
      <text x="16" y="62" fill={INK} fontSize="13">Der Wochentag ist noch offen.</text>
      <text x="16" y="120" fill={DIM} fontSize="12">KI-Zusammenfassung</text>
      <text x="16" y="140" fill={INK} fontSize="13">Das Team trifft sich nächsten</text>
      <text x="196" y="140" fill={RED} fontSize="13" fontWeight="700">Montag.</text>
      <path d="M60 128 L60 70" stroke={YELLOW} strokeWidth="2" strokeDasharray="4 3" opacity={show(0.25)} />
      <text x="66" y="100" fill={YELLOW} fontSize="11" opacity={show(0.25)}>belegt</text>
      <ellipse cx="220" cy="135" rx="34" ry="14" fill="none" stroke={RED} strokeWidth="2" strokeDasharray="5 3" opacity={show(0.55)} />
      <text x="186" y="172" fill={RED} fontSize="12" opacity={show(0.55)}>keine Stelle in der Notiz</text>
    </svg>
  );
}

// Coordinates for the curve y = 0.5 x^2
const X = (x: number, cx = 0.5, z = 1) => 160 + (x - cx) * 60 * z;
const Y = (y: number, cy = 0.125, z = 1) => 120 - (y - cy) * 60 * z;
const f = (x: number) => 0.5 * x * x;

function curvePath(cx: number, z: number) {
  const pts: string[] = [];
  for (let x = -2.5; x <= 3.01; x += 0.05) pts.push(`${X(x, cx, z).toFixed(1)},${Y(f(x), f(cx), z).toFixed(1)}`);
  return `M${pts.join(' L')}`;
}

function SecantTangent({ p, moving }: { p: number; moving: boolean }) {
  const a = 0.5;
  const b = moving ? 2.2 - (2.2 - 0.62) * p : 2.2;
  const slope = (f(b) - f(a)) / (b - a);
  const line = (x: number) => f(a) + slope * (x - a);
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="Kurve mit Sekante durch zwei Punkte">
      <path d={curvePath(a, 1)} fill="none" stroke={INK} strokeWidth="2" />
      <line x1={X(-1.2)} y1={Y(line(-1.2), f(a))} x2={X(2.6)} y2={Y(line(2.6), f(a))} stroke={YELLOW} strokeWidth="2" />
      <circle cx={X(a)} cy={Y(f(a), f(a))} r="5" fill={YELLOW} />
      <circle cx={X(b)} cy={Y(f(b), f(a))} r="5" fill={INK} />
      <text x="16" y="24" fill={INK} fontSize="13">Steigung der Sekante: {slope.toFixed(2)}</text>
    </svg>
  );
}

function SlopeZoom({ p, zoom }: { p: number; zoom: boolean }) {
  const a = 0.5;
  const z = zoom ? 1 + p * 6 : 1;
  const tangent = (x: number) => f(a) + a * (x - a);
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="Tangente an der Kurve, hineingezoomt">
      <path d={curvePath(a, z)} fill="none" stroke={INK} strokeWidth="2" />
      <line x1={X(a - 3, a, z)} y1={Y(tangent(a - 3), f(a), z)} x2={X(a + 3, a, z)} y2={Y(tangent(a + 3), f(a), z)} stroke={YELLOW} strokeWidth="2" />
      <circle cx={X(a, a, z)} cy={Y(f(a), f(a), z)} r="5" fill={YELLOW} />
      <text x="16" y="24" fill={INK} fontSize="13">Steigung der Tangente: {a.toFixed(2)}</text>
      {zoom && <text x="16" y="190" fill={DIM} fontSize="11">Zoom ×{z.toFixed(1)}</text>}
    </svg>
  );
}

function Steps({ p, items }: { p: number; items: string[] }) {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={items.join(', ')}>
      {items.map((it, i) => {
        const shown = p >= i / Math.max(1, items.length);
        const y = 40 + i * (130 / Math.max(1, items.length - 1 || 1));
        return (
          <g key={it} opacity={shown ? 1 : 0.15}>
            <circle cx="34" cy={y} r="11" fill={i === items.length - 1 && p > 0.9 ? YELLOW : 'none'} stroke={YELLOW} strokeWidth="2" />
            <text x="34" y={y + 4} textAnchor="middle" fill={i === items.length - 1 && p > 0.9 ? '#10201a' : YELLOW} fontSize="11" fontWeight="700">{i + 1}</text>
            <text x="58" y={y + 5} fill={INK} fontSize="15">{it}</text>
          </g>
        );
      })}
    </svg>
  );
}

function UrlParts({ p, items }: { p: number; items: string[] }) {
  // items: scheme, prefix, domain, tld, path. The domain + tld are highlighted.
  const widths = items.map((t) => t.length * 9.2);
  const total = widths.reduce((a, b) => a + b, 0);
  let x = (320 - total) / 2;
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={items.join('')}>
      {items.map((it, i) => {
        const key = i === 2 || i === 3;
        const el = (
          <g key={i}>
            <text x={x} y="92" fill={key && p > 0.4 ? YELLOW : INK} fontSize="16" fontWeight={key && p > 0.4 ? 700 : 400} fontFamily="monospace">{it}</text>
          </g>
        );
        x += widths[i];
        return el;
      })}
      {p > 0.4 && (() => {
        const start = (320 - total) / 2 + widths[0] + widths[1];
        const w = widths[2] + widths[3];
        return (
          <g>
            <path d={`M${start} 104 h${w}`} stroke={YELLOW} strokeWidth="3" />
            <text x={start + w / 2} y="130" textAnchor="middle" fill={YELLOW} fontSize="13">Diese Domain zählt</text>
          </g>
        );
      })()}
    </svg>
  );
}

function Falling({ p, vacuum }: { p: number; vacuum: boolean }) {
  const ball = 30 + p * 140;
  const feather = vacuum ? ball : 30 + p * 55;
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={vacuum ? 'Ohne Luft fallen Kugel und Feder gleich schnell' : 'Mit Luft fällt die Feder langsamer'}>
      <text x="16" y="20" fill={DIM} fontSize="12">{vacuum ? 'ohne Luft (Vakuum)' : 'mit Luft'}</text>
      <path d="M40 185 H280" stroke={DIM} strokeWidth="1.5" />
      <circle cx="110" cy={Math.min(ball, 174)} r="11" fill={INK} />
      <text x="110" y="198" textAnchor="middle" fill={DIM} fontSize="10">Kugel</text>
      <path d={`M210 ${Math.min(feather, 174)} q 14 -10 26 -2 q -14 4 -26 2 z`} fill={YELLOW} />
      <text x="222" y="198" textAnchor="middle" fill={DIM} fontSize="10">Feder</text>
    </svg>
  );
}

function Visual({ visual, p, scene, first, items }: { visual: VideoVisual; p: number; scene: number; first: boolean; items?: string[] }) {
  switch (visual) {
    case 'steps':
      return <Steps p={p} items={items ?? []} />;
    case 'url-parts':
      return <UrlParts p={p} items={items ?? []} />;
    case 'falling':
      return <Falling p={p} vacuum={!first} key={scene} />;
    case 'next-word':
      return <NextWord p={p} chosen={!first} />;
    case 'invented-detail':
      return <InventedDetail p={first ? p : 1} />;
    case 'secant-tangent':
      return <SecantTangent p={p} moving={!first} />;
    case 'slope-zoom':
      return <SlopeZoom p={p} zoom={!first} key={scene} />;
  }
}

export function Video({ lesson, onComplete }: { lesson: VideoLesson; onComplete: (a: Answer) => Promise<void> }) {
  const { scenes, questions } = lesson.content;
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [ended, setEnded] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const onSceneEnd = () => {
    const q = questions.findIndex((x, i) => x.afterScene === scene && answers[i] === undefined);
    if (q >= 0) {
      setPlaying(false);
      setAsking(q);
      return;
    }
    if (scene + 1 < scenes.length) setScene(scene + 1);
    else {
      setPlaying(false);
      setEnded(true);
    }
  };
  const p = useSceneProgress(playing, scenes[scene].seconds, scene, onSceneEnd);
  const first = scenes.findIndex((s) => s.visual === scenes[scene].visual) === scene;

  const answer = (i: number) => {
    if (asking === null) return;
    const next = { ...answers, [asking]: i };
    setAnswers(next);
    setAsking(null);
    if (lesson.content.videoUrl) {
      const q = questions.findIndex((_, k) => next[k] === undefined);
      if (q >= 0) setAsking(q);
      else setEnded(true);
      return;
    }
    if (scene + 1 < scenes.length) {
      setScene(scene + 1);
      setPlaying(true);
    } else setEnded(true);
  };

  return (
    <>
      {!lesson.content.videoUrl && (
        <p className="note">
          {lesson.source === 'model'
            ? <>Von der KI erstellt: ein kurzes Storyboard mit Fragen. <span className="tag model">Beispiel erfunden</span></>
            : 'Platzhalter-Storyboard. Das fertige Video wird vorab mit der Aha-Engine erzeugt und hier eingebunden.'}
        </p>
      )}
      {lesson.content.videoUrl ? (
        <video
          src={lesson.content.videoUrl}
          controls
          style={{ width: '100%', borderRadius: 10 }}
          onEnded={() => (questions.length ? setAsking(questions.findIndex((_, k) => answers[k] === undefined)) : setEnded(true))}
        />
      ) : (
        <>
          <div className="stage">
            <Visual visual={scenes[scene].visual} p={p} scene={scene} first={first} items={scenes[scene].items} />
          </div>
          <div className="progress" aria-hidden="true">
            {scenes.map((_, i) => <span key={i} className={i <= scene ? 'on' : ''} />)}
          </div>
          <p className="caption" aria-live="polite">{scenes[scene].caption}</p>
          {asking === null && !ended && (
            <button className="btn secondary" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : scene === 0 && p === 0 ? 'Abspielen' : 'Weiter abspielen'}</button>
          )}
        </>
      )}

      {asking !== null && (
        <div className="panel">
          <h3>{questions[asking].prompt}</h3>
          <div className="choices">
            {questions[asking].options.map((o, i) => (
              <button key={i} className="choice" onClick={() => answer(i)}>{o}</button>
            ))}
          </div>
        </div>
      )}

      {ended && (
        <button
          className="btn block"
          disabled={busy || questions.some((_, i) => answers[i] === undefined && !lesson.content.videoUrl)}
          onClick={async () => {
            setBusy(true);
            try {
              await onComplete({ type: 'video', answers });
            } finally {
              setBusy(false);
            }
          }}
        >
          Abschliessen
        </button>
      )}
    </>
  );
}
