import { ModelStore } from './model-store.js';
import type { AssetGeometryResolver } from './asset-types.js';
import { AudioClock } from "./audio.js";
import { ControlOverlay } from "./controls.js";
import { CanvasRenderer } from "./renderer.js";
import { SceneSequence } from "./sequence.js";
import { paletteResolver } from "./palette.js";
import { evaluateScene } from "./timeline.js";
import { BehaviorRuntime } from "./behaviors.js";
import { CanvasInput } from "./canvas-input.js";
import { cameraRay } from "./spatial.js";
import { project } from "./geometry.js";
import { getLocalBounds, getWorldBounds, getCameraBounds, getScreenBounds } from "./bounds.js";
import type { Asset, Bounds2D, Bounds3D, ColorPalette, CompiledScene, ControlValue, PlayerBoundsOptions, PlayerOptions, PlayerState, Submission, SubmitResult, Vec3 } from "./types.js";

export class Player {
  private readonly models:ModelStore;
  private readonly renderer: CanvasRenderer;
  private readonly audio: AudioClock;
  private readonly sequence: SceneSequence;
  private readonly palette: ColorPalette;
  private displayPalette?: ColorPalette;
  private readonly overlay?: ControlOverlay;
  private readonly behaviors: BehaviorRuntime;
  private readonly input: CanvasInput;
  private presentationAt = 0;
  private refreshGeneration = 0;
  private sampling?: Promise<CompiledScene>;
  private sampled?: { source: CompiledScene; bindings: CompiledScene['reactiveBindings']; time: number; snapshot: CompiledScene };
  private listeners = new Set<(state: PlayerState) => void>();
  private sceneId: string | null = null;
  private sceneBarriers = new Set<string>();
  private time = 0;
  private status: PlayerState["status"] = "empty";
  private error?: string;
  private rendererError?: Error;
  private raf?: number;
  private frameInvalidated = false;
  private startedAt = 0;
  private offset = 0;
  private playbackGeneration = 0;
  private queuedSeeks = 0;
  private playAfterSeek = false;
  private disposed = false;
  private operations: Promise<unknown> = Promise.resolve();
  private pendingControls = new Map<string, { change: { scene: string; id: string; value: ControlValue }; promise: Promise<void> }>();

  constructor(options: PlayerOptions) {
    const palette = paletteResolver(options.palette).palette;
    this.palette = palette;
    this.models = new ModelStore(options.assets);
    const assetGeometry: AssetGeometryResolver = { resolve:ref=>this.sequence.assetGeometry.resolve(ref), resolveImage:ref=>this.sequence.assetGeometry.resolveImage(ref) };
    this.renderer = new CanvasRenderer(options.canvas, palette, assetGeometry, this.models);
    this.behaviors = new BehaviorRuntime(options.behaviors);
    this.input = new CanvasInput(options.canvas, this.behaviors, view => this.renderer.interactionSnapshot(view), () => this.invalidateFrame(), { resolve:ref=>this.sequence.assetGeometry.resolve(ref) });
    this.audio = new AudioClock(Object.fromEntries(Object.entries(options.assets??{}).filter(([,a])=>a.kind==='audio')));
    this.sequence = new SceneSequence({
      modelAssets: options.modelAssets,
      models: this.models.metadata,
      palette,
      seed: options.seed,
      executionLimitMs: options.executionLimitMs,
      prepare: async scenes => {
        this.behaviors.validate(scenes);
        await this.models.prepare(scenes);
        await this.audio.prepare(scenes);
        await this.renderer.prepare(scenes);
      },
    });
    this.renderer.onCanvasChange = canvas => { this.input.setCanvas(canvas); this.overlay?.setCanvas(canvas); options.onCanvasChange?.(canvas); };
    this.renderer.onInvalidate = () => this.invalidateFrame();
    this.renderer.onRecovered = () => {
      if (this.disposed) return;
      if (this.rendererError) {
        this.rendererError = undefined;
        this.error = undefined;
        this.status = this.sceneId ? "paused" : "empty";
      }
      this.refresh();
    };
    this.renderer.onOrbitChange = () => this.invalidateFrame();
    this.renderer.onError = error => {
      if (this.disposed) return;
      this.input.cancel();
      this.stopClock();
      this.status = "blocked";
      this.rendererError = error;
      this.error = error.message;
      // A failed GPU must not be asked to render again while reporting its error.
      this.notify();
    };
    const controlsRoot = options.controlsRoot || undefined;
    if (controlsRoot) {
      this.overlay = new ControlOverlay(controlsRoot, (id, value) => {
        if (this.sceneId) return this.setControl({ scene: this.sceneId, id, value }).catch(error => this.report(error));
      }, options.canvas.ownerDocument ? options.canvas : undefined);
    }
  }

