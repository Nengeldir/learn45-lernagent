// Playable demo of the mountain view with prepared data. No backend: finishing a lesson only flips its state here.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DccProfile, Lesson, MapNode, Skill } from '@l45/shared';
import { LangProvider, LangSwitch, useI18n } from '../src/lib/i18n.tsx';
import { ThemeSwitch } from '../src/lib/theme.tsx';
import { KnowledgeMap } from '../src/map/SubwayMap.tsx';
import { buildLines, climbStops } from '../src/map/subwayLayout.ts';
import data from './data.json';
import '../src/styles.css';
import './demo.css';

const skills = data.skills as unknown as Skill[];
const lessons = data.lessons as unknown as Lesson[];
const lessonOf = (id?: string) => lessons.find((l) => l.id === id);
const dcc = {
  source: 'manual',
  levels: { 't-info': 'Grundstufe', 't-komm': 'Mittelstufe', 't-inhalte': 'Grundstufe', 't-sicherheit': 'Mittelstufe', 't-problem': null },
} as unknown as DccProfile;

/** One chain of lessons per track, easiest first. */
function freshNodes(): MapNode[] {
  const rank = { Grundstufe: 0, Mittelstufe: 1, Fortgeschritten: 2 } as Record<string, number>;
  const nodes: MapNode[] = [];
  for (const skill of skills) {
    for (const track of skill.tracks) {
      const trackNode: MapNode = { id: `n-${track.id}`, kind: 'track', parentId: null, label: track.name, skillId: skill.id, trackId: track.id };
      nodes.push(trackNode);
      let parent = trackNode.id;
      lessons
        .filter((l) => l.trackId === track.id)
        .sort((a, b) => (rank[a.level] ?? 0) - (rank[b.level] ?? 0))
        .forEach((l) => {
          nodes.push({ id: `n-${l.id}`, kind: 'lesson', parentId: parent, label: l.title, skillId: skill.id, trackId: track.id, lessonId: l.id, state: 'planned' });
          parent = `n-${l.id}`;
        });
    }
  }
  return recommend(nodes);
}

/** The lowest open stop on each mountain is the next step, like the agent's R0. */
function recommend(nodes: MapNode[]): MapNode[] {
  const out = nodes.map((n) => (n.state === 'recommended' ? { ...n, state: 'planned' as const } : n));
  for (const line of buildLines(out, skills, dcc, lessonOf)) {
    const byHeight = climbStops(line.stops, line.mountain.metres).sort((a, b) => a.metres - b.metres);
    const first = byHeight.find((s) => s.node.state !== 'done');
    if (first) out[out.findIndex((n) => n.id === first.node.id)] = { ...first.node, state: 'recommended' };
  }
  return out;
}

function Demo() {
  const { t, lessonTitle, trackName } = useI18n();
  const [nodes, setNodes] = useState(freshNodes);
  const [route, setRoute] = useState<string | null>('t-info');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lines = useMemo(() => buildLines(nodes, skills, dcc, lessonOf), [nodes]);
  const line = lines.find((l) => l.trackId === route);
  const selected = nodes.find((n) => n.id === selectedId && n.trackId === route);
  const target = selected && selected.state !== 'done' ? selected : nodes.find((n) => n.trackId === route && n.state === 'recommended');

  const finish = (id: string) => {
    setNodes((ns) => recommend(ns.map((n) => (n.id === id ? { ...n, state: 'done' } : n))));
    setSelectedId(null);
  };
  const reset = () => {
    setNodes((ns) => recommend(ns.map((n) => (n.trackId === route && n.kind === 'lesson' ? { ...n, state: 'planned' } : n))));
    setSelectedId(null);
  };

  return (
    <div className="demo">
      <header className="demo-bar">
        <strong className="brand">{t('Lernagent')}</strong>
        <span className="demo-tag">{t('Demo mit Beispieldaten')}</span>
        <span className="spacer" />
        <ThemeSwitch />
        <LangSwitch />
      </header>
      {line && (
        <div className="demo-play">
          {target ? (
            <>
              <span>{t('Nächster Schritt')}: <b>{lessonTitle(target.lessonId, target.label)}</b></span>
              <button type="button" className="btn primary small" onClick={() => finish(target.id)}>{t('Lektion abschliessen')}</button>
            </>
          ) : (
            <span>{t('Alle Lektionen auf {name} erledigt.', { name: trackName(line.trackId, line.name) })}</span>
          )}
          <button type="button" className="btn quiet small" onClick={reset}>{t('Berg zurücksetzen')}</button>
        </div>
      )}
      <main className="demo-map">
        <KnowledgeMap
          nodes={nodes}
          skills={skills}
          dcc={dcc}
          lessonOf={lessonOf}
          selectedId={selectedId}
          focusId={null}
          lens="all"
          wide={false}
          routeTrackId={route}
          onSelect={setSelectedId}
          onOpenRoute={(id) => {
            setRoute(id);
            setSelectedId(null);
          }}
        />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Demo />
    </LangProvider>
  </StrictMode>,
);
