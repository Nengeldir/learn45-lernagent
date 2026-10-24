// One topic as a straight line: the lessons already done, then "Wie geht es weiter?" to pick the next one.
import type { CSSProperties } from 'react';
import type { SessionView } from '@l45/shared';
import { TYPE_LABEL } from '@l45/shared';
import { NextTopics } from '../lessons/NextTopics.tsx';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { trackColors } from '../map/layout.ts';
import { pathOf } from './order.ts';

export function TrackView({ view, trackId, onStart }: {
  view: SessionView;
  trackId: string;
  onStart: (nodeId: string) => void;
}) {
  const { lessonOf } = useStore();
  const { session } = view;
  const track = view.skills.flatMap((s) => s.tracks).find((t) => t.id === trackId);
  if (!track) return null;
  const done = pathOf(session.nodes, track.id, session.events).filter((n) => n.state === 'done');
  const mission = view.workspace.missions.find((m) => m.trackId === track.id);
  const color = trackColors(session.nodes).get(track.id) ?? 'var(--ink)';

  return (
    <div className="track-view" style={{ ['--tc' as string]: color } as CSSProperties}>
      <header className="track-head">
        <h1 className="home-title">{track.name}</h1>
        <p className="muted">{done.length ? `${done.length} ${done.length === 1 ? 'Lektion' : 'Lektionen'} geschafft` : 'Hier beginnt dein Weg.'}</p>
        {mission && <p className="small"><strong>Dein Ziel:</strong> {mission.text}</p>}
      </header>

      <ol className="line">
        {done.map((n) => {
          const lesson = lessonOf(n.lessonId);
          return (
            <li key={n.id} className="line-step done">
              <span className="line-mark" aria-hidden="true"><Icon name="check" size={22} /></span>
              <span className="line-text">
                <strong>{n.label}</strong>
                <span className="small muted">{n.result?.allMet ? 'Geschafft' : 'Teilweise geschafft'}{lesson ? ` · ${TYPE_LABEL[lesson.type]}` : ''}</span>
              </span>
              <button className="btn quiet small" onClick={() => onStart(n.id)} aria-label={`«${n.label}» wiederholen`}>Wiederholen</button>
            </li>
          );
        })}
        <li className="line-step next">
          <span className="line-mark" aria-hidden="true"><Icon name="play" size={22} /></span>
          <div className="line-card">
            <NextTopics key={track.id} trackId={track.id} onStart={onStart} onFocus={() => {}} />
          </div>
        </li>
      </ol>
    </div>
  );
}