  /** The active drawing surface can change when a failed WebGPU context is replaced. */
  get canvas(): HTMLCanvasElement { return this.renderer.canvasElement; }
  get backend(): "webgpu" | "webgl2" | undefined { return this.renderer.backend; }

  /** Recolor the current frame and background without recompiling scenes or restarting playback. */
  setDisplayPalette(palette: ColorPalette): void {
    this.assertAlive();
    const resolved = paletteResolver(palette).palette;
    for (const name of Object.keys(this.palette.colors)) {
      if (!Object.hasOwn(resolved.colors, name)) throw new Error(`Display palette is missing Color.${name}`);
    }
    this.renderer.setPalette(resolved);
    this.displayPalette = resolved;
    this.invalidateFrame();
  }

  getInteractionSnapshot(view = '') { this.assertAlive(); return this.renderer.interactionSnapshot(view); }
  /** Bounds of the displayed object, using its view's effective camera and CSS dimensions. */
  getBounds(id: string, options: PlayerBoundsOptions & { space: 'local' | 'world' | 'camera' }): Bounds3D | undefined;
  getBounds(id: string, options?: PlayerBoundsOptions & { space?: 'screen' }): Bounds2D | undefined;
  getBounds(id: string, options: PlayerBoundsOptions): Bounds2D | Bounds3D | undefined;
  getBounds(id: string, options: PlayerBoundsOptions = {}): Bounds2D | Bounds3D | undefined {
    const main = this.getInteractionSnapshot();
    const element = main?.frame.elements.find(e => e.id === id);
    if (!main || !element) return;
    const snapshot = element.view === undefined ? main : this.getInteractionSnapshot(element.view);
    if (!snapshot) return;
    const settings = { ...options, assetGeometry:this.sequence.assetGeometry, width: snapshot.width, height: snapshot.height, camera: snapshot.camera, palette: this.displayPalette ?? this.palette };
    switch (options.space ?? 'screen') {
      case 'local': return getLocalBounds(snapshot.frame, id, settings);
      case 'world': return getWorldBounds(snapshot.frame, id, settings);
      case 'camera': return getCameraBounds(snapshot.frame, id, settings);
      case 'screen': {
        // The core API uses canvas coordinates; player queries use the same
        // view-local pixels as project() and ray(), including rounded viewport sizes.
        const frame = { ...snapshot.frame, views: snapshot.frame.views?.map(v => v.id === element.view ? { ...v, rect: [0, 0, 1, 1] as [number, number, number, number] } : v) };
        return getScreenBounds(frame, id, settings);
      }
      default: throw new Error(`Unknown bounds space: ${options.space}`);
    }
  }
  getPan(view = ''): Vec3 { this.assertAlive(); return this.renderer.getPan(view); }
  setPan(value: Vec3, view = ''): void { this.assertAlive(); this.renderer.setPan(value, view); this.invalidateFrame(); }
  setNavigationMode(mode: 'orbit' | 'pan'): void { this.assertAlive(); this.renderer.setNavigationMode(mode); }
  resetView(): void { this.assertAlive(); this.input.cancel(); this.behaviors.reset(); this.renderer.resetInteraction(); this.invalidateFrame(); }
  /** Schedule presentation of the latest input state; repeated calls share one animation frame. */
  invalidateFrame(): void { this.assertAlive(); this.frameInvalidated = true; this.scheduleFrame(); }
  project(point: Vec3, view = '') {
    const snapshot = this.getInteractionSnapshot(view); if (!snapshot) return;
    return project(point, snapshot.camera, snapshot.width, snapshot.height);
  }
  ray(x: number, y: number, view = '') {
    const snapshot = this.getInteractionSnapshot(view); if (!snapshot) return;
    return cameraRay(x, y, snapshot.camera, snapshot.width, snapshot.height);
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error("Player is disposed");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(() => { this.assertAlive(); return operation(); });
    this.operations = result.catch(() => {});
    return result;
  }

