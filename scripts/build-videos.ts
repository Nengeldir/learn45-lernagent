import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { content } from '../backend/src/content.ts';
import { buildVideo, planHash, readManifest } from '../backend/src/video/build.ts';
import { Speech, speechConfig } from '../backend/src/video/speech.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(join(root, 'backend/.env'))) process.loadEnvFile(join(root, 'backend/.env'));
const args = process.argv.slice(2), all = args.includes('--all');
const id = args.find(arg => !arg.startsWith('--'));
if (!all && !id) throw new Error('Aufruf: npm run videos:build -- --all oder npm run videos:build -- <lesson-id>');
const lessons = content.lessons.filter(lesson => lesson.type === 'video' && (all || lesson.id === id));
if (!lessons.length) throw new Error('Keine passende Video-Lektion gefunden.');
const config = speechConfig();
const speaker = new Speech(config, process.env.VIDEO_SPEECH_CACHE_DIR ?? join(root, 'backend/var/video-speech'), args.includes('--retry-failed'));
for (const lesson of lessons) {
  if (lesson.type !== 'video') continue;
  if (!/^[\w-]{1,120}$/.test(lesson.id)) throw new Error('Die Lektions-ID muss aus Buchstaben, Ziffern, Bindestrich oder Unterstrich bestehen.');
  const output = join(root, 'frontend/public/videos', lesson.id);
  const existing = await readManifest(join(output, 'manifest.json'));
  // Preserve reviewed custom animations and speech, including the derivative lesson.
  if (lesson.content.narrated && existing && !args.includes('--replace-custom')) {
    console.log(`${lesson.title}: vorhandenes geprüftes Video beibehalten.`); continue;
  }
  if (existing?.scriptHash === planHash(lesson) && existing.narration.provider === config.provider && existing.narration.voice === config.voice && existing.narration.model === config.model && !args.includes('--force')) {
    console.log(`${lesson.title}: bereits aktuell, keine Sprachaufrufe.`); continue;
  }
  await buildVideo(lesson, output, `/videos/${lesson.id}`, speaker,
    (completed, total) => console.log(`${lesson.title}: Szene ${completed}/${total}`));
  console.log(`${lesson.title}: veröffentlicht.`);
}
