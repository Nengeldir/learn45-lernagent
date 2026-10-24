import { createHash } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute } from 'node:path';
import type { LessonType } from '@l45/shared';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const AUDIO_RATE = 24000;
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export interface SpeechConfig { provider: 'local' | 'elevenlabs'; voice: string; model: string }
export function speechConfig(): SpeechConfig {
  const provider = process.env.VIDEO_SPEECH_PROVIDER?.trim() || (process.env.ELEVENLABS_API_KEY?.trim() ? 'elevenlabs' : 'local');
  if (provider !== 'local' && provider !== 'elevenlabs') throw new Error('Unbekannter Sprachdienst.');
  return { provider, voice: provider === 'local' ? process.env.VIDEO_LOCAL_VOICE ?? 'Anna' : process.env.ELEVENLABS_VOICE_ID ?? '', model: process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2' };
}
/** A distinct second voice is optional; otherwise both podcast hosts use the configured voice. */
export function secondSpeechConfig(): SpeechConfig {
  const first = speechConfig();
  return { ...first, voice: first.provider === 'local' ? process.env.VIDEO_LOCAL_SECOND_VOICE ?? 'Markus' : process.env.ELEVENLABS_SECOND_VOICE_ID?.trim() || first.voice };
}

const speechFailures = new Set<string>();
const speechIdentity = (config: SpeechConfig) => hash(JSON.stringify([config, process.env.ELEVENLABS_API_KEY]));
const executable = (path: string) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };

/** A reason for disabling a new audio lesson; existing published media need no speech service. */
export function speechUnavailable(type: LessonType): string | undefined {
  if (type !== 'video' && type !== 'podcast') return;
  let configs: SpeechConfig[];
  try { configs = type === 'podcast' ? [speechConfig(), secondSpeechConfig()] : [speechConfig()]; }
  catch { return 'Spracherzeugung ist nicht eingerichtet.'; }
  if (configs[0].provider === 'local') {
    if (process.env.VIDEO_SPEECH_PROVIDER !== 'local') return 'Spracherzeugung ist nicht eingerichtet.';
    if (process.platform !== 'darwin' || !executable('/usr/bin/say')) return 'Lokale Spracherzeugung ist auf diesem Server nicht verfügbar.';
    const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
    const paths = isAbsolute(ffmpeg) ? [ffmpeg] : (process.env.PATH ?? '').split(delimiter).map(p => join(p, ffmpeg));
    if (!paths.some(executable)) return 'Lokale Spracherzeugung ist auf diesem Server nicht verfügbar.';
  } else {
    if (!process.env.ELEVENLABS_API_KEY?.trim() || configs.some(c => !c.voice.trim())) return type === 'podcast'
      ? 'Podcast ist ohne Spracherzeugung nicht verfügbar.'
      : 'Video ist ohne Spracherzeugung nicht verfügbar.';
    if (configs.some(c => speechFailures.has(speechIdentity(c)))) return 'Der Sprachdienst ist gerade nicht verfügbar. Wähle ein anderes Format.';
  }
}

export function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(AUDIO_RATE, 24); header.writeUInt32LE(AUDIO_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Cache every completed cue immediately, including when a later scene fails. */
export class Speech {
  private pending = new Map<string, Promise<Buffer>>();
  constructor(readonly config: SpeechConfig, private cache: string, private retryFailed = false) {}
  pcm(text: string): Promise<Buffer> {
    const key = hash(JSON.stringify([this.config, AUDIO_RATE, 'de', text]));
    let task = this.pending.get(key);
    if (!task) {
      task = this.load(key, text); this.pending.set(key, task);
      // Disk owns completed cues; keep only concurrent requests in memory.
      void task.then(() => this.pending.delete(key), () => this.pending.delete(key));
    }
    return task;
  }
  private async load(key: string, text: string): Promise<Buffer> {
    await mkdir(this.cache, { recursive: true });
    const file = join(this.cache, key + '.pcm'), attempt = join(this.cache, key + '.attempt');
    try {
      const cached = await readFile(file);
      if (!cached.length || cached.length % 2) throw new Error('Ungültiger Sprachcache.');
      return cached;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (this.config.provider === 'elevenlabs' && (!process.env.ELEVENLABS_API_KEY || !this.config.voice)) throw new Error('ElevenLabs-Schlüssel oder Stimme fehlt.');
    if (this.config.provider === 'local' && process.platform !== 'darwin') throw new Error('Lokale Spracherzeugung benötigt macOS. Bitte ElevenLabs konfigurieren.');
    if (this.retryFailed) await rm(attempt, { force: true });
    try { await writeFile(attempt, new Date().toISOString(), { flag: 'wx' }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Ein früherer Sprachaufruf ist unvollständig. Bitte gezielt mit --retry-failed neu erzeugen.');
      throw e;
    }
    // Keep the marker on failure: an uncertain paid POST must not repeat on refresh/restart.
    const pcm = await this.synthesize(text);
    if (!pcm.length || pcm.length % 2 || pcm.length > AUDIO_RATE * 2 * 600) throw new Error('Der Sprachdienst hat ungültiges Audio geliefert.');
    await writeFile(file + '.pending', pcm);
    await rename(file + '.pending', file);
    await rm(attempt, { force: true });
    return pcm;
  }
  private async synthesize(text: string): Promise<Buffer> {
    if (this.config.provider === 'elevenlabs') {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.config.voice)}?output_format=pcm_24000`, {
        method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: this.config.model, language_code: 'de' }),
      });
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status)) speechFailures.add(speechIdentity(this.config));
        throw new Error(`Spracherzeugung fehlgeschlagen (HTTP ${response.status}).`);
      }
      return Buffer.from(await response.arrayBuffer());
    }
    const scratch = await mkdtemp(join(tmpdir(), 'l45-speech-'));
    try {
      const input = join(scratch, 'text.txt'), aiff = join(scratch, 'speech.aiff'), pcm = join(scratch, 'speech.pcm');
      await writeFile(input, text);
      execFileSync('/usr/bin/say', ['-v', this.config.voice, '-r', '155', '-f', input, '-o', aiff], { timeout: 120000, stdio: 'pipe' });
      execFileSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-y', '-i', aiff, '-f', 's16le', '-ac', '1', '-ar', String(AUDIO_RATE), pcm], { timeout: 120000, stdio: 'pipe' });
      return await readFile(pcm);
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
}