  private currentIndex(): number { return this.sceneId === null ? -1 : this.sequence.index(this.sceneId); }
  private currentScene() { const index = this.currentIndex(); return index < 0 ? undefined : this.sequence.compiled[index]; }
  private clockTime(scene = this.currentScene()): number {
    if (this.status !== "playing") return this.time;
    const elapsed = scene?.options.audio
      ? this.audio.time : this.offset + (performance.now() - this.startedAt) / 1000;
    return Math.min(scene?.duration ?? 0, Math.max(0, elapsed));
  }

  private stopClock(time = this.clockTime()): void {
    this.time = time;
    this.playbackGeneration++;
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.raf = undefined;
    this.audio.stop();
  }

  private report(error: unknown): void {
    if (this.disposed) return;
    this.error = error instanceof Error ? error.message : String(error);
    this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.refreshGeneration, time = this.time;
    this.frameInvalidated = false;
    // An explicit seek/control/pause refresh consumes a queued input refresh.
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    this.raf = undefined;
    const index = this.currentIndex();
    const scene = index < 0 ? undefined : this.sequence.compiled[index];
    if (scene) {
      let snapshot = scene;
      if (scene.reactiveBindings?.some(binding => binding.time)) {
        try {
          // Keep at most one worker sample in flight; passive invalidations coalesce.
          if (this.sampling) await this.sampling.catch(() => undefined);
          if (this.disposed || generation !== this.refreshGeneration) return;
          const cached = this.sampled;
          if (cached?.source === scene && cached.bindings === scene.reactiveBindings && cached.time === time) snapshot = cached.snapshot;
          else {
            const bindings = scene.reactiveBindings;
            const pending = this.sequence.sample(index, time);
            this.sampling = pending;
            try { snapshot = await pending; }
            finally { if (this.sampling === pending) this.sampling = undefined; }
            this.sampled = { source: scene, bindings, time, snapshot };
          }
        }
        catch (error) {
          if (this.disposed || generation !== this.refreshGeneration) return;
          this.stopClock(); this.status = 'blocked';
          this.error = error instanceof Error ? error.message : String(error);
          this.notify(); return;
        }
        // A newer seek, input refresh, source replacement, or disposal wins.
        if (this.disposed || generation !== this.refreshGeneration) return;
        if (scene !== this.currentScene()) return this.refresh();
      }
      const now = performance.now(), dt = this.presentationAt ? Math.max(0, (now-this.presentationAt)/1000) : 0;
      this.presentationAt = now;
      const frame = this.behaviors.evaluate(scene, evaluateScene(snapshot, time, { bindings: false }), this.time, dt);
      this.input.sync();
      this.renderer.syncInteraction(this.sceneId!, this.time, scene, frame);
      this.renderer.setOrbitEnabled(scene.options.orbit && frame.camera.perspective > 0 && !frame.cameraAnimated);
      this.renderer.render(frame, this.displayPalette ? { ...scene.options, background: this.displayPalette.background } : scene.options);
    } else {
      this.renderer.setOrbitEnabled(false);
      this.renderer.render({
        elements: [], cameraAnimated: false,
        camera: { yaw: 0, pitch: 0, target: [0, 0, 0], height: 8, distance: 10, perspective: 0 },
      }, { mode: "2d", end: "hold", orbit: false, background: (this.displayPalette ?? this.palette).background, palette: this.palette });
    }
    this.overlay?.update(this.sceneId ?? "", scene?.controls ?? [], this.displayPalette
      ? paletteResolver(this.displayPalette).resolve(this.displayPalette.background)
      : scene ? paletteResolver(this.palette).resolve(scene.options.background) : undefined);
    this.notify();
    this.scheduleFrame();
  }

