import type { MapNode } from '@l45/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LessonOverlay } from '../lessons/LessonOverlay.tsx';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { MindMap } from '../map/MindMap.tsx';
import { NodePanel } from '../map/NodePanel.tsx';
import { LearningPath } from '../path/LearningPath.tsx';
import { AddTrack } from './AddTrack.tsx';
import { Settings } from './Settings.tsx';

/** Path (one topic as a line of lessons) or the whole mind map. Remembered per browser, the path is the default. */
type Mode = 'path' | 'map';
const MODE_KEY = 'lernagent.view';
const readMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'map' ? 'map' : 'path';
  } catch {
    return 'path';
  }
};
const writeMode = (m: Mode) => {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* storage unavailable: the choice lasts until reload */
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
  const { view, content, lessonOf, logout, refresh } = useStore();
  const nav = useNavigate();
  const wide = useWide();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [lessonNode, setLessonNode] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  // The map starts empty: the first thing to do is to choose what to learn.
  const [adding, setAdding] = useState(() => Boolean(view && !view.skills.length));
  const [sheetOpen, setSheetOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => {
    setModeState(m);
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
          setToast('Deine nächste Lektion ist bereit');
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
  }, [planning, refresh, lessonNode]);

  useEffect(() => {
    const choices = view?.session.topicChoices;
    const recommended = choices?.topics.find((t) => t.recommended);
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
    const track = view.skills.flatMap((s) => s.tracks).find((t) => t.id === choices.trackId);
    const previews: MapNode[] = choices.topics.map((t) => ({
      id: `preview-${t.id}`, kind: 'lesson', parentId: choices.parentNodeId,
      label: t.title, topicId: t.id, trackId: choices.trackId, skillId: track?.skillId,
      state: t.recommended ? 'recommended' : 'alternative',
    }));
    const previewedLessons = new Set(choices.topics.map((t) => t.lessonId).filter(Boolean));
    const existing = view.session.nodes.filter((n) => !(n.kind === 'lesson' && n.state !== 'done' && previewedLessons.has(n.lessonId) && !view.session.nodes.some((child) => child.parentId === n.id)));
    return [...existing.map((n) => n.state === 'recommended' || n.state === 'alternative' ? { ...n, state: 'planned' as const } : n), ...previews];
  }, [view]);

  if (!view || !content) return <Navigate to="/" replace />;
  const selected = mapNodes.find((n) => n.id === selectedId) ?? null;

  const select = (id: string | null) => {
    setSelectedId(id);
    setSheetOpen(true);
  };

  return (
    <div className="mapscreen">
      <header className="topbar">
        <BrandMark />
        <span className="spacer" />
        {mode === 'map' && (
          <button className="btn primary small" onClick={() => setMode('path')}>
            <Icon name="back" size={18} /><span className="label-wide">Zurück zum </span>Lernpfad
          </button>
        )}
        {/* On phones three buttons don't fit in map mode; the map's panel has its own "Neues Thema". */}
        <button className={`btn secondary small${mode === 'map' ? ' hide-narrow' : ''}`} onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} />Neues Thema
        </button>
        <button className="btn quiet small who" onClick={() => setSettings(true)} aria-label={`Mein Konto (${view.session.userName})`}>
          <span className="avatar" aria-hidden="true">{view.session.userName.slice(0, 1).toUpperCase()}</span>
          <span className="name">Mein Konto</span>
        </button>
      </header>

      {mode === 'path' ? (
        <main className="path-area">
          <LearningPath view={view} onStart={setLessonNode} onAddTrack={() => setAdding(true)} onShowMap={() => setMode('map')} />
        </main>
      ) : (
        <main className="map-area">
          <MindMap
            nodes={mapNodes}
            skills={view.skills}
            dcc={view.dcc}
            lessonOf={lessonOf}
            selectedId={selectedId}
            focusId={focusId}
            onSelect={select}
            rightInset={wide ? 400 : 0}
            bottomCoverage={!wide && sheetOpen ? 0.6 : 0}
          />
          <aside className={`side${wide ? '' : ' sheet'}${!wide && !sheetOpen ? ' collapsed' : ''}`} aria-label="Details">
            {!wide && (
              <button className="sheet-handle" onClick={() => setSheetOpen(!sheetOpen)} aria-expanded={sheetOpen}>
                {sheetOpen ? 'Nach unten klappen' : 'Als Nächstes'}
              </button>
            )}
            {(wide || sheetOpen) && !lessonNode && (
              <NodePanel
                view={view}
                selected={selected}
                onSelect={(id) => {
                  select(id);
                  if (id) setFocusId(id);
                }}
                onStart={(id) => setLessonNode(id)}
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
            setSelectedId(nodeId?.startsWith('t-') ? nodeId : null);
            setSheetOpen(true);
            setFocusId(null);
            // After the first topic the whole map stays in view; later ones move to the new lesson.
            if (nodeId && view.skills.length) requestAnimationFrame(() => setFocusId(nodeId));
            // The next topic and its format are chosen in the side panel.
          }}
        />
      )}
    </div>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark">
      <span className="logo"><Icon name="map" size={18} /></span>
      Lernagent
    </span>
  );
}
