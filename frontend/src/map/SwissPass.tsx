// The learning map drawn on Switzerland.
// Peak height follows the difficulty of the exercise. The line is the agent's path.
import type { Lesson, MapNode, Mode } from '@l45/shared';
import { MODE_LABEL } from '@l45/shared';
import { assignPass, pathEdges, type Station } from './passLayout.ts';
import { SWISS_LAKES, SWISS_PATH } from './swiss.ts';
import './swiss.css';

const LEVEL_DE: Record<string, string> = {
  Grundstufe: 'Grundstufe',
  Mittelstufe: 'Mittelstufe',
  Fortgeschritten: 'Fortgeschritten',
};

function Icon({ kind }: { kind: 'town' | 'peak' }) {
  if (kind === 'peak') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1.2 13.6 5.8 4.2 8 7.8 10.8 2.2 14.8 13.6Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 14V7.2L8 2.8l6 4.4V14H9.2V9.6H6.8V14Z" />
    </svg>
  );
}

export function SwissPass({
  nodes, lessonOf, selectedId, focusId, lens, wide, onSelect,
}: {
  nodes: MapNode[];
  lessonOf: (id?: string) => Lesson | undefined;
  selectedId: string | null;
  focusId: string | null;
  /** Dim exercises that are not in this learning form. */
  lens: Mode | 'all';
  wide: boolean;
  onSelect: (id: string | null) => void;
}) {
  const stations = assignPass(nodes, lessonOf);
  const edges = pathEdges(stations);
  const byId = new Map(stations.map((s) => [s.node.id, s]));
  const focus = focusId ? byId.get(focusId) : undefined;

  const matching = lens === 'all' ? stations.length : stations.filter((s) => lessonOf(s.node.lessonId)?.mode === lens).length;

  return (
    <div className={`swiss-stage${wide ? ' is-wide' : ''}`}>
      <p className="swiss-note">
        Die Höhe ist die Schwierigkeit der Übung. Grundstufe liegt tiefer, Fortgeschritten auf den hohen Gipfeln.
        Die Linie ist der Lernweg. Die DCC-Stufe bleibt, wo sie war.
      </p>
      <div className="swiss-board">
        <svg className="swiss-svg" viewBox="0 0 1000 640" role="img" aria-label="Lernweg auf der Schweizer Karte">
          <rect width="1000" height="640" fill="#d5e3ea" />
          <defs>
            <clipPath id="ch-clip"><path d={SWISS_PATH} /></clipPath>
          </defs>
          <path d={SWISS_PATH} fill="#f6f1e6" />
          <g clipPath="url(#ch-clip)">
            {SWISS_LAKES.map((lake) => (
              <ellipse key={lake.name} cx={lake.x} cy={lake.y} rx={lake.rx} ry={lake.ry} className="swiss-lake">
                <title>{lake.name}</title>
              </ellipse>
            ))}
          </g>
          <path d={SWISS_PATH} fill="none" stroke="#1c1915" strokeWidth="3" />
          {edges.map((edge) => (
            <line
              key={`${edge.from.node.id}-${edge.to.node.id}`}
              className={`${edge.branch ? 'swiss-branch' : 'swiss-path'}${edge.to.node.state === 'recommended' ? ' is-next' : ''}`}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
            />
          ))}
        </svg>
        {stations.map((station) => {
          const lesson = lessonOf(station.node.lessonId);
          const mode = lesson?.mode;
          const dim = lens !== 'all' && mode !== lens;
          const state = station.node.state ?? 'planned';
          const classes = [
            'swiss-pin',
            `is-${state}`,
            station.node.id === selectedId ? 'is-selected' : '',
            focus && station.node.id === focus.node.id ? 'is-focus' : '',
            dim ? 'is-dim' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={station.node.id}
              type="button"
              className={classes}
              style={{ left: `${station.x / 10}%`, top: `${(station.y / 640) * 100}%` }}
              onClick={() => onSelect(station.node.id)}
              aria-label={`${station.place.name}, ${station.place.m} Meter, ${LEVEL_DE[station.level]}, ${station.node.label}`}
            >
              <Icon kind={station.place.kind} />
              <em>{station.place.name}</em>
            </button>
          );
        })}
        <p className="swiss-credit">Umriss © OpenStreetMap-Mitwirkende</p>
        <div className="swiss-legend">
        <span><i className="dot planned" /> Geplant</span>
        <span><i className="dot recommended" /> Nächster Schritt</span>
        <span><i className="dot alternative" /> Alternative</span>
        <span><i className="dot done" /> Gemacht</span>
        <span>Linie = Lernweg{lens !== 'all' ? ` · ${MODE_LABEL[lens]}` : ''}</span>
        {lens !== 'all' && matching === 0 && <span>Auf diesem Weg gibt es noch keinen Schritt «{MODE_LABEL[lens]}». Der Agent ruft weiter den nächsten Schritt auf.</span>}
        </div>
      </div>
    </div>
  );
}

export function stationFor(nodes: MapNode[], lessonOf: (id?: string) => Lesson | undefined, nodeId: string | undefined): Station | undefined {
  if (!nodeId) return undefined;
  return assignPass(nodes, lessonOf).find((s) => s.node.id === nodeId);
}
