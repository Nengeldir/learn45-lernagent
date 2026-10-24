// The climber on the mountain. Alone you walk the trail, with a friend you ride the cable car.
// Position is the exercise route only. Nothing here touches the DCC.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PEAK_SCENE } from './subwayLayout.ts';

export interface TrailPoint {
  x: number;
  y: number;
  metres: number;
}

/** Cable car line drawn over the left flank. Bottom station sits below the trailhead. */
export const CABLE = { x1: 70, y1: 478, x2: 300, y2: 128 };

export const FRIEND_COLOR = '#1f8a7a';

function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)';
  const [reduce, setReduce] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setReduce(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduce;
}

/** Moves a float index along the trail toward target. A new replay token starts again at the trailhead. */
export function useClimb(target: number, replay: number) {
  const reduce = useReducedMotion();
  const [pos, setPos] = useState(reduce ? target : 0);
  const posRef = useRef(pos);

  useEffect(() => {
    if (replay === 0 || reduce) return;
    posRef.current = 0;
    setPos(0);
  }, [replay, reduce]);

  useEffect(() => {
    if (reduce) {
      posRef.current = target;
      setPos(target);
      return;
    }
    // A long way is walked faster, so no climb takes more than about three seconds.
    const speed = Math.max(1.2, Math.abs(target - posRef.current) / 3);
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const cur = posRef.current;
      const dir = Math.sign(target - cur);
      if (dir === 0) return;
      let next = cur + dir * speed * dt;
      if ((target - next) * dir <= 0) next = target;
      posRef.current = next;
      setPos(next);
      if (next !== target) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, replay, reduce]);

  return pos;
}

export function pointAt(path: TrailPoint[], pos: number): TrailPoint & { facing: 1 | -1 } {
  const i = Math.max(0, Math.min(path.length - 1, Math.floor(pos)));
  const a = path[i];
  const b = path[Math.min(path.length - 1, i + 1)];
  const f = Math.max(0, Math.min(1, pos - i));
  const ahead = b === a ? path[Math.max(0, i - 1)] : b;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    metres: a.metres + (b.metres - a.metres) * f,
    facing: ahead.x >= a.x || b === a ? 1 : -1,
  };
}

/** Where the cabin hangs for a given scene height y. */
export function cableAt(y: number) {
  const f = Math.max(0, Math.min(1, (CABLE.y1 - y) / (CABLE.y1 - CABLE.y2)));
  return { x: CABLE.x1 + (CABLE.x2 - CABLE.x1) * f, y: CABLE.y1 + (CABLE.y2 - CABLE.y1) * f };
}

export const pct = (x: number, y: number) => ({
  left: `${(x / PEAK_SCENE.w) * 100}%`,
  top: `${(y / PEAK_SCENE.h) * 100}%`,
});

/** A roped climber in a helmet, leaning into the face with an ice axe. Feet sit at the bottom edge. */
export function HikerFigure({ color, walking }: { color: string; walking: boolean }) {
  return (
    <svg className={`hiker-svg${walking ? ' is-walking' : ''}`} viewBox="0 -3 44 59" aria-hidden="true">
      <path d="M21 34 C13 40 19 46 11 50 C7 52 9 55 5 56" fill="none" stroke="#2c3a47" strokeWidth="2" strokeLinecap="round" />
      <g className="hiker-leg back">
        <path d="M21 34 L25 43 L29 49" fill="none" stroke="#6b3328" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M27 48.5 L33 50" stroke="#3a2a22" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g className="climber-arm low">
        <path d="M17 22 L13 29 L19 32" fill="none" stroke="#f2c6a0" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d="M13.5 21 Q18 16.5 24 19 L26.5 33 Q21.5 36.5 17 34 Z" fill={color} />
      <path d="M13.5 21 Q18 16.5 24 19 L24.6 22.5 Q19 21 14.6 24 Z" fill="#ffffff" fillOpacity="0.18" />
      <g className="hiker-leg front">
        <path d="M24 33 L33 37 L35 45" fill="none" stroke="#7a3b2e" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M33.5 45 L39 45.5" stroke="#3a2a22" strokeWidth="4" strokeLinecap="round" />
      </g>
      <path d="M16.5 31.5 L26.8 30" stroke="#2c3a47" strokeWidth="3" strokeLinecap="round" />
      <circle cx="21.5" cy="31" r="1.6" fill="#c9d3dc" />
      <g className="climber-arm high">
        <path d="M22 20 L27 13 L28 6.5" fill="none" stroke="#f2c6a0" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M23.5 18.6 L26 15" stroke={color} strokeWidth="4.2" strokeLinecap="round" />
        <path d="M27.4 9 L30.5 0.8" stroke="#2c3a47" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M26 1.6 Q30.5 -0.6 35.5 2.6" fill="none" stroke="#9aa7b4" strokeWidth="2" strokeLinecap="round" />
      </g>
      <circle cx="16" cy="13.5" r="5" fill="#f2c6a0" />
      <path d="M19.2 15.6 Q18.4 17 17 16.8" fill="none" stroke="#7a3b2e" strokeWidth="0.9" strokeLinecap="round" />
      <circle cx="18.8" cy="12.6" r="0.9" fill="#1c1915" />
      <path d="M10 13.2 A6.3 6.3 0 0 1 22.4 11.4 L21.6 12.6 Q16 10.4 10.8 14.2 Z" fill="#7b8fa3" />
      <path d="M11 9.8 Q14 7.6 17.4 7.8" fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12 14 L14.5 18.4" stroke="#2c3a47" strokeWidth="0.9" />
    </svg>
  );
}

export function GondolaFigure({ color }: { color: string }) {
  return (
    <svg className="gondola-svg" viewBox="0 0 48 56" aria-hidden="true">
      <line x1="24" y1="0" x2="24" y2="14" stroke="#1c1915" strokeWidth="2" />
      <circle cx="24" cy="3" r="3" fill="#1c1915" />
      <rect x="4" y="14" width="40" height="36" rx="7" fill="#e2231a" />
      <rect x="8" y="19" width="32" height="16" rx="4" fill="#dff3ff" />
      <circle cx="17" cy="28" r="5" fill="#f2c6a0" />
      <path d="M12 27 Q17 20 22 27 Z" fill={color} />
      <circle cx="31" cy="28" r="5" fill="#f2c6a0" />
      <path d="M26 27 Q31 20 36 27 Z" fill={FRIEND_COLOR} />
      <rect x="4" y="42" width="40" height="3" fill="#b81a13" />
    </svg>
  );
}

/** A short burst where a station was reached. */
export function Cheer({ x, y, label, big }: { x: number; y: number; label: string; big?: boolean }) {
  return (
    <div className={`cheer${big ? ' is-big' : ''}`} style={pct(x, y)} aria-live="polite">
      {Array.from({ length: big ? 14 : 8 }, (_, i) => (
        <i key={i} style={{ '--a': `${(360 / (big ? 14 : 8)) * i}deg` } as CSSProperties} />
      ))}
      <b>{label}</b>
    </div>
  );
}
