import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelCall, PodcastManifest, PodcastSpeaker, PodcastStatus } from '@l45/shared';
import type { Speaker } from '../video/build.ts';
import { AUDIO_RATE, Speech, hash, secondSpeechConfig, speechConfig, wav } from '../video/speech.ts';
import { HOSTS, material, modelScript, ruleScript, type PodcastInput, type PodcastScript } from './script.ts';

const VERSION = 1;
/** Silence between two contributions, in seconds */
const PAUSE = 0.4;
export interface PodcastServiceOptions { output: string; speechCache: string; speakers?: Record<PodcastSpeaker, Speaker> }
export interface PodcastRequest { input: PodcastInput; useModel: boolean; onCall: (c: ModelCall) => void }

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
async function writeAtomic(path: string, data: string | Buffer) {
  await writeFile(path + '.pending', data);
  await rename(path + '.pending', path);
}

/** One podcast per track material and voices. Scripts are kept apart, so new voices do not pay for a new script. */
export class PodcastService {
  private jobs = new Map<string, PodcastStatus>();
  private queue = Promise.resolve();
  private speakers: Record<PodcastSpeaker, Speaker>;
  constructor(readonly options: PodcastServiceOptions) {
    this.speakers = options.speakers ?? { a: new Speech(speechConfig(), options.speechCache), b: new Speech(secondSpeechConfig(), options.speechCache) };
  }
  private keys(input: PodcastInput, by: PodcastScript['by']) {
    const script = hash(JSON.stringify([VERSION, by, HOSTS, material(input)]));
    return { script, audio: hash(JSON.stringify([script, this.speakers.a.config, this.speakers.b.config])) };
  }
  private ready = (key: string): PodcastStatus => ({ state: 'ready', manifestUrl: `/podcasts/${key}/manifest.json` });
  async status(req: PodcastRequest): Promise<PodcastStatus> {
    const { audio } = this.keys(req.input, req.useModel ? 'model' : 'rule');
    const m = await readJson<PodcastManifest>(join(this.options.output, audio, 'manifest.json'));
    if (m?.trackId === req.input.track.id) return this.ready(audio);
    return this.jobs.get(audio) ?? { state: 'idle' };
  }
  async prepare(req: PodcastRequest): Promise<PodcastStatus> {
    const existing = await this.status(req);
    if (existing.state !== 'idle') return existing;
    const by = req.useModel ? 'model' : 'rule';
    const { audio } = this.keys(req.input, by);
    // Another concurrent request can have scheduled this build while status read the disk.
    if (this.jobs.has(audio)) return this.jobs.get(audio)!;
    const initial: PodcastStatus = { state: 'building', step: 'script', completed: 0, total: 0 };
    this.jobs.set(audio, initial);
    this.queue = this.queue.then(async () => {
      let script: PodcastScript | undefined;
      try {
        script = await this.script(req, by);
        // After a failed model call the rule script is stored under its own key, so a restart asks the model again.
        const target = script.by === by ? audio : this.keys(req.input, script.by).audio;
        if (!await readJson(join(this.options.output, target, 'manifest.json'))) {
          await this.build(req.input, script, target, (completed, total) => this.jobs.set(audio, { state: 'building', step: 'speech', completed, total }));
        }
        this.jobs.set(audio, this.ready(target));
      } catch (error) {
        console.warn('Podcast konnte nicht erzeugt werden:', error instanceof Error ? error.message : 'unbekannter Fehler');
        this.jobs.set(audio, {
          state: 'error', message: 'Die Vertonung ist gerade nicht möglich. Du kannst das Gespräch hier lesen.',
          ...(script ? { script: { hosts: HOSTS, lines: script.lines } } : {}),
        });
      }
    });
    return initial;
  }
  private async script(req: PodcastRequest, by: PodcastScript['by']): Promise<PodcastScript> {
    const folder = join(this.options.output, 'scripts');
    const file = join(folder, this.keys(req.input, by).script + '.json');
    const cached = await readJson<PodcastScript>(file);
    if (cached) return cached;
    const fresh = (by === 'model' && await modelScript(req.input, req.onCall)) || ruleScript(req.input);
    if (fresh.by === by) {
      await mkdir(folder, { recursive: true });
      await writeAtomic(file, JSON.stringify(fresh, null, 2) + '\n');
    }
    return fresh;
  }
  private async build(input: PodcastInput, script: PodcastScript, key: string, progress: (completed: number, total: number) => void) {
    const chunks: Buffer[] = [], lines: PodcastManifest['lines'] = [];
    let samples = 0;
    for (const [i, line] of script.lines.entries()) {
      const pcm = await this.speakers[line.speaker].pcm(line.text);
      if (!pcm.length || pcm.length % 2) throw new Error('Ungültiges Sprachaudio.');
      const start = samples / AUDIO_RATE;
      chunks.push(pcm); samples += pcm.length / 2;
      lines.push({ ...line, start, end: samples / AUDIO_RATE });
      if (i < script.lines.length - 1) {
        const pause = Buffer.alloc(Math.round(AUDIO_RATE * PAUSE) * 2);
        chunks.push(pause); samples += pause.length / 2;
      }
      progress(i + 1, script.lines.length);
    }
    const audio = wav(Buffer.concat(chunks));
    const name = `podcast-${hash(audio).slice(0, 12)}.wav`;
    const { a, b } = this.speakers;
    const manifest: PodcastManifest = {
      schemaVersion: 1, trackId: input.track.id, title: `Podcast: ${input.track.name}`, locale: 'de-CH', scriptBy: script.by, hosts: HOSTS,
      narration: { provider: a.config.provider, voices: { a: a.config.voice, b: b.config.voice }, model: a.config.model },
      duration: samples / AUDIO_RATE, audioUrl: `/podcasts/${key}/${name}`, lines,
    };
    const folder = join(this.options.output, key);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, name), audio);
    await writeAtomic(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
}
