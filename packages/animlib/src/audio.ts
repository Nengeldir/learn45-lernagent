import type { Asset, CompiledScene } from "./types.js";

/** Host-owned audio only: submitted scene code selects an asset ID, never a URL. */
export class AudioClock {
  private context?: AudioContext;
  private gain?: GainNode;
  private source?: AudioBufferSourceNode;
  private buffers = new Map<string, AudioBuffer>();
  private abort = new AbortController();
  private generation = 0;
  private startedAt = 0;
  private offset = 0;
  private running = false;
  private muted = false;
  private disposed = false;

  constructor(
    private readonly assets: Record<string, Asset> = {},
    private readonly createContext: () => AudioContext = () => new AudioContext(),
  ) {}

  private ensureContext(): AudioContext {
    if (this.disposed) throw new Error("Audio player is disposed");
    if (!this.context) {
      this.context = this.createContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.muted ? 0 : 1;
      this.gain.connect(this.context.destination);
    }
    return this.context;
  }

  register(assets: Record<string, Asset>): void {
    if (this.disposed) throw new Error('Audio player is disposed');
    for (const [id, asset] of Object.entries(assets)) {
      if (Object.hasOwn(this.assets, id) && this.assets[id].url !== asset.url) throw new Error(`Audio asset is immutable: ${id}`);
    }
    for (const [id, asset] of Object.entries(assets)) Object.defineProperty(this.assets, id, { value: { ...asset }, enumerable: true, configurable: true });
  }

  /** Call directly from a user gesture, before queuing async playback work. */
  unlock(): Promise<void> { return this.ensureContext().resume(); }

  async prepare(scenes: CompiledScene[]): Promise<void> {
    for (const scene of scenes) {
      const id = scene.options.audio;
      if (!id) continue;
      const asset = this.assets[id];
      if (!asset || asset.kind !== "audio") throw new Error(`Unknown audio asset: ${id}`);
      let buffer = this.buffers.get(id);
      if (!buffer) {
        const response = await fetch(asset.url, { signal: this.abort.signal });
        if (!response.ok) throw new Error(`Audio asset ${id} failed to load (${response.status})`);
        buffer = await this.ensureContext().decodeAudioData(await response.arrayBuffer());
        if (this.disposed) throw new Error("Audio player is disposed");
        if (!Number.isFinite(buffer.duration) || buffer.duration < 0) throw new Error(`Invalid duration for audio asset: ${id}`);
        this.buffers.set(id, buffer);
      }
      scene.duration = Math.max(scene.duration, buffer.duration);
    }
  }

  get time(): number {
    return this.running && this.context
      ? this.offset + Math.max(0, this.context.currentTime - this.startedAt)
      : this.offset;
  }

  get interrupted(): boolean {
    return Boolean(this.running && this.context && this.context.state !== "running");
  }

  /** False means a concurrent pause/disposal canceled the resume operation. */
  async start(assetId: string, offset: number): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    const buffer = this.buffers.get(assetId);
    if (!buffer) throw new Error(`Audio asset is not prepared: ${assetId}`);
    const context = this.ensureContext();
    if (context.state !== "running") await context.resume();
    if (generation !== this.generation || this.disposed) return false;
    if (context.state !== "running") throw new Error("Audio playback is blocked; press Play to allow browser audio");
    this.offset = offset;
    this.startedAt = context.currentTime;
    this.running = true;
    if (offset < buffer.duration) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain!);
      source.onended = () => {
        source.disconnect();
        if (this.source === source) this.source = undefined;
      };
      this.source = source;
      source.start(0, Math.max(0, offset));
    }
    return true;
  }

  stop(): number {
    this.offset = this.time;
    this.running = false;
    this.generation++;
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = undefined;
    }
    return this.offset;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : 1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.abort.abort();
    this.buffers.clear();
    this.gain?.disconnect();
    void this.context?.close().catch(() => {});
  }
}
