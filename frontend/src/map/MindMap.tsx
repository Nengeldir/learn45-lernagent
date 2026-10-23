import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import type { DccProfile, Lesson, MapNode, Skill } from '@l45/shared';
import { TYPE_LABEL } from '@l45/shared';
import { TRACK_COLOR, bounds, layout, wrap, type Placed } from './layout.ts';

interface Cam {
  x: number;
  y: number;
  k: number;
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function MindMap({
  nodes, skills, dcc, lessonOf, selectedId, focusId, onSelect, rightInset = 0,
}: {
  nodes: MapNode[];
  skills: Skill[];
  dcc: DccProfile;
  lessonOf: (id?: string) => Lesson | undefined;
  selectedId: string | null;
  /** Node the camera should move to (changes trigger a smooth pan) */
  focusId: string | null;
  onSelect: (id: string | null) => void;
  /** Space covered by the side panel on the right (desktop) */
  rightInset?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [cam, setCam] = useState<Cam>({ x: 600, y: 400, k: 1 });
  const placed = useMemo(() => layout(nodes), [nodes]);
  const fitted = useRef(false);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  // Track size
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Nodes that appeared since the last render get a short grow animation.
  useEffect(() => {
    const ids = nodes.map((n) => n.id);
    if (seen.current.size === 0) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current.has(id));
    added.forEach((id) => seen.current.add(id));
    if (added.length) setFresh(new Set(added));
  }, [nodes]);

  const fit = useCallback(() => {
    const b = bounds(placed);
    const w = Math.max(200, size.w - rightInset);
    const k = clamp(Math.min(w / (b.maxX - b.minX), size.h / (b.maxY - b.minY)) * 0.94, 0.3, 1.3);
    setCam({ k, x: w / 2 - ((b.minX + b.maxX) / 2) * k, y: size.h / 2 - ((b.minY + b.maxY) / 2) * k });
  }, [placed, size, rightInset]);

  // First view: the whole map if it is readable, otherwise readable and centred on the next step.
  useEffect(() => {
    if (fitted.current || placed.size === 0 || size.w < 50) return;
    const b = bounds(placed);
    const w = Math.max(200, size.w - rightInset);
    const fitK = Math.min(w / (b.maxX - b.minX), size.h / (b.maxY - b.minY)) * 0.94;
    if (fitK >= 0.72) fit();
    else {
      const rec = [...placed.values()].find((p) => p.node.state === 'recommended') ?? placed.get('start');
      const k = 0.85;
      const cx = rec ? (rec.x + 0) / 2 : 0;
      const cy = rec ? (rec.y + 0) / 2 : 0;
      setCam({ k, x: w / 2 - cx * k, y: size.h / 2 - cy * k });
    }
    fitted.current = true;
  }, [fit, placed, size, rightInset]);

  // Smoothly move the camera to a node
  const animateTo = useCallback((id: string | null) => {
    const p = id ? placed.get(id) : undefined;
    if (!p) return;
    const w = size.w - rightInset;
    setCam((c) => {
      const k = Math.max(c.k, 0.8);
      const target = { k, x: w / 2 - p.x * k, y: size.h / 2 - p.y * k };
      if (reduced()) return target;
      const from = { ...c };
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 450);
        const e = 1 - Math.pow(1 - t, 3);
        setCam({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e });
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      return c;
    });
  }, [placed, size, rightInset]);

  useEffect(() => {
    if (focusId && fitted.current) animateTo(focusId);
  }, [focusId, animateTo]);

  // --- Pan and zoom -----------------------------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const pinch = useRef<{ dist: number; k: number } | null>(null);

