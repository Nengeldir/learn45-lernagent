// Curated high-trust sources per track (data/resources/<trackId>.md, format of RESOURCES.md in the teach skill).
// Generated lessons may only draw on these, the track's criteria and its rules of thumb.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './content.ts';
import { section } from './md.ts';

export interface Resource {
  title: string;
  url: string;
  /** The annotation line: what it covers, when to use it */
  note: string;
}

const cache = new Map<string, Resource[]>();

export function resourcesOf(trackId: string): Resource[] {
  const hit = cache.get(trackId);
  if (hit) return hit;
  const file = join(DATA_DIR, 'resources', `${trackId}.md`);
  const out: Resource[] = [];
  if (existsSync(file)) {
    const lines = section(readFileSync(file, 'utf8'), 'Knowledge').split('\n');
    lines.forEach((line, i) => {
      const m = /^- \[(.+)\]\((https:\/\/[^)\s]+)\)\s*$/.exec(line.trim());
      if (m) out.push({ title: m[1], url: m[2], note: (lines[i + 1] ?? '').trim() });
    });
  }
  cache.set(trackId, out);
  return out;
}
