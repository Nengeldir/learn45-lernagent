import type { MapNode, Mode as LessonMode } from '@l45/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LessonOverlay } from '../lessons/LessonOverlay.tsx';
import { api } from '../lib/api.ts';
import { LangSwitch, useI18n } from '../lib/i18n.tsx';
import { ThemeSwitch } from '../lib/theme.tsx';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { MindMap } from '../map/MindMap.tsx';
import { NodePanel } from '../map/NodePanel.tsx';
import { KnowledgeMap } from '../map/SubwayMap.tsx';
import { Topics } from '../path/Topics.tsx';
import { TrackView } from '../path/TrackView.tsx';
import { AddTrack } from './AddTrack.tsx';
import { Settings, STATUS } from './Settings.tsx';

/** The list of topics (and one topic as a line of lessons) or the whole mind map. Remembered per browser; the list is the default. */
type ViewMode = 'path' | 'map';
const MODE_KEY = 'lernagent.view';
const readMode = (): ViewMode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'map' ? 'map' : 'path';
  } catch {
    return 'path';
  }
};
const writeMode = (m: ViewMode) => {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
};

const BOARD_KEY = 'lernagent.board';
const storedBoard = (): 'knot' | 'lines' => {
  try {
    return localStorage.getItem(BOARD_KEY) === 'lines' ? 'lines' : 'knot';
  } catch {
    return 'knot';
  }
};

