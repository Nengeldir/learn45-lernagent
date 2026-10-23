import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { VideoLesson } from '@l45/shared';
import { parseVideoManifest } from './videoManifest.ts';

const lesson = JSON.parse(readFileSync(new URL('../../../data/lessons/t-analysis.json', import.meta.url), 'utf8'))[0] as VideoLesson;
const manifest = JSON.parse(readFileSync(new URL('../../public/videos/math-v1/manifest.json', import.meta.url), 'utf8'));
describe('video delivery envelope', () => {
  it('accepts the bundled lesson and rejects another lesson or missing scenes', () => {
    expect(parseVideoManifest(manifest, lesson).scenes).toHaveLength(4);
    expect(() => parseVideoManifest({ ...manifest, lessonId: 'another' }, lesson)).toThrow();
    expect(() => parseVideoManifest({ ...manifest, scenes: [] }, lesson)).toThrow();
  });
  it('rejects remote audio, duplicate scenes, and captions outside the audio clock', () => {
    for (const change of [
      (m: typeof manifest) => { m.scenes[0].audioUrl = 'https://example.com/audio.wav'; },
      (m: typeof manifest) => { m.scenes[1].id = m.scenes[0].id; },
      (m: typeof manifest) => { m.scenes[0].captions[0].end = 900; },
    ]) {
      const copy = structuredClone(manifest); change(copy);
      expect(() => parseVideoManifest(copy, lesson)).toThrow();
    }
  });
});