  const zoomAt = (sx: number, sy: number, factor: number) =>
    setCam((c) => {
      const k = clamp(c.k * factor, 0.25, 2.5);
      return { k, x: sx - ((sx - c.x) * k) / c.k, y: sy - ((sy - c.y) * k) / c.k };
    });

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k };
    }
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const r = svgRef.current!.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const target = clamp((pinch.current.k * dist) / pinch.current.dist, 0.25, 2.5);
      zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, target / cam.k);
      moved.current += 10;
      return;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    moved.current += Math.abs(dx) + Math.abs(dy);
    setCam((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const click = (id: string | null) => {
    if (moved.current > 6) return;
    onSelect(id);
  };

  // --- Render -----------------------------------------------------------------------------------
  const edges = [...placed.values()].filter((p) => p.node.parentId);
  const trackDcc = (trackId?: string) => {
    const skill = skills.find((s) => s.tracks.some((t) => t.id === trackId));
    if (!skill?.dccBased) return 'keine DCC-Position';
    const lv = trackId ? dcc.levels[trackId] : null;
    return lv ? `DCC: ${lv}` : 'DCC: nicht erhoben';
  };

  return (
    <div className="mindmap">
      <svg
        ref={svgRef}
        className="mindmap-svg"
        role="application"
        aria-label="Lernkarte als Mindmap. Ziehen zum Verschieben, Mausrad zum Zoomen."
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={() => click(null)}
      >
        <defs>
          <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.2" className="dot" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
          {edges.map((p) => {
            const parent = placed.get(p.node.parentId!);
            if (!parent) return null;
            return <Edge key={`e-${p.node.id}`} from={parent} to={p} />;
          })}
          {[...placed.values()].map((p) => (
            <Node
              key={p.node.id}
              p={p}
              lesson={lessonOf(p.node.lessonId)}
              selected={selectedId === p.node.id}
              fresh={fresh.has(p.node.id)}
              dccText={p.node.kind === 'track' ? trackDcc(p.node.trackId) : undefined}
              onSelect={click}
            />
          ))}
        </g>
      </svg>
      <div className="map-controls" style={{ right: rightInset + 16 }}>
        <button onClick={() => zoomAt((size.w - rightInset) / 2, size.h / 2, 1.25)} aria-label="Hineinzoomen">+</button>
        <button onClick={() => zoomAt((size.w - rightInset) / 2, size.h / 2, 0.8)} aria-label="Herauszoomen">−</button>
        <button onClick={fit} className="wide">Ganze Karte</button>
      </div>
    </div>
  );
}

function Edge({ from, to }: { from: Placed; to: Placed }) {
  const n = to.node;
  const color = n.kind === 'skill' ? 'var(--ink)' : TRACK_COLOR[n.trackId ?? ''] ?? 'var(--ink-2)';
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const bend = n.kind === 'lesson' ? 0.12 : 0.08;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  const planned = n.kind === 'lesson' && (n.state === 'planned' || n.state === 'alternative' || n.state === 'recommended');
  const width = n.kind === 'skill' ? 5 : n.kind === 'track' ? 4 : 2.5;
  return (
    <path
      d={`M${from.x} ${from.y} Q${cx} ${cy} ${to.x} ${to.y}`}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={planned ? '2 7' : undefined}
      opacity={planned ? 0.55 : 0.9}
    />
  );
}

function Node({
  p, lesson, selected, fresh, dccText, onSelect,
}: {
  p: Placed;
  lesson?: Lesson;
  selected: boolean;
  fresh: boolean;
  dccText?: string;
  onSelect: (id: string) => void;
}) {
  const n = p.node;
  const color = TRACK_COLOR[n.trackId ?? ''] ?? 'var(--ink)';
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(n.id);
    }
  };
  const common = {
    className: `node ${n.kind} ${n.state ?? ''}${selected ? ' selected' : ''}${fresh ? ' fresh' : ''}`,
    transform: `translate(${p.x} ${p.y})`,
    tabIndex: 0,
    role: 'button',
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(n.id);
    },
    onKeyDown: onKey,
  };

  if (n.kind === 'start') {
    return (
      <g {...common} aria-label={`Start: ${n.label}`}>
        <circle r={40} className="start-disc" />
        {wrap(n.label, 10).map((line, i, all) => (
          <text key={i} y={(i - (all.length - 1) / 2) * 16 + 5} textAnchor="middle" className="start-label">{line}</text>
        ))}
      </g>
    );
  }

  if (n.kind === 'skill') {
    const below = p.y > 0;
    return (
      <g {...common} aria-label={`Bereich ${n.label}`}>
        <circle r={28} className="skill-disc" />
        <text y={below ? 52 : -42} textAnchor="middle" className="skill-label">{n.label}</text>
      </g>
    );
  }

  const cos = Math.cos(p.dir);
  const sin = Math.sin(p.dir);

  if (n.kind === 'track') {
    // Label beside the node, away from the branch: above for sideways branches, to the side for upright ones.
    const lines = wrap(n.label, 22);
    const sideways = Math.abs(cos) > 0.75;
    const anchor = sideways ? 'middle' : cos > 0 ? 'start' : cos < 0 ? 'end' : 'middle';
    const lx = sideways ? 0 : anchor === 'start' ? 28 : anchor === 'end' ? -28 : 0;
    const ly = sideways ? -32 - lines.length * 18 : sin < 0 ? 0 : -6;
    return (
      <g {...common} aria-label={`${n.label}, ${dccText}`}>
        <circle r={20} fill={color} className="track-disc" />
        {lines.map((line, i) => (
          <text key={i} x={lx} y={ly + i * 18} textAnchor={anchor} className="track-label">{line}</text>
        ))}
        <text x={lx} y={ly + lines.length * 18} textAnchor={anchor} className="track-dcc">{dccText}</text>
      </g>
    );
  }

  // Lesson node
  const lines = wrap(n.label, 20);
  const meta = lesson ? `${TYPE_LABEL[lesson.type]}, ${lesson.durationMin} Min.` : '';
  const result = n.state === 'done' && n.result ? (n.result.allMet ? 'gelöst' : 'mit Lücken') : '';
  const stateText =
    n.state === 'recommended' ? 'Nächster Schritt' : n.state === 'alternative' ? 'Alternative' : n.state === 'done' ? 'erledigt' : 'geplant';
  return (
    <g {...common} aria-label={`${n.label}. ${meta}. ${stateText}${result ? `, ${result}` : ''}`}>
      {n.state === 'recommended' && <circle r={24} className="halo" />}
      <circle r={13} className="lesson-disc" style={{ ['--tc' as string]: color }} />
      {n.state === 'done' && <path d="M-5 0 l3.5 4 l7 -8" className="check" />}
      {lesson?.type === 'video' && n.state !== 'done' && <path d="M-3.5 -5 L5 0 L-3.5 5 Z" className="glyph" />}
      {lesson?.type === 'ai-chat' && n.state !== 'done' && <path d="M-6 -4 h12 v7 h-7 l-3 3 v-3 h-2 z" className="glyph" />}
      {lesson?.type === 'mock-site' && n.state !== 'done' && <rect x={-6} y={-5} width={12} height={10} rx={1.5} className="glyph" />}
      {lesson?.type === 'mark-evidence' && n.state !== 'done' && <path d="M-5 -3 h10 M-5 0 h10 M-5 3 h6" className="glyph-line" />}
      {n.state === 'recommended' && <text y={-30} textAnchor="middle" className="tag-next">Nächster Schritt</text>}
      {n.state === 'alternative' && <text y={-24} textAnchor="middle" className="tag-alt">Alternative</text>}
      {n.addedByAgent && n.state !== 'done' && n.state !== 'recommended' && n.state !== 'alternative' && (
        <text y={-22} textAnchor="middle" className="tag-new">neu</text>
      )}
      {lines.map((line, i) => (
        <text key={i} y={30 + i * 15} textAnchor="middle" className="lesson-label">{line}</text>
      ))}
      <text y={30 + lines.length * 15} textAnchor="middle" className="lesson-meta">{result || meta}</text>
    </g>
  );
}
