import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LessonOverlay } from '../lessons/LessonOverlay.tsx';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.tsx';
import { MindMap } from '../map/MindMap.tsx';
import { NodePanel } from '../map/NodePanel.tsx';
import { ProfileDrawer } from './ProfileDrawer.tsx';

const STATUS: Record<string, string> = { online: 'KI an', offline: 'Ohne KI', simulation: 'KI simuliert aus' };

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
  const nav = useNavigate();
  const wide = useWide();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [lessonNode, setLessonNode] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
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
        <strong className="brand">Lernagent</strong>
        <span className="who">{view.session.userName}</span>
        <span className="spacer" />
        {view.session.planning && <span className="status planning" role="status">Agent plant …</span>}
        <span className={`status ${view.modelStatus}`} title="Ohne KI kommen Gesprächsantworten und Hinweise aus vorbereiteten Texten.">{STATUS[view.modelStatus]}</span>
        <button className="time" onClick={() => setDrawer(true)}>Noch {view.remainingMin} Min.</button>
        <button className="btn quiet small" onClick={() => setDrawer(true)}>Profil und Verlauf</button>
        <button className="btn quiet small" onClick={() => { logout(); nav('/'); }}>Abmelden</button>
      </header>

      <main className="map-area">
        <MindMap
          nodes={view.session.nodes}
          skills={content.skills}
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
              onMoreTime={async () => setView(await api.patch(view.session.id, { timeBudgetMin: view.session.timeBudgetMin + 10 }))}
            />
          )}
        </aside>
      </main>

      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
      {lessonNode && <LessonOverlay nodeId={lessonNode} onClose={closeLesson} />}
      {drawer && <ProfileDrawer onClose={() => setDrawer(false)} />}
    </div>
  );
}