  private notify(): void {
    if (this.rendererError) { this.status = "blocked"; this.error = this.rendererError.message; }
    const state = this.getState();
    for (const listener of this.listeners) {
      try { listener(state); } catch (error) { console.error("animlib subscriber failed", error); }
    }
  }

  submit(change: Submission): Promise<SubmitResult> {
    this.pendingControls.clear(); // Source edits are ordering barriers for input coalescing.
    return this.enqueue(async () => {
      const oldSources = this.sequence.sources.slice();
      const oldCompiled = this.sequence.compiled.slice();
      const result = await this.sequence.submit(change);
      if (!result.ok || this.disposed) return result;
      // Appending preloaded scenes must not interrupt the active audio clock.
      if (change.type === 'insert' && oldSources.length > 0 && change.after === oldSources.at(-1)?.id) {
        this.notify();
        return result;
      }
      const activeId = this.sceneId;
      const oldIndex = oldSources.findIndex(scene => scene.id === activeId);
      const affected = change.type === "load"
        || change.type === "replace" && oldSources.findIndex(scene => scene.id === change.scene) <= oldIndex
        || change.type === "insert" && (change.after === null || oldSources.findIndex(scene => scene.id === change.after) < oldIndex);
      const wasPlaying = this.status === "playing";
      // Read the old clock before changing active ID, even if the active scene moved.
      this.stopClock(this.clockTime(oldCompiled[oldIndex]));
      const resumeGeneration = this.playbackGeneration;
      // Reconstruction can replace the active instance even when only a later source changed.
      if (affected || oldCompiled[oldIndex] !== this.currentScene()) { this.input.cancel(); this.behaviors.reset(); }
      this.error = undefined;
      if (change.type === "load") this.renderer.resetInteraction();
      if (change.type === "load" || !activeId) {
        this.sceneId = this.sequence.sources[0]?.id ?? null;
        this.time = 0;
      } else {
        this.sceneId = activeId;
        this.time = affected ? 0 : Math.min(this.time, this.currentScene()?.duration ?? 0);
      }
      this.status = this.sceneId ? "paused" : "empty";
      await this.refresh();
      // Sampling can await a worker. A newer Play/Pause or queued seek owns
      // transport now; only resume the playback this operation interrupted.
      // Compilation success is separate from browser playback permission.
      if (wasPlaying && resumeGeneration === this.playbackGeneration && !this.queuedSeeks && !this.disposed
        && change.type !== "load" && this.sceneId) await this.startPlayback().catch(() => {});
      return result;
    });
  }

  async play(): Promise<void> {
    this.assertAlive();
    if (this.rendererError) throw this.rendererError;
    // Accept the later intent without waiting on a control/seek barrier. The
    // final queued seek starts playback at its resolved destination.
    if (this.queuedSeeks) { this.playAfterSeek = true; return; }
    await this.startPlayback();
  }

