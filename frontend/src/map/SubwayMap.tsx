// Knowledge graph drawn as a subway map. Each line opens one mountain path.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DccProfile, Lesson, MapNode, Mode, Skill } from '@l45/shared';
import { useI18n } from '../lib/i18n.tsx';
import { buildLines, climbStops, DEPTH_LABEL, lineByTrack, PEAK_SCENE, yFromMetres, type Line, type Stop } from './subwayLayout.ts';
import { CABLE, Cheer, cableAt, GondolaFigure, HikerFigure, pct, pointAt, useClimb, type TrailPoint } from './Climber.tsx';
import './subway.css';

const TOGETHER_KEY = 'lernagent.together';
const FRIEND_KEY = 'lernagent.friend';
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice lives only in memory */
  }
};

function stopClass(stop: Stop, selectedId: string | null, focusId: string | null, dim: boolean) {
  const state = stop.node.state ?? 'planned';
  return [
    'kb-stop',
    `is-${state}`,
    stop.row > 0 ? 'is-spur' : '',
    stop.node.id === selectedId ? 'is-selected' : '',
    stop.node.id === focusId ? 'is-focus' : '',
    dim ? 'is-dim' : '',
  ].filter(Boolean).join(' ');
}

function Subway({
  lines, lessonOf, selectedId, focusId, lens, onSelect, onOpen,
}: {
  lines: Line[];
  lessonOf: (id?: string) => Lesson | undefined;
  selectedId: string | null;
  focusId: string | null;
  lens: Mode | 'all';
  onSelect: (id: string) => void;
  onOpen: (trackId: string) => void;
}) {
  const { t, level, lessonTitle, trackName } = useI18n();
  let skill = '';
  return (
    <div className="metro">
      {lines.map((line) => {
        const showSkill = line.skillName !== skill;
        skill = line.skillName;
        const width = Math.max(120, (Math.max(0, ...line.stops.map((s) => s.col))) * 156 + 48);
        return (
          <div key={line.trackId}>
            {showSkill && <p className="metro-skill">{t(line.skillName)}</p>}
            <section className="metro-line" style={{ '--line-color': line.color } as CSSProperties}>
              <button type="button" className="metro-name" onClick={() => onOpen(line.trackId)}>
                <span className="metro-badge">{line.area ?? '·'}</span>
                <span>
                  <strong>{trackName(line.trackId, line.name)}</strong>
                  <small>{line.mountain.name} · {t('Bergweg')}</small>
                  <small>{line.dccBased ? t('DCC {level}', { level: level(line.dcc) }) : t('ohne DCC')}</small>
                </span>
              </button>
              <div className="metro-rail" style={{ width }}>
                <span className="rail" style={{ width: Math.max(36, width - 24) }} />
                {line.stops.filter((s) => s.row > 0).map((s) => (
                  <span key={`spur-${s.node.id}`} className="spur" style={{ left: (s.col - 1) * 156 + 28 }} />
                ))}
                {line.stops.map((stop) => {
                  const lesson = lessonOf(stop.node.lessonId);
                  const dim = lens !== 'all' && lesson?.mode !== lens;
                  return (
                    <button
                      key={stop.node.id}
                      type="button"
                      className={stopClass(stop, selectedId, focusId, dim)}
                      style={{ left: (stop.col - 1) * 156 + 28 }}
                      onClick={() => {
                        onSelect(stop.node.id);
                        onOpen(line.trackId);
                      }}
                      aria-label={`${line.mountain.name}, ${lessonTitle(stop.node.lessonId, stop.node.label)}, ${t(DEPTH_LABEL[stop.depth])}, ${level(stop.level)}`}
                    >
                      <em>{lessonTitle(stop.node.lessonId, stop.node.label)}</em>
                    </button>
                  );
                })}
                {line.stops.length === 0 && <span className="rail-empty">{line.onMap ? t('noch keine Übung') : t('noch nicht auf der Karte')}</span>}
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}

function Summit({
  name, metres, note, onClose,
}: {
  name: string;
  metres: number;
  note?: string;
  onClose: () => void;
}) {
  const [holds, setHolds] = useState(0);
  const [signed, setSigned] = useState(false);
  const { t } = useI18n();
  return (
    <div className="summit" role="dialog" aria-label={t('Gipfel {name}', { name })}>
      <p className="summit-kicker">{t('Gipfel')}</p>
      <h3>{name} · {metres} m</h3>
      {holds < 3 ? (
        <>
          <p>{t('Drei Sicherungen, dann steht die Fahne. Das ist ein Spiel am Gipfel, keine Bewertung.')}</p>
          <div className="holds" aria-label={t('{holds} von 3 Sicherungen', { holds })}>
            {[0, 1, 2].map((i) => <i key={i} className={i < holds ? 'in' : ''} />)}
          </div>
          <button type="button" className="btn primary" onClick={() => setHolds(holds + 1)}>
            {t('Sicherung {n} setzen', { n: holds + 1 })}
          </button>
        </>
      ) : signed ? (
        <>
          <p className="summit-flag">{t('Die Fahne steht auf {metres} m.', { metres })}</p>
          <p>{note ?? t('Du hast den geplanten Weg dieser Linie geschafft.')}</p>
          <p className="small">{t('Im Gipfelbuch, nicht im DCC. Die Stufe bleibt, wo sie war.')}</p>
          <button type="button" className="btn secondary" onClick={onClose}>{t('Weiter')}</button>
        </>
      ) : (
        <>
          <p className="summit-flag">{t('Fahne gesetzt.')}</p>
          <p>{note ?? t('Trag einen Satz ins Gipfelbuch ein.')}</p>
          <button type="button" className="btn primary" onClick={() => setSigned(true)}>{t('Ins Gipfelbuch')}</button>
        </>
      )}
    </div>
  );
}

function Mountain({
  line, lessonOf, selectedId, focusId, lens, backLabel, onSelect, onBack,
}: {
  line: Line;
  lessonOf: (id?: string) => Lesson | undefined;
  selectedId: string | null;
  focusId: string | null;
  lens: Mode | 'all';
  backLabel?: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const [summitOpen, setSummitOpen] = useState(false);
  const [together, setTogether] = useState(() => stored(TOGETHER_KEY) === '1');
  const [friend, setFriend] = useState(() => stored(FRIEND_KEY) || 'Sam');
  const [replay, setReplay] = useState(0);
  const [cheer, setCheer] = useState<{ x: number; y: number; label: string; big: boolean; key: number } | null>(null);
  const { t, level, lessonTitle, trackName, mode } = useI18n();
  const summit = line.mountain.metres > 0 ? line.mountain.metres : 1000;
  const placed = climbStops(line.stops, summit);
  const byHeight = [...placed].sort((a, b) => a.metres - b.metres);
  const done = byHeight.filter((s) => s.node.state === 'done');
  const here = done.at(-1)?.metres ?? 0;
  const next = byHeight.find((s) => s.node.state !== 'done' && s.node.state !== 'skipped');
  const topped = placed.length > 0 && placed.every((s) => s.node.state === 'done');
  const lastLesson = lessonOf(done.at(-1)?.node.lessonId);
  const matching = lens === 'all' ? placed.length : placed.filter((s) => lessonOf(s.node.lessonId)?.mode === lens).length;

  // The trail starts at the trailhead below the lowest stop. The climber stands on the highest stop that is done.
  const trail: TrailPoint[] = [
    { x: PEAK_SCENE.peakX - 120, y: PEAK_SCENE.baseY + 24, metres: 0 },
    ...byHeight.map((s) => ({ x: s.x, y: s.y, metres: s.metres })),
  ];
  const reached = done.length ? byHeight.indexOf(done.at(-1)!) + 1 : 0;
  const pos = useClimb(reached, replay);
  const me = pointAt(trail, pos);
  const moving = pos !== reached;
  const climbed = trail.slice(0, Math.floor(pos) + 1).concat(pos % 1 ? [me] : []);
  const cabin = cableAt(me.y);

  // Cheer once each time a new stop is reached while this mountain is open. The first walk up is only the intro.
  const seen = useRef(reached);
  useEffect(() => {
    if (moving || reached <= seen.current) return;
    const gained = Math.round(trail[reached].metres - trail[seen.current].metres);
    seen.current = reached;
    const at = topped ? { x: PEAK_SCENE.peakX, y: PEAK_SCENE.peakY } : together ? cabin : me;
    setCheer({ ...at, label: topped ? t('Gipfel!') : `+${gained} m`, big: topped, key: Date.now() });
  }, [moving, reached]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cheer) return;
    const id = window.setTimeout(() => setCheer(null), 1800);
    return () => window.clearTimeout(id);
  }, [cheer]);

  const toggleTogether = () => {
    store(TOGETHER_KEY, together ? '0' : '1');
    setTogether(!together);
  };
  // The bubble points where the agent points, so the climber never contradicts the recommendation.
  const goal = placed.find((s) => s.node.state === 'recommended') ?? next;
  const goalTitle = goal ? lessonTitle(goal.node.lessonId, goal.node.label) : '';
  const bubble = moving || cheer
    ? null
    : topped
      ? t('Ganz oben. Setz die Fahne!')
      : goal
        ? t('Weiter: {title}', { title: goalTitle })
        : null;
  const goNext = () => {
    if (topped) setSummitOpen(true);
    else if (goal) onSelect(goal.node.id);
  };

  return (
    <div className={`peak${together ? ' is-together' : ''}`} style={{ '--line-color': line.color } as CSSProperties}>
      <div className="peak-head">
        <button type="button" className="linkbtn" onClick={onBack}>{backLabel ?? t('Zurück zum Netz')}</button>
        <h2>{line.mountain.name}</h2>
        <p className="climb-hud">
          {topped
            ? t('{here} m von {summit} m · Gipfel erreicht', { here, summit })
            : next
              ? t('{here} m von {summit} m · nächster Aufstieg {next} m', { here, summit, next: next.metres })
              : t('{here} m von {summit} m', { here, summit })}
          <button type="button" className="btn secondary small" onClick={() => setSummitOpen(true)}>
            {topped ? t('Fahne setzen') : t('Zum Gipfel')}
          </button>
        </p>
        <div
          className="climb-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={summit}
          aria-valuenow={here}
          aria-label={t('{done} von {total} Stationen', { done: done.length, total: placed.length })}
          style={{ '--climbed': `${(me.metres / summit) * 100}%` } as CSSProperties}
        >
          <small>{t('{done} von {total} Stationen', { done: done.length, total: placed.length })}</small>
        </div>
        <div className="climb-tools">
          <button type="button" className="btn quiet small" aria-pressed={together} onClick={toggleTogether}>
            <span aria-hidden="true">🚠</span> {t('Mit Freund lernen')}
          </button>
          {together && (
            <label className="friend-name">
              <span>{t('Lernpartner')}</span>
              <input
                value={friend}
                maxLength={20}
                onChange={(e) => {
                  setFriend(e.target.value);
                  store(FRIEND_KEY, e.target.value);
                }}
              />
            </label>
          )}
          <button type="button" className="btn quiet small" onClick={() => setReplay(replay + 1)} disabled={reached === 0}>
            {t('Aufstieg nochmals zeigen')}
          </button>
        </div>
        <p>
          {together
            ? t('Zu zweit nehmt ihr die Seilbahn. {friend} fährt mit. Die Meter gehören euch beiden, das DCC bleibt, wo es war.', { friend: friend || t('Dein Freund') })
            : t('Du steigst auf. Leichtere Übungen liegen tiefer, schwierigere näher am Gipfel.')}
          {line.dccBased ? ` ${t('DCC dieser Linie: {level}. Die Meter ändern sie nicht.', { level: level(line.dcc) })}` : ''}
        </p>
      </div>
      <div className="peak-board">
        <svg className="peak-svg" viewBox={`0 0 ${PEAK_SCENE.w} ${PEAK_SCENE.h}`} aria-hidden="true">
          <defs>
            <linearGradient id="peak-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8ed4f8" />
              <stop offset="1" stopColor="#e7f6ff" />
            </linearGradient>
          </defs>
          <rect width={PEAK_SCENE.w} height={PEAK_SCENE.h} fill="url(#peak-sky)" />
          <g fill="#fff" className="clouds">
            <ellipse cx="92" cy="58" rx="48" ry="18" />
            <ellipse cx="126" cy="50" rx="30" ry="16" />
            <ellipse cx="530" cy="96" rx="58" ry="20" />
            <ellipse cx="574" cy="88" rx="28" ry="14" />
          </g>
          <g fill="#fff">
            <ellipse cx="70" cy="500" rx="90" ry="26" />
            <ellipse cx="230" cy="518" rx="130" ry="30" />
            <ellipse cx="430" cy="512" rx="150" ry="34" />
            <ellipse cx="580" cy="500" rx="80" ry="24" />
          </g>
          <path fill="#4a5c74" d="M48 500 L214 250 L268 196 L328 86 L392 176 L470 236 L610 500 Z" />
          <path fill="#3c4d64" d="M90 500 L230 268 L286 214 L240 300 L150 500 Z" />
          <path fill="#5c6e86" d="M328 86 L404 188 L486 248 L610 500 L430 500 L392 176 Z" />
          <path fill="#f7fbff" d="M328 86 L392 172 L348 156 L312 184 L286 146 L312 112 Z" />
          <path fill="#e7f0f8" d="M236 228 L286 188 L318 222 L274 258 Z" />
          <path fill="#f7fbff" d="M404 196 L462 244 L430 276 L386 232 Z" />
          <path fill="#eef4fa" d="M176 332 L230 292 L258 334 L206 366 Z" />
          <path fill="#f7fbff" d="M430 300 L490 340 L452 372 L400 338 Z" />
          {together && (
            <g className="cable">
              <line x1={CABLE.x1} y1={CABLE.y1} x2={CABLE.x2} y2={CABLE.y2} />
              <rect x={CABLE.x1 - 16} y={CABLE.y1 - 4} width="32" height="20" rx="3" fill="#7a4a24" />
              <rect x={CABLE.x2 - 14} y={CABLE.y2 - 6} width="28" height="18" rx="3" fill="#7a4a24" />
              <line className="pylon" x1="185" y1="304" x2="185" y2="400" />
            </g>
          )}
          {trail.length > 1 && (
            <polyline className="trail" points={trail.map((s) => `${s.x},${s.y}`).join(' ')} fill="none" />
          )}
          {climbed.length > 1 && (
            <polyline className="trail-climbed" points={climbed.map((s) => `${s.x},${s.y}`).join(' ')} fill="none" />
          )}
          <circle className="trailhead" cx={trail[0].x} cy={trail[0].y} r="6" />
        </svg>
        <div className="metre-scale" aria-hidden="true">
          {[1, 0.5, 0].map((t) => (
            <span key={t} style={{ top: `${(yFromMetres(summit * t, summit) / PEAK_SCENE.h) * 100}%` }}>
              {Math.round(summit * t)} m
            </span>
          ))}
        </div>
        <button
          type="button"
          className={`peak-flag${topped ? ' is-topped' : ''}`}
          style={{ left: `${(PEAK_SCENE.peakX / PEAK_SCENE.w) * 100}%`, top: `${(PEAK_SCENE.peakY / PEAK_SCENE.h) * 100}%` }}
          onClick={() => setSummitOpen(true)}
        >
          <i />
          <span>{trackName(line.trackId, line.name)}</span>
        </button>
        {placed.map((stop) => {
          const lesson = lessonOf(stop.node.lessonId);
          const title = lessonTitle(stop.node.lessonId, stop.node.label);
          const dim = lens !== 'all' && lesson?.mode !== lens;
          return (
            <button
              key={stop.node.id}
              type="button"
              className={`${stopClass(stop, selectedId, focusId, dim)}${stop.x > PEAK_SCENE.peakX ? ' label-left' : ''}`}
              style={{ left: `${(stop.x / PEAK_SCENE.w) * 100}%`, top: `${(stop.y / PEAK_SCENE.h) * 100}%` }}
              onClick={() => onSelect(stop.node.id)}
              aria-label={`${stop.metres} m, ${t(DEPTH_LABEL[stop.depth])}, ${level(stop.level)}, ${title}`}
            >
              {lesson?.mode === 'peer' && <span className="peer-badge" aria-hidden="true">🚠</span>}
              <em><b>{stop.metres} m</b> {title}</em>
            </button>
          );
        })}
        {together ? (
          <button
            type="button"
            className={`gondola${moving ? ' is-moving' : ''}`}
            style={pct(cabin.x, cabin.y)}
            onClick={goNext}
            aria-label={t('Du und {friend}, {here} m', { friend: friend || t('Dein Freund'), here: Math.round(me.metres) })}
          >
            <GondolaFigure color={line.color} />
            <span className="gondola-names">{t('Du')} + {friend || t('Dein Freund')}</span>
            {bubble && <span className="climber-bubble">{bubble}</span>}
          </button>
        ) : (
          <button
            type="button"
            className={`hiker${me.facing < 0 ? ' is-left' : ''}`}
            style={pct(me.x, me.y)}
            onClick={goNext}
            aria-label={t('Du, {here} m', { here: Math.round(me.metres) })}
          >
            <HikerFigure color={line.color} walking={moving} />
            {bubble && <span className="climber-bubble">{bubble}</span>}
          </button>
        )}
        {cheer && <Cheer key={cheer.key} x={cheer.x} y={cheer.y} label={cheer.label} big={cheer.big} />}
        {placed.length === 0 && <p className="peak-empty">{t('Auf diesem Bergweg ist noch keine Übung geplant.')}</p>}
        {lens !== 'all' && matching === 0 && placed.length > 0 && (
          <p className="peak-empty">{t('Auf diesem Weg gibt es keinen Schritt «{mode}». Der Agent ruft weiter den nächsten Schritt auf.', { mode: mode(lens) })}</p>
        )}
        {summitOpen && (topped ? (
          <Summit
            name={line.mountain.name}
            metres={summit}
            note={lastLesson?.transfer}
            onClose={() => setSummitOpen(false)}
          />
        ) : (
          <div className="summit" role="dialog" aria-label={t('Noch nicht oben')}>
            <p className="summit-kicker">{t('Noch nicht oben')}</p>
            <h3>{line.mountain.name} · {summit} m</h3>
            <p>{t('Du stehst auf {here} m. Schliesse die Aufstiege ab, dann setzt du die Fahne. Drei Sicherungen, ein Satz ins Gipfelbuch.', { here })}</p>
            <button type="button" className="btn secondary" onClick={() => setSummitOpen(false)}>{t('Weiter steigen')}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KnowledgeMap({
  nodes, skills, dcc, lessonOf, selectedId, focusId, lens, wide, routeTrackId, backLabel, onSelect, onOpenRoute,
}: {
  nodes: MapNode[];
  skills: Skill[];
  dcc: DccProfile;
  lessonOf: (id?: string) => Lesson | undefined;
  selectedId: string | null;
  focusId: string | null;
  lens: Mode | 'all';
  wide: boolean;
  routeTrackId: string | null;
  /** Label of the way back from a mountain, when it was opened from somewhere else than the line network */
  backLabel?: string;
  onSelect: (id: string | null) => void;
  onOpenRoute: (trackId: string | null) => void;
}) {
  const lines = buildLines(nodes, skills, dcc, lessonOf);
  const route = lineByTrack(lines, routeTrackId);
  const { t, mode } = useI18n();
  const lensHits = lens === 'all' || lines.some((line) => line.stops.some((s) => lessonOf(s.node.lessonId)?.mode === lens));
  const waiting = lines.length > 0 && lines.every((line) => line.stops.length === 0);
  return (
    <div className={`kb${wide ? ' is-wide' : ''}`}>
      <p className="kb-note">
        {route
          ? t('{mountain}, {metres} m. Der Weg führt nach oben. Die Meter gehören zur Übung, nicht zur DCC-Stufe.', { mountain: route.mountain.name, metres: route.mountain.metres })
          : waiting
            ? t('Die Linien sind die Wissensbereiche. Ein Klick legt den Bereich auf deine Karte und öffnet den Berg.')
            : `${t('Jede Linie ist ein Wissensbereich. Ein Klick öffnet den Bergweg. Die Tiefe dort folgt der Schwierigkeit der Übung, nicht der DCC-Stufe.')}${lens !== 'all' && !lensHits ? ` ${t('Auf diesem Netz gibt es noch keinen Schritt «{mode}». Die anderen Schritte bleiben auf der Linie.', { mode: mode(lens) })}` : ''}`}
      </p>
      {route ? (
        <Mountain
          line={route}
          lessonOf={lessonOf}
          selectedId={selectedId}
          focusId={focusId}
          lens={lens}
          backLabel={backLabel}
          onSelect={(id) => onSelect(id)}
          onBack={() => onOpenRoute(null)}
        />
      ) : (
        <Subway
          lines={lines}
          lessonOf={lessonOf}
          selectedId={selectedId}
          focusId={focusId}
          lens={lens}
          onSelect={(id) => onSelect(id)}
          onOpen={onOpenRoute}
        />
      )}
    </div>
  );
}
