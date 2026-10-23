// Loads the synthetic content from /data. Read-only at runtime.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Lesson, Skill, Track } from '@l45/shared';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR ?? join(here, '..', '..', 'data');

const readJson = <T,>(file: string): T => JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T;

function load() {
  const skills = readJson<Skill[]>('skills.json');
  const files = readdirSync(join(DATA_DIR, 'lessons')).filter((f) => f.endsWith('.json')).sort();
  const lessons = files.flatMap((f) => readJson<Lesson[]>(join('lessons', f)));

  const tracks = new Map(skills.flatMap((s) => s.tracks).map((t) => [t.id, t]));
  const ids = new Set<string>();
  for (const l of lessons) {
    if (ids.has(l.id)) throw new Error(`Doppelte Lektions-ID: ${l.id}`);
    ids.add(l.id);
    const track = tracks.get(l.trackId);
    if (!track) throw new Error(`Lektion ${l.id}: unbekannter Track ${l.trackId}`);
    const crit = new Set(track.criteria.map((c) => c.id));
    for (const t of l.targets) if (!crit.has(t)) throw new Error(`Lektion ${l.id}: unbekanntes Kriterium ${t}`);
  }
  return { skills, lessons };
}

export const content = load();

export const allTracks = (): Track[] => content.skills.flatMap((s) => s.tracks);
export const getTrack = (id: string) => allTracks().find((t) => t.id === id);
export const skillOf = (trackId: string) => content.skills.find((s) => s.tracks.some((t) => t.id === trackId));
export const criterionLabel = (trackId: string, id: string) => getTrack(trackId)?.criteria.find((c) => c.id === id)?.label ?? id;
export const ruleOfThumb = (trackId: string, id: string) => getTrack(trackId)?.criteria.find((c) => c.id === id)?.ruleOfThumb;
