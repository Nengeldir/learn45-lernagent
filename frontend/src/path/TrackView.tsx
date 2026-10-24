// One topic as a climb: the mountain being climbed with its finished lessons and "Wie geht es weiter?" as the next
// step, then the mountains already topped, each named after what its lessons covered.
import { useState, type CSSProperties } from 'react';
import type { MapNode, SessionView } from '@l45/shared';
import { NextTopics } from '../lessons/NextTopics.tsx';
import { useI18n } from '../lib/i18n.tsx';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { trackColors } from '../map/layout.ts';
import { mountainsOf, STEPS_PER_MOUNTAIN } from './mountains.ts';
import { pathOf } from './order.ts';

export function TrackView({ view, trackId, onStart }: {
  view: SessionView;
  trackId: string;
  onStart: (nodeId: string) => void;
}) {
  const { lessonOf } = useStore();
  const { t, trackName } = useI18n();
  /** The step of the list the pointer or focus is on, highlighted on the mountain. */
  const [hover, setHover] = useState<number | null>(null);
  const { session } = view;
  const track = view.skills.flatMap((s) => s.tracks).find((tr) => tr.id === trackId);
  if (!track) return null;
  const done = pathOf(session.nodes, track.id, session.events).filter((n) => n.state === 'done');
  const mountains = mountainsOf(done, lessonOf, track.criteria);
  const current = mountains.at(-1)!;
  const topped = mountains.slice(0, -1).reverse();
  const left = STEPS_PER_MOUNTAIN - current.lessons.length;
  const mission = view.workspace.missions.find((m) => m.trackId === track.id);
  const color = trackColors(session.nodes).get(track.id) ?? 'var(--ink)';

  return (
    <div className="track-view" style={{ ['--tc' as string]: color } as CSSProperties}>
      <header className="track-head">
        <h1 className="home-title">{trackName(track.id, track.name)}</h1>
        {mission && <p className="small"><strong>{t('Dein Ziel:')}</strong> {t(mission.text)}</p>}
      </header>

      <section className="climb" aria-labelledby="climb-title">
        <div className="climb-visual">
          <div className="climb-head">
            <h2 id="climb-title">{t('Berg {n}', { n: current.number })}</h2>
            <span className="muted">{left === 1 ? t('Noch 1 Lektion bis zum Gipfel') : t('Noch {n} Lektionen bis zum Gipfel', { n: left })}</span>
          </div>
          <MountainArt steps={current.lessons.length} highlight={hover} label={t('{done} von {total} Lektionen', { done: current.lessons.length, total: STEPS_PER_MOUNTAIN })} />
        </div>
        <ol className="line">
          {current.lessons.map((n, i) => <DoneStep key={n.id} node={n} onStart={onStart} onPoint={(on) => setHover(on ? i : null)} />)}
          <li className="line-step next">
            <span className="line-mark" aria-hidden="true"><Icon name="play" size={22} /></span>
            <div className="line-card">
              <NextTopics key={track.id} trackId={track.id} onStart={onStart} onFocus={() => {}} />
            </div>
          </li>
        </ol>
      </section>

      {topped.length > 0 && (
        <section className="range" aria-labelledby="range-title">
          <h2 id="range-title">{t('Geschaffte Berge')}</h2>
          {topped.map((m) => (
            <details key={m.number} className="range-item">
              <summary>
                <MountainArt steps={STEPS_PER_MOUNTAIN} small />
                <span className="range-text">
                  <strong>{m.name ?? t('Berg {n}', { n: m.number })}</strong>
                  <span className="small muted">
                    {m.name ? `${t('Berg {n}', { n: m.number })} · ` : ''}{t('{done} von {total} Lektionen', { done: m.lessons.length, total: STEPS_PER_MOUNTAIN })}
                  </span>
                </span>
                <Icon name="chevron" size={22} />
              </summary>
              <ol className="line">
                {m.lessons.map((n) => <DoneStep key={n.id} node={n} onStart={onStart} />)}
              </ol>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

function DoneStep({ node, onStart, onPoint }: { node: MapNode; onStart: (nodeId: string) => void; onPoint?: (on: boolean) => void }) {
  const { lessonOf } = useStore();
  const { t, type, lessonTitle } = useI18n();
  const lesson = lessonOf(node.lessonId);
  const title = lessonTitle(node.lessonId, node.label);
  return (
    <li
      className="line-step done"
      onPointerEnter={() => onPoint?.(true)}
      onPointerLeave={() => onPoint?.(false)}
      onFocus={() => onPoint?.(true)}
      onBlur={() => onPoint?.(false)}
    >
      <span className="line-mark" aria-hidden="true"><Icon name="check" size={22} /></span>
      <span className="line-text">
        <strong>{title}</strong>
        <span className="small muted">{node.result?.allMet ? t('gelöst') : t('mit Lücken')}{lesson ? ` · ${type(lesson.type)}` : ''}</span>
      </span>
      <button className="btn quiet small" onClick={() => onStart(node.id)} aria-label={`${t('Nochmals')}: ${title}`}>{t('Nochmals')}</button>
    </li>
  );
}

// The mountain is drawn in a 320 × 220 box: a lighter range behind, the mountain with a shaded side and a snow cap,
// and the ground. Range and ground run on past the box, so they reach the edges of the card at any width. The six
// steps are placed by hand as switchbacks inside the mountain, the last one on the peak.
const GROUND = 206;
const STOPS = [
  { x: 110, y: 182 },
  { x: 214, y: 160 },
  { x: 124, y: 134 },
  { x: 198, y: 110 },
  { x: 152, y: 90 },
  { x: 160, y: 32 },
];

/** The mountain with its six steps. Finished steps carry a check, the next one is red like the next-step card,
 *  the rest show their number and the peak a flag. */
function MountainArt({ steps, small = false, highlight = null, label }: { steps: number; small?: boolean; highlight?: number | null; label?: string }) {
  const points = (list: { x: number; y: number }[]) => list.map((p) => `${p.x},${p.y}`).join(' ');
  const climbed = points(STOPS.slice(0, steps));
  return (
    <svg
      className={`mountain${small ? ' small' : ''}`}
      viewBox="0 0 320 220"
      preserveAspectRatio="xMidYMax meet"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path className="mountain-range" d="M-240 206 L-240 140 L-170 104 L-110 146 L-50 112 L0 150 L48 104 L86 136 L122 98 L160 130 L226 76 L276 120 L320 92 L370 134 L430 98 L500 142 L560 116 L560 206 Z" />
      <path className="mountain-body" d="M22 206 L116 84 L134 96 L160 22 L194 72 L212 62 L300 206 Z" />
      <path className="mountain-shade" d="M160 22 L194 72 L212 62 L300 206 L178 206 L186 128 L170 74 Z" />
      <path className="mountain-snow" d="M160 22 L179 50 L170 46 L162 55 L154 46 L150 50 Z" />
      <rect className="mountain-ground" x="-400" y={GROUND} width="1120" height={220 - GROUND} />
      {!small && <polyline className="mountain-trail" points={points(STOPS)} />}
      {steps > 1 && !small && <polyline className="mountain-climbed-halo" points={climbed} />}
      {steps > 1 && <polyline className="mountain-climbed" points={climbed} />}
      {STOPS.map((p, i) => {
        const state = i < steps ? 'done' : i === steps ? 'next' : 'open';
        return (
          <g key={i} className={`mountain-stop ${state}${highlight === i ? ' hl' : ''}`} transform={`translate(${p.x} ${p.y})`}>
            {state === 'next' && <circle r={17} className="mountain-stop-ring" />}
            <circle r={state === 'next' ? 12 : 10} />
            {!small && state === 'done' && <path className="glyph" d="M-4.5 0 l3 3.2 l6 -6.4" />}
            {!small && state === 'next' && <path className="glyph-fill" d="M-3.5 -5.5 L5.5 0 L-3.5 5.5 Z" />}
            {!small && state === 'open' && (i === STOPS.length - 1
              ? <path className="glyph" d="M-3 5 V-5.5 M-3 -5.5 L4.5 -3 L-3 -0.5" />
              : <text y={4}>{i + 1}</text>)}
          </g>
        );
      })}
    </svg>
  );
}
