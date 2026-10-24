import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LessonOverlay } from '../lessons/LessonOverlay.tsx';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { MindMap } from '../map/MindMap.tsx';
import { NodePanel } from '../map/NodePanel.tsx';
import { AddTrack } from './AddTrack.tsx';
import { Settings, STATUS } from './Settings.tsx';

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
        if (v.recommendation?.ruleId === 'A1') {
          setToast('Der Agent hat deinen Plan angepasst');
          if (!lessonNode) setFocusId(v.recommendation.nodeId);
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

  if (!view || !content) return <Navigate to="/" replace />;
  const selected = view.session.nodes.find((n) => n.id === selectedId) ?? null;

  const select = (id: string | null) => {
    setSelectedId(id);
    setSheetOpen(true);
  };

  return (
    <div className="mapscreen">
      <header className="topbar">
        <BrandMark />
        <span className="who">
          <span className="avatar" aria-hidden="true">{view.session.userName.slice(0, 1).toUpperCase()}</span>
          <span className="name">{view.session.userName}</span>
        </span>
        <span className="spacer" />
        {view.session.planning && <span className="status planning" role="status">Agent plant …</span>}
        <span className={`status ${view.modelStatus}`} title="Ohne KI kommen Gesprächsantworten und Hinweise aus vorbereiteten Texten.">{STATUS[view.modelStatus]}</span>
        <button className="btn primary small" onClick={() => setAdding(true)} aria-label="Bereich hinzufügen">
          <Icon name="plus" size={16} /><span className="label-wide">Bereich hinzufügen</span>
        </button>
        <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Einstellungen" title="Einstellungen">
          <Icon name="settings" size={20} />
        </button>
      </header>

      <main className="map-area">
        <MindMap
          nodes={view.session.nodes}
          skills={view.skills}
          dcc={view.dcc}
          lessonOf={lessonOf}
          selectedId={selectedId}
          focusId={focusId}
          onSelect={select}
          rightInset={wide ? 400 : 0}
        />
        <aside className={`side${wide ? '' : ' sheet'}${!wide && !sheetOpen ? ' collapsed' : ''}`} aria-label="Details">
          {!wide && (
            <button className="sheet-handle" onClick={() => setSheetOpen(!sheetOpen)} aria-expanded={sheetOpen}>
              {sheetOpen ? 'Einklappen' : 'Nächster Schritt'}
            </button>
          )}
          {(wide || sheetOpen) && (
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

      {toast && <div className="toast" role="status" aria-live="polite"><Icon name="sparkle" />{toast}</div>}
      {lessonNode && <LessonOverlay nodeId={lessonNode} onClose={closeLesson} />}
      {settings && <Settings onClose={() => setSettings(false)} onLogout={() => { logout(); nav('/'); }} />}
      {adding && (
        <AddTrack
          onClose={() => setAdding(false)}
          onAdded={(nodeId) => {
            setAdding(false);
            setSelectedId(null);
            setSheetOpen(true);
            setFocusId(null);
            if (nodeId) requestAnimationFrame(() => setFocusId(nodeId));
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