  private async startPlayback(): Promise<void> {
    this.assertAlive();
    if (this.rendererError) throw this.rendererError;
    if (!this.sceneId || this.status === "playing") return;
    const scene = this.currentScene()!;
    if (this.time >= scene.duration && this.sceneBarriers.has(this.sceneId)) return;
    if (this.time >= scene.duration && scene.duration > 0) this.time = 0;
    const generation = ++this.playbackGeneration;
    this.error = undefined;
    try {
      if (scene.options.audio && !await this.audio.start(scene.options.audio, this.time)) return;
      if (generation !== this.playbackGeneration || this.disposed) return;
      this.offset = this.time;
      this.startedAt = performance.now();
      this.status = "playing";
      await this.refresh();
    } catch (error) {
      if (generation !== this.playbackGeneration || this.disposed) return;
      this.audio.stop();
      this.status = "blocked";
      this.report(error);
      throw error;
    }
  }

  private scheduleFrame(): void {
    if (this.disposed || this.rendererError || this.status !== "playing" && !this.behaviors.active && !this.frameInvalidated || this.raf !== undefined) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = undefined;
      if (this.disposed || this.rendererError) return;
      if (this.status !== "playing") { this.refresh(); return; }
      this.time = this.clockTime();
      const scene = this.currentScene()!;
      if (scene.options.audio && this.audio.interrupted) {
        this.stopClock();
        this.status = "blocked";
        this.error = "Browser interrupted audio playback; press Play to resume";
        this.refresh();
        return;
      }
      if (this.time >= scene.duration) {
        this.stopClock();
        const next = this.currentIndex() + 1;
        if (scene.options.end === "advance" && !this.sceneBarriers.has(this.sceneId!) && next < this.sequence.sources.length) {
          this.input.cancel();
          this.sceneId = this.sequence.sources[next].id;
          this.time = 0;
          this.status = "paused";
          this.refresh();
          void this.startPlayback().catch(() => {});
        } else {
          this.time = scene.duration;
          this.status = "ended";
          this.refresh();
        }
        return;
      }
      void this.refresh();
    });
  }

  /** Hold these scene ends before advancing or starting the next audio asset. */
  setSceneBarriers(ids: string[]): void {
    this.assertAlive();
    this.sceneBarriers = new Set(ids);
  }

  pause(): void {
    this.assertAlive();
    this.playAfterSeek = false;
    this.stopClock();
    this.status = this.sceneId ? "paused" : "empty";
    this.refresh();
  }

  async seek(position: { scene: string; time: number }): Promise<void> {
    this.assertAlive();
    this.pendingControls.clear();
    if (!Number.isFinite(position.time)) throw new Error("Seek time must be finite");
    // Validate before touching the running clock, and recheck at the queue
    // boundary because a preceding source submission may remove the target.
    this.sequence.index(position.scene);
    this.queuedSeeks++;
    this.playAfterSeek = false;
    try {
      await this.enqueue(async () => {
        const index = this.sequence.index(position.scene);
        this.stopClock();
        this.input.cancel(); this.behaviors.reset();
        this.sceneId = position.scene;
        this.time = Math.max(0, Math.min(position.time, this.sequence.compiled[index].duration));
        this.status = "paused";
        this.error = undefined;
        await this.refresh();
      });
    } finally {
      this.queuedSeeks--;
      if (!this.queuedSeeks && this.playAfterSeek && !this.disposed) {
        this.playAfterSeek = false;
        await this.startPlayback();
      }
    }
  }

  async next(): Promise<void> {
    this.assertAlive();
    const next = this.sequence.sources[this.currentIndex() + 1];
    if (next) await this.seek({ scene: next.id, time: 0 });
  }

  async previous(): Promise<void> {
    this.assertAlive();
    const previous = this.sequence.sources[this.currentIndex() - 1];
    if (previous) await this.seek({ scene: previous.id, time: 0 });
  }

  setControl(change: { scene: string; id: string; value: ControlValue }): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Player is disposed'));
    const index = this.sequence.sources.findIndex(s => s.id === change.scene);
    const reactive = this.sequence.compiled[index]?.controls.some(c => c.id === change.id && c.reactive);
    // A builder input can change control bounds, dependencies, or even which
    // controls exist. Never coalesce a later value across that reconstruction.
    if (!reactive) this.pendingControls.clear();
    const key = JSON.stringify([change.scene, change.id]);
    const pending = this.pendingControls.get(key);
    if (pending) { pending.change = { ...change }; return pending.promise; }
    const batch = { change: { ...change }, promise: undefined as unknown as Promise<void> };
    batch.promise = this.enqueue(async () => {
      if (this.pendingControls.get(key) === batch) this.pendingControls.delete(key);
      const change = batch.change;
      const oldScenes = new Map<string, CompiledScene>(this.sequence.sources.map((scene, index) => [scene.id, this.sequence.compiled[index]]));
      await this.sequence.setControl(change.scene, change.id, change.value);
      if (this.disposed) return;
      if (this.currentScene() === oldScenes.get(this.sceneId ?? '')) {
        // Reactive patches retain timeline and live behavior state; audio keeps running.
        this.time = this.clockTime(); this.error = undefined; await this.refresh();
        return;
      }
      const wasPlaying = this.status === "playing";
      this.stopClock(this.clockTime(oldScenes.get(this.sceneId ?? "")));
      const resumeGeneration = this.playbackGeneration;
      this.input.cancel(); this.behaviors.reset();
      this.time = Math.min(this.time, this.currentScene()?.duration ?? 0);
      this.status = this.sceneId ? "paused" : "empty";
      this.error = undefined;
      await this.refresh();
      // Do not resume or mark ended over a newer transport request made while
      // the reconstructed scene's worker sample was in flight.
      if (resumeGeneration !== this.playbackGeneration || this.queuedSeeks || this.disposed) return;
      if (wasPlaying && this.time < (this.currentScene()?.duration ?? 0)) await this.startPlayback().catch(() => {});
      else if (wasPlaying) { this.status = "ended"; this.refresh(); }
    });
    if (reactive) this.pendingControls.set(key, batch);
    return batch.promise;
  }

  setMuted(muted: boolean): void { this.assertAlive(); this.audio.setMuted(muted); }

  registerAssets(assets: Record<string, Asset>): void { this.assertAlive(); this.models.register(assets); this.audio.register(Object.fromEntries(Object.entries(assets).filter(([,a])=>a.kind==='audio'))); }
  unlockAudio(): Promise<void> { this.assertAlive(); return this.audio.unlock(); }

  getState(): PlayerState {
    const scene = this.currentScene();
    const time = this.clockTime();
    const index = this.currentIndex();
    const frame = index >= 0 ? this.sequence.frame(index, time) : undefined;
    return {
      revision: this.sequence.revision,
      scene: this.sceneId,
      time,
      duration: scene?.duration ?? 0,
      status: this.status,
      scenes: this.sequence.sources.map((source, index) => ({ id: source.id, duration: this.sequence.compiled[index].duration })),
      controls: scene?.controls.map(control => ({ ...control, ...(control.position ? { position: [...control.position] as [number,number] } : {}), options: control.options?.slice() })) ?? [],
      orbitEnabled: Boolean(scene?.options.orbit && frame && frame.camera.perspective > 0 && !frame.cameraAnimated),
      views: (frame?.views ?? []).map(view => ({ id: view.id, rect: [...view.rect] as typeof view.rect, orbitEnabled: view.orbit && view.camera.perspective > 0 && !view.cameraAnimated })),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  subscribe(listener: (state: PlayerState) => void): () => void {
    this.assertAlive();
    this.listeners.add(listener);
    try { listener(this.getState()); } catch (error) { console.error("animlib subscriber failed", error); }
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopClock();
    this.disposed = true;
    this.pendingControls.clear();
    this.listeners.clear();
    this.input.dispose(); this.behaviors.reset();
    this.overlay?.dispose();
    this.renderer.dispose();
    this.models.dispose();
    this.audio.dispose();
    this.sequence.dispose();
  }
}

export function createPlayer(options: PlayerOptions): Player { return new Player(options); }