function useWide() {
  const q = '(min-width: 900px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

export function MapScreen() {
  const { view, content, setView, lessonOf, logout, refresh } = useStore();
  const { t, mode: lessonMode } = useI18n();
  const nav = useNavigate();
  const wide = useWide();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [lessonNode, setLessonNode] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  /** The topic open in the list view; null shows all topics. */
  const [openTrack, setOpenTrack] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [lens, setLens] = useState<LessonMode | 'all'>('all');
  const [lineBusy, setLineBusy] = useState(false);
  const [routeTrackId, setRouteTrackId] = useState<string | null>(null);
  const [board, setBoard] = useState<'knot' | 'lines'>(storedBoard);
  const chooseBoard = (next: 'knot' | 'lines') => {
    try {
      localStorage.setItem(BOARD_KEY, next);
    } catch {
      // The choice then lasts only for this visit.
    }
    setBoard(next);
  };
  // A mountain opened from a knowledge knot leads back to that knot.
  const [fromKnot, setFromKnot] = useState(false);
  const [viewMode, setViewModeState] = useState<ViewMode>(readMode);
  const setViewMode = (m: ViewMode) => {
    setViewModeState(m);
    writeMode(m);
  };

  // While the planner agent works, ask the server every 1.5 s. When it is done, its plan replaces the provisional one.
  const planning = Boolean(view?.session.planning);
  useEffect(() => {
    if (!planning) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const v = await refresh().catch(() => null);
      if (stop) return;
      if (v && !v.session.planning) {
        // An open lesson shows the next step itself; the toast would only cover its buttons.
        if (v.recommendation?.ruleId === 'A1' && !lessonNode) {
          setToast(t('Deine nächste Lektion ist bereit'));
          setFocusId(v.recommendation.nodeId);
        }
        return;
      }
      timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [planning, refresh, lessonNode, t]);

  useEffect(() => {
    const choices = view?.session.topicChoices;
    const recommended = choices?.topics.find((topic) => topic.recommended);
    if (!lessonNode && choices && recommended && (!selectedId || selectedId === `t-${choices.trackId}`)) {
      setFocusId(`preview-${recommended.id}`);
    }
  }, [view?.session.topicChoices?.id, lessonNode, selectedId]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  const closeLesson = useCallback((showNext: boolean) => {
    setLessonNode(null);
    if (showNext) {
      setSelectedId(null);
      setFocusId(null);
      requestAnimationFrame(() => setFocusId(view?.recommendation?.nodeId || null));
    }
  }, [view?.recommendation?.nodeId]);

  // Topic previews show on the map as possible branches; the lessons they would reuse step back meanwhile.
  const mapNodes = useMemo<MapNode[]>(() => {
    if (!view) return [];
    const choices = view.session.topicChoices;
    if (!choices) return view.session.nodes;
    const track = view.skills.flatMap((s) => s.tracks).find((tr) => tr.id === choices.trackId);
    const previews: MapNode[] = choices.topics.map((topic) => ({
      id: `preview-${topic.id}`, kind: 'lesson', parentId: choices.parentNodeId,
      label: topic.title, topicId: topic.id, trackId: choices.trackId, skillId: track?.skillId,
      state: topic.recommended ? 'recommended' : 'alternative',
    }));
    const previewedLessons = new Set(choices.topics.map((topic) => topic.lessonId).filter(Boolean));
    const existing = view.session.nodes.filter((n) => !(n.kind === 'lesson' && n.state !== 'done' && previewedLessons.has(n.lessonId) && !view.session.nodes.some((child) => child.parentId === n.id)));
    return [...existing.map((n) => n.state === 'recommended' || n.state === 'alternative' ? { ...n, state: 'planned' as const } : n), ...previews];
  }, [view]);

  if (!view || !content) return <Navigate to="/" replace />;
  const selected = mapNodes.find((n) => n.id === selectedId) ?? null;

  const back = viewMode === 'map' ? () => setViewMode('path') : openTrack ? () => setOpenTrack(null) : null;

  const select = (id: string | null) => {
    setSelectedId(id);
    setSheetOpen(true);
  };

  const openMountain = (trackId: string, nodeId?: string) => {
    setFromKnot(board === 'knot');
    chooseBoard('lines');
    setRouteTrackId(trackId);
    if (nodeId) select(nodeId);
  };
  const showKnot = (nodeId: string) => {
    setFromKnot(false);
    chooseBoard('knot');
    select(nodeId);
    setFocusId(null);
    requestAnimationFrame(() => setFocusId(nodeId));
  };
  const openRoute = (trackId: string | null) => {
    if (trackId === null && fromKnot && routeTrackId) {
      const knot = view.session.nodes.find((n) => n.kind === 'track' && n.trackId === routeTrackId);
      setRouteTrackId(null);
      if (knot) showKnot(knot.id);
      return;
    }
    if (trackId && !view.session.nodes.some((n) => n.kind === 'track' && n.trackId === trackId)) {
      if (lineBusy) return;
      setLineBusy(true);
      setToast(null);
      void api.addTracks(view.session.id, [trackId]).then((r) => {
        setView(r.view, r.generated);
        setFromKnot(false);
        setRouteTrackId(trackId);
      }).catch((e) => {
        setToast(e instanceof Error ? e.message : String(e));
      }).finally(() => setLineBusy(false));
      return;
    }
    setFromKnot(false);
    setRouteTrackId(trackId);
  };
  const onMountain = board === 'lines' && routeTrackId !== null;

  return (
    <div className="mapscreen">
      <header className="topbar">
        {back
          ? <button className="btn secondary small" onClick={back}><Icon name="back" size={18} />{t('Alle Themen')}</button>
          : <BrandMark />}
        <span className="spacer" />
        {viewMode === 'map' && (
          <>
            <div className="lens-switch" role="group" aria-label={t('Ansicht der Lernkarte')}>
              <button type="button" className="btn quiet small" aria-pressed={board === 'knot'} onClick={() => chooseBoard('knot')}>{t('Wissensknoten')}</button>
              <button type="button" className="btn quiet small" aria-pressed={board === 'lines'} onClick={() => chooseBoard('lines')}>{t('Bergwege')}</button>
            </div>
            <div className="lens-switch" role="group" aria-label={t('Lernform')}>
              <button type="button" className="btn quiet small" aria-pressed={lens === 'all'} onClick={() => setLens('all')}>{t('Alle')}</button>
              {(['alone', 'ai', 'peer'] as const).map((m) => (
                <button key={m} type="button" className="btn quiet small" aria-pressed={lens === m} onClick={() => setLens(m)}>{lessonMode(m)}</button>
              ))}
            </div>
          </>
        )}
        <ThemeSwitch />
        <LangSwitch />
        {view.session.planning && <span className="status planning" role="status">{t('Agent plant …')}</span>}
        <span className={`status ${view.modelStatus}`} title={t('Ohne KI kommen Gesprächsantworten und Hinweise aus vorbereiteten Texten.')}>{t(STATUS[view.modelStatus] ?? '')}</span>
        <button className="btn quiet small who" onClick={() => setSettings(true)} aria-label={t('Mein Konto ({name})', { name: view.session.userName })}>
          <span className="avatar" aria-hidden="true">{view.session.userName.slice(0, 1).toUpperCase()}</span>
          <span className="name">{t('Mein Konto')}</span>
        </button>
      </header>

      {viewMode === 'path' ? (
        <main className="path-area" key={openTrack ?? 'topics'}>
          {openTrack
            ? <TrackView view={view} trackId={openTrack} onStart={setLessonNode} />
            : <Topics view={view} onOpen={setOpenTrack} onOwnTopic={() => setAdding(true)} onShowMap={() => setViewMode('map')} />}
        </main>
      ) : (
        <main className="map-area">
          {board === 'knot' ? (
            <MindMap
              nodes={mapNodes}
              skills={view.skills}
              dcc={view.dcc}
              lessonOf={lessonOf}
              selectedId={selectedId}
              focusId={focusId}
              lens={lens}
              onSelect={select}
              onOpenMountain={(trackId) => openMountain(trackId)}
              rightInset={wide ? 400 : 0}
              bottomCoverage={!wide && sheetOpen ? 0.6 : 0}
            />
          ) : (
            <KnowledgeMap
              nodes={view.session.nodes}
              skills={view.skills.length ? view.skills : content.skills}
              dcc={view.dcc}
              lessonOf={lessonOf}
              selectedId={selectedId}
              focusId={focusId}
              lens={lens}
              wide={wide}
              routeTrackId={routeTrackId}
              backLabel={fromKnot ? t('Zurück zu den Wissensknoten') : undefined}
              onSelect={select}
              onOpenRoute={openRoute}
            />
          )}
          <aside className={`side${wide ? '' : ' sheet'}${!wide && !sheetOpen ? ' collapsed' : ''}`} aria-label={t('Details')}>
            {!wide && (
              <button className="sheet-handle" onClick={() => setSheetOpen(!sheetOpen)} aria-expanded={sheetOpen}>
                {sheetOpen ? t('Nach unten klappen') : t('Als Nächstes')}
              </button>
            )}
            {(wide || sheetOpen) && !lessonNode && (
              <NodePanel
                view={view}
                selected={selected}
                onSelect={(id) => {
                  select(id);
                  if (id) {
                    setFocusId(id);
                    const trackId = view.session.nodes.find((n) => n.id === id)?.trackId;
                    if (trackId && routeTrackId) setRouteTrackId(trackId);
                  }
                }}
                onStart={(id) => setLessonNode(id)}
                onShowMountain={onMountain ? undefined : openMountain}
                onShowKnot={board === 'lines' ? showKnot : undefined}
                onAddTrack={() => setAdding(true)}
                onFocus={(id) => {
                  setSelectedId(null);
                  setFocusId(null);
                  if (id) requestAnimationFrame(() => setFocusId(id));
                }}
              />
            )}
          </aside>
        </main>
      )}

      {toast && <div className="toast" role="status" aria-live="polite"><Icon name="sparkle" />{toast}</div>}
      {lessonNode && <LessonOverlay key={lessonNode} nodeId={lessonNode} onClose={closeLesson} />}
      {settings && <Settings onClose={() => setSettings(false)} onLogout={() => { logout(); nav('/'); }} />}
      {adding && (
        <AddTrack
          onClose={() => setAdding(false)}
          onAdded={(nodeId) => {
            setAdding(false);
            if (viewMode === 'path' && nodeId?.startsWith('t-')) return setOpenTrack(nodeId.slice(2));
            setSelectedId(nodeId?.startsWith('t-') ? nodeId : null);
            setSheetOpen(true);
            setFocusId(null);
            // After the first topic the whole map stays in view; later ones move to the new lesson.
            if (nodeId && view.skills.length) requestAnimationFrame(() => setFocusId(nodeId));
          }}
        />
      )}
    </div>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark">
      <img className="logo" src="/icons/owl.svg" alt="" width={32} height={32} />
      <span className="brand-name">Owl for <img className="learn45-mark" src="/icons/learn45.png" alt="Learn45" /></span>
    </span>
  );
}
