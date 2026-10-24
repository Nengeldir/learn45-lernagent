import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { Mode } from '@l45/shared';
import { LessonOverlay } from '../lessons/LessonOverlay.tsx';
import { api } from '../lib/api.ts';
import { LangSwitch, useI18n } from '../lib/i18n.tsx';
import { useStore } from '../lib/store.tsx';
import { MindMap } from '../map/MindMap.tsx';
import { KnowledgeMap } from '../map/SubwayMap.tsx';
import { NodePanel } from '../map/NodePanel.tsx';
import { ProfileDrawer } from './ProfileDrawer.tsx';

const STATUS: Record<string, string> = { online: 'KI an', offline: 'Ohne KI', simulation: 'KI simuliert aus' };
const BOARD_KEY = 'lernagent.board';

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
  const { view, content, setView, lessonOf, logout } = useStore();
  const { t, mode } = useI18n();
  const nav = useNavigate();
  const wide = useWide();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [lessonNode, setLessonNode] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [lens, setLens] = useState<Mode | 'all'>('all');
  const [routeTrackId, setRouteTrackId] = useState<string | null>(null);
  const [board, setBoard] = useState<'knot' | 'lines'>(() => (localStorage.getItem(BOARD_KEY) === 'lines' ? 'lines' : 'knot'));
  const chooseBoard = (next: 'knot' | 'lines') => {
    localStorage.setItem(BOARD_KEY, next);
    setBoard(next);
  };
  // A mountain opened from a knowledge knot leads back to that knot.
  const [fromKnot, setFromKnot] = useState(false);

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
    setFromKnot(false);
    setRouteTrackId(trackId);
  };
  const onMountain = board === 'lines' && routeTrackId !== null;

  return (
    <div className="mapscreen">
      <header className="topbar">
        <strong className="brand">{t('Lernagent')}</strong>
        <span className="who">{view.session.userName}</span>
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
        <LangSwitch />
        <span className={`status ${view.modelStatus}`} title={t('Ohne KI kommen Gesprächsantworten und Hinweise aus vorbereiteten Texten.')}>{t(STATUS[view.modelStatus] ?? '')}</span>
        <button className="time" onClick={() => setDrawer(true)}>{t('Noch {n} Min.', { n: view.remainingMin })}</button>
        <button className="btn quiet small" onClick={() => setDrawer(true)}>{t('Profil und Verlauf')}</button>
        <button className="btn quiet small" onClick={() => { logout(); nav('/'); }}>{t('Abmelden')}</button>
      </header>

      <main className="map-area">
        {board === 'knot' ? (
          <MindMap
            nodes={view.session.nodes}
            skills={content.skills}
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
            skills={content.skills}
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
              onMoreTime={async () => setView(await api.patch(view.session.id, { timeBudgetMin: view.session.timeBudgetMin + 10 }))}
            />
          )}
        </aside>
      </main>

      {lessonNode && <LessonOverlay nodeId={lessonNode} onClose={closeLesson} />}
      {drawer && <ProfileDrawer onClose={() => setDrawer(false)} />}
    </div>
  );
}
