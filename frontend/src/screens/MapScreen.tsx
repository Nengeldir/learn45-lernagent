import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { Mode } from '@l45/shared';
import { LessonOverlay } from '../lessons/LessonOverlay.tsx';
import { api } from '../lib/api.ts';
import { LangSwitch, useI18n } from '../lib/i18n.tsx';
import { ThemeSwitch } from '../lib/theme.tsx';
import { Icon } from '../lib/icons.tsx';
import { useStore } from '../lib/store.tsx';
import { MindMap } from '../map/MindMap.tsx';
import { NodePanel } from '../map/NodePanel.tsx';
import { KnowledgeMap } from '../map/SubwayMap.tsx';
import { AddTrack } from './AddTrack.tsx';
import { Settings, STATUS } from './Settings.tsx';

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
  const { t, mode } = useI18n();
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
  const [lens, setLens] = useState<Mode | 'all'>('all');
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
          setToast(t('Der Agent hat deinen Plan angepasst'));
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
  }, [planning, refresh, lessonNode, t]);

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
        <BrandMark />
        <span className="who">
          <span className="avatar" aria-hidden="true">{view.session.userName.slice(0, 1).toUpperCase()}</span>
          <span className="name">{view.session.userName}</span>
        </span>
        <span className="spacer" />
        <div className="lens-switch" role="group" aria-label={t('Ansicht der Lernkarte')}>
          <button type="button" className="btn quiet small" aria-pressed={board === 'knot'} onClick={() => chooseBoard('knot')}>{t('Wissensknoten')}</button>
          <button type="button" className="btn quiet small" aria-pressed={board === 'lines'} onClick={() => chooseBoard('lines')}>{t('Bergwege')}</button>
        </div>
        <div className="lens-switch" role="group" aria-label={t('Lernform')}>
          <button type="button" className="btn quiet small" aria-pressed={lens === 'all'} onClick={() => setLens('all')}>{t('Alle')}</button>
          {(['alone', 'ai', 'peer'] as const).map((m) => (
            <button key={m} type="button" className="btn quiet small" aria-pressed={lens === m} onClick={() => setLens(m)}>{mode(m)}</button>
          ))}
        </div>
        <ThemeSwitch />
        <LangSwitch />
        {view.session.planning && <span className="status planning" role="status">{t('Agent plant …')}</span>}
        <span className={`status ${view.modelStatus}`} title={t('Ohne KI kommen Gesprächsantworten und Hinweise aus vorbereiteten Texten.')}>{t(STATUS[view.modelStatus] ?? '')}</span>
        <button className="btn primary small" onClick={() => setAdding(true)} aria-label={t('Bereich hinzufügen')}>
          <Icon name="plus" size={16} /><span className="label-wide">{t('Bereich hinzufügen')}</span>
        </button>
        <button className="icon-btn" onClick={() => setSettings(true)} aria-label={t('Einstellungen')} title={t('Einstellungen')}>
          <Icon name="settings" size={20} />
        </button>
      </header>

      <main className="map-area">
        {board === 'knot' ? (
          <MindMap
            nodes={view.session.nodes}
            skills={view.skills}
            dcc={view.dcc}
            lessonOf={lessonOf}
            selectedId={selectedId}
            focusId={focusId}
            lens={lens}
            onSelect={select}
            onOpenMountain={(trackId) => openMountain(trackId)}
            rightInset={wide ? 400 : 0}
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
              {sheetOpen ? t('Einklappen') : t('Nächster Schritt')}
            </button>
          )}
          {(wide || sheetOpen) && (
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

      {toast && <div className="toast" role="status" aria-live="polite"><Icon name="sparkle" />{toast}</div>}
      {lessonNode && <LessonOverlay nodeId={lessonNode} onClose={closeLesson} />}
      {settings && <Settings onClose={() => setSettings(false)} onLogout={() => { logout(); nav('/'); }} />}
      {adding && (
        <AddTrack
          onClose={() => setAdding(false)}
          onAdded={(nodeId, openVideo) => {
            setAdding(false);
            setSelectedId(null);
            setSheetOpen(true);
            setFocusId(null);
            if (nodeId) requestAnimationFrame(() => setFocusId(nodeId));
            if (nodeId && openVideo) setLessonNode(nodeId);
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
