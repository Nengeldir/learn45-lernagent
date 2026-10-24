// One topic as a climb: the mountain being climbed with its finished lessons and "Wie geht es weiter?" as the next
// step, then the mountains already topped, each named after what its lessons covered.
import type { CSSProperties } from 'react';
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
        <div className="climb-head">
          <h2 id="climb-title">{t('Berg {n}', { n: current.number })}</h2>
          <span className="muted">{left === 1 ? t('Noch 1 Lektion bis zum Gipfel') : t('Noch {n} Lektionen bis zum Gipfel', { n: left })}</span>
        </div>
        <MountainArt steps={current.lessons.length} label={t('{done} von {total} Lektionen', { done: current.lessons.length, total: STEPS_PER_MOUNTAIN })} />
        <ol className="line">
          {current.lessons.map((n) => <DoneStep key={n.id} node={n} onStart={onStart} />)}
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

function DoneStep({ node, onStart }: { node: MapNode; onStart: (nodeId: string) => void }) {
  const { lessonOf } = useStore();
  const { t, type, lessonTitle } = useI18n();
  const lesson = lessonOf(node.lessonId);
  const title = lessonTitle(node.lessonId, node.label);
  return (
    <li className="line-step done">
      <span className="line-mark" aria-hidden="true"><Icon name="check" size={22} /></span>
      <span className="line-text">
        <strong>{title}</strong>
        <span className="small muted">{node.result?.allMet ? t('gelöst') : t('mit Lücken')}{lesson ? ` · ${type(lesson.type)}` : ''}</span>
      </span>
      <button className="btn quiet small" onClick={() => onStart(node.id)} aria-label={`${t('Nochmals')}: ${title}`}>{t('Nochmals')}</button>
    </li>
  );
}

// The mountain is drawn in a 320 × 180 box: peak at the top centre. The six steps are placed by hand as switchbacks,
// because evenly spaced heights crowd together where the mountain gets narrow.
const PEAK = { x: 160, y: 16 };
const FOOT = 170;
const STOPS = [
  { x: 96, y: 146 },
  { x: 214, y: 124 },
  { x: 118, y: 100 },
  { x: 192, y: 78 },
  { x: 140, y: 56 },
  { x: 160, y: 22 },
];

/** The mountain with its six steps. Finished steps are filled, the next one is ringed. */
function MountainArt({ steps, small = false, label }: { steps: number; small?: boolean; label?: string }) {
  const trail = [{ x: PEAK.x, y: FOOT - 4 }, ...STOPS];
  const points = (list: { x: number; y: number }[]) => list.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <svg
      className={`mountain${small ? ' small' : ''}`}
      viewBox="0 0 320 180"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path className="mountain-back" d="M150 170 L246 58 L318 170 Z" />
      <path className="mountain-body" d={`M10 ${FOOT} L${PEAK.x} ${PEAK.y} L310 ${FOOT} Z`} />
      <polyline className="mountain-trail" points={points(trail)} />
      {steps > 0 && <polyline className="mountain-climbed" points={points(trail.slice(0, steps + 1))} />}
      {STOPS.map((p, i) => (
        <g key={i} className={`mountain-stop ${i < steps ? 'done' : i === steps ? 'next' : 'open'}`} transform={`translate(${p.x} ${p.y})`}>
          <circle r={i === steps ? 11 : 9} />
          {i < steps && !small && <path d="M-4 0 l3 3 l5 -6" />}
        </g>
      ))}
    </svg>
  );
}
