// The climber on the topic mountain. Alone you walk the trail from stop to stop, with a friend you ride the cable
// car up the flank. The figure only shows finished lessons; it never changes the plan or the DCC.
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface Point {
  x: number;
  y: number;
}

/** Cable car line over the left flank of the 320 × 220 mountain. The valley station sits beside the trailhead. */
export const CABLE = { x1: 44, y1: 200, x2: 140, y2: 44 };

const FRIEND_COLOR = '#ffffff';
const JACKET = '#e2231a';

function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)';
  const [reduce, setReduce] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches);
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

export function pointAt(path: Point[], pos: number): Point & { facing: 1 | -1 } {
  const i = Math.max(0, Math.min(path.length - 1, Math.floor(pos)));
  const a = path[i];
  const b = path[Math.min(path.length - 1, i + 1)];
  const f = Math.max(0, Math.min(1, pos - i));
  // Face the way of the current leg; standing on the last stop, face the way the last leg went.
  const from = b === a ? path[Math.max(0, i - 1)] : a;
  const to = b === a ? a : b;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, facing: to.x >= from.x ? 1 : -1 };
}

/** Where the cabin hangs for a given height y on the mountain. */
export function cableAt(y: number): Point {
  const f = Math.max(0, Math.min(1, (CABLE.y1 - y) / (CABLE.y1 - CABLE.y2)));
  return { x: CABLE.x1 + (CABLE.x2 - CABLE.x1) * f, y: CABLE.y1 + (CABLE.y2 - CABLE.y1) * f };
}

/** A roped climber in a helmet, leaning into the face with an ice axe. Drawn with the feet on (0, 0). */
export function Hiker({ at, walking }: { at: Point & { facing: 1 | -1 }; walking: boolean }) {
  return (
    <g className="climber" transform={`translate(${at.x} ${at.y}) scale(${at.facing} 1)`} aria-hidden="true">
      <svg className={`hiker-svg${walking ? ' is-walking' : ''}`} x={-13} y={-34} width={26} height={35} viewBox="0 -3 44 59" overflow="visible">
        <path d="M21 34 C13 40 19 46 11 50 C7 52 9 55 5 56" fill="none" stroke="#2c3a47" strokeWidth="2" strokeLinecap="round" />
        <g className="hiker-leg back">
          <path d="M21 34 L25 43 L29 49" fill="none" stroke="#6b3328" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M27 48.5 L33 50" stroke="#3a2a22" strokeWidth="4" strokeLinecap="round" />
        </g>
        <g className="climber-arm low">
          <path d="M17 22 L13 29 L19 32" fill="none" stroke="#f2c6a0" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <path d="M13.5 21 Q18 16.5 24 19 L26.5 33 Q21.5 36.5 17 34 Z" fill={JACKET} />
        <path d="M13.5 21 Q18 16.5 24 19 L24.6 22.5 Q19 21 14.6 24 Z" fill="#ffffff" fillOpacity="0.25" />
        <g className="hiker-leg front">
          <path d="M24 33 L33 37 L35 45" fill="none" stroke="#7a3b2e" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M33.5 45 L39 45.5" stroke="#3a2a22" strokeWidth="4" strokeLinecap="round" />
        </g>
        <path d="M16.5 31.5 L26.8 30" stroke="#2c3a47" strokeWidth="3" strokeLinecap="round" />
        <circle cx="21.5" cy="31" r="1.6" fill="#c9d3dc" />
        <g className="climber-arm high">
          <path d="M22 20 L27 13 L28 6.5" fill="none" stroke="#f2c6a0" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M23.5 18.6 L26 15" stroke={JACKET} strokeWidth="4.2" strokeLinecap="round" />
          <path d="M27.4 9 L30.5 0.8" stroke="#2c3a47" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M26 1.6 Q30.5 -0.6 35.5 2.6" fill="none" stroke="#9aa7b4" strokeWidth="2" strokeLinecap="round" />
        </g>
        <circle cx="16" cy="13.5" r="5" fill="#f2c6a0" />
        <path d="M19.2 15.6 Q18.4 17 17 16.8" fill="none" stroke="#7a3b2e" strokeWidth="0.9" strokeLinecap="round" />
        <circle cx="18.8" cy="12.6" r="0.9" fill="#1c1915" />
        <path d="M10 13.2 A6.3 6.3 0 0 1 22.4 11.4 L21.6 12.6 Q16 10.4 10.8 14.2 Z" fill="#ffffff" stroke="#c9d3dc" strokeWidth="0.6" />
        <path d="M12 14 L14.5 18.4" stroke="#2c3a47" strokeWidth="0.9" />
      </svg>
    </g>
  );
}

/** The cable, its two stations and the red cabin with both learners in it, hanging at `at`. */
export function CableCar({ at, moving, names }: { at: Point; moving: boolean; names: string }) {
  return (
    <g className="cable" aria-hidden="true">
      <line className="cable-rope" x1={CABLE.x1} y1={CABLE.y1} x2={CABLE.x2} y2={CABLE.y2} />
      <rect className="cable-station" x={CABLE.x1 - 9} y={CABLE.y1 - 3} width="18" height="9" rx="2" />
      <rect className="cable-station" x={CABLE.x2 - 8} y={CABLE.y2 - 4} width="16" height="8" rx="2" />
      <g transform={`translate(${at.x} ${at.y})`}>
        <svg className={`gondola-svg${moving ? ' is-moving' : ''}`} x={-12} y={-1} width={24} height={28} viewBox="0 0 48 56" overflow="visible">
          <line x1="24" y1="0" x2="24" y2="14" stroke="#1c1915" strokeWidth="2" />
          <circle cx="24" cy="3" r="3" fill="#1c1915" />
          <rect x="4" y="14" width="40" height="36" rx="7" fill={JACKET} />
          <rect x="8" y="19" width="32" height="16" rx="4" fill="#ffffff" />
          <circle cx="17" cy="28" r="5" fill="#f2c6a0" />
          <path d="M12 27 Q17 20 22 27 Z" fill={JACKET} />
          <circle cx="31" cy="28" r="5" fill="#f2c6a0" />
          <path d="M26 27 Q31 20 36 27 Z" fill={FRIEND_COLOR} stroke="#c9d3dc" strokeWidth="0.8" />
          <rect x="4" y="42" width="40" height="3" fill="#b81a13" />
        </svg>
        <text className="gondola-names" x={16} y={22}>{names}</text>
      </g>
    </g>
  );
}

/** A short burst where a stop was reached. */
export function Cheer({ at, label, big }: { at: Point; label: string; big?: boolean }) {
  const rays = big ? 14 : 8;
  return (
    <g className={`cheer${big ? ' is-big' : ''}`} transform={`translate(${at.x} ${at.y - 14})`} aria-hidden="true">
      {Array.from({ length: rays }, (_, i) => (
        <line key={i} x1="0" y1="-9" x2="0" y2="-15" style={{ '--a': `${(360 / rays) * i}deg` } as CSSProperties} />
      ))}
      <text y={-20}>{label}</text>
    </g>
  );
}
