import { SceneCompileError } from "./compiler.js";
import { SourceCompiler } from "./compiler-client.js";
import { evaluateScene } from "./timeline.js";
import { paletteResolver } from "./palette.js";
import { mergeReactiveUpdates } from './reactive.js';
import { SceneAssets } from './scene-assets.js';
import type { AssetRegistry } from './asset-types.js';
import type { ColorPalette, CompiledScene, ControlValue, Frame, SceneSource, Submission, SubmitResult } from "./types.js";

export interface SequenceOptions {
  modelAssets?: AssetRegistry;
  models?: import("./types.js").CompileInput["models"];
  palette?: ColorPalette;
  seed?: number;
  executionLimitMs?: number;
  /** Called once per newly compiled scene, before sampling its outgoing frame.
   * Resolve host-owned duration (for example decoded audio) here. Reused prefix
   * scenes are already prepared and are not passed again.
   */
  prepare?: (scenes: CompiledScene[]) => Promise<void>;
}

/** Headless source/state coordinator. All candidate scenes are validated before commit. */
export class SceneSequence {
  sources: SceneSource[] = [];
  compiled: CompiledScene[] = [];
  revision = 0;
  private values = new Map<string, Record<string, ControlValue>>();
  private queue: Promise<unknown> = Promise.resolve();
  private compiler = new SourceCompiler();
  private disposed = false;
  readonly assetGeometry: SceneAssets;
  constructor(private options: SequenceOptions = {}) {
    this.options = { ...options, palette: paletteResolver(options.palette).palette };
    this.assetGeometry = new SceneAssets(options.modelAssets);
  }

  index(id: string): number {
    const index = this.sources.findIndex(s => s.id === id);
    if (index < 0) throw new Error(`Unknown scene: ${id}`);
    return index;
  }
  frame(index: number, time: number): Frame {
    if (!this.compiled[index]) throw new Error(`Unknown scene index: ${index}`);
    return evaluateScene(this.compiled[index], time);
  }
  /** Evaluate retained time callbacks in the sandbox, returning a serializable snapshot.
   * Canonical compiled scenes keep their time-zero outputs; sampling never mutates them.
   */
  sample(index: number, time: number): Promise<CompiledScene> {
    return this.enqueue(async () => {
      if (this.disposed) throw new Error('Scene sequence is disposed');
      let scene = this.compiled[index];
      if (!scene) throw new Error(`Unknown scene index: ${index}`);
      if (scene.reactiveBindings?.some(b => b.time) && !this.compiler.canUpdate(scene)) {
        // Recover a lost worker even for time-only scenes with no input controls.
        try {
          const candidate = await this.reconstruct(this.sources, this.values);
          this.compiled = candidate.compiled; this.values = candidate.values;
          scene = this.compiled[index];
        } finally { this.compiler.retain(this.compiled); this.assetGeometry.retain(this.compiled); }
      }
      return this.sampleScene(scene, time);
    });
  }
  async evaluate(index: number, time: number): Promise<Frame> {
    const snapshot = await this.sample(index, time);
    return evaluateScene(snapshot, time);
  }
  private async sampleScene(scene: CompiledScene, time: number, values = Object.fromEntries(scene.controls.map(c => [c.id, c.value])), base = scene): Promise<CompiledScene> {
    if (!Number.isFinite(time)) throw new Error('Sample time must be finite');
    time = Math.max(0, Math.min(base.duration, time));
    if (!base.reactiveBindings?.some(b => b.time) || time === base.reactiveTime) return base;
    const updates = await this.compiler.update(scene, values, [], this.options, time);
    return { ...base, reactiveBindings: mergeReactiveUpdates(base, updates, [], time), reactiveTime: time };
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => undefined); return result;
  }
  private async reconstruct(sources: SceneSource[], values: Map<string, Record<string, ControlValue>>, prefix: CompiledScene[] = [], outgoing?: Frame) {
    const compiled: CompiledScene[] = prefix.slice();
    for (const scene of compiled) this.assetGeometry.prepare(scene);
    let previous: Frame | undefined = sources.length > prefix.length ? outgoing ?? (compiled.length ? evaluateScene(await this.sampleScene(compiled.at(-1)!, compiled.at(-1)!.duration), compiled.at(-1)!.duration) : undefined) : undefined;
    for (const source of sources.slice(prefix.length)) {
      try {
        if (source.handoffFrom !== undefined) {
          const index = source.handoffFrom === null ? -1 : sources.findIndex(s => s.id === source.handoffFrom);
          if (source.handoffFrom !== null && (index < 0 || index >= compiled.length)) throw new Error(`Invalid handoff scene: ${source.handoffFrom}`);
          // Reactive control updates supply the changed prefix's sampled frame;
          // its temporary compiled copy does not own a callback runtime.
          previous = index < 0 ? undefined : outgoing && index === prefix.length - 1 ? outgoing
            : evaluateScene(await this.sampleScene(compiled[index], compiled[index].duration), compiled[index].duration);
        }
        const scene = await this.compiler.compile(source.source, { models: this.options.models, assetCatalog: this.options.modelAssets?.catalog, previous, controls: values.get(source.id), seed: this.options.seed ?? 1, palette: this.options.palette }, this.options);
        if (source.audioId !== undefined) scene.options.audio = source.audioId;
        this.assetGeometry.prepare(scene);
        await this.options.prepare?.([scene]);
        if (this.disposed) throw new Error("Scene sequence is disposed");
        compiled.push(scene); previous = evaluateScene(await this.sampleScene(scene, scene.duration), scene.duration);
      } catch (error) {
        if (error instanceof SceneCompileError) error.diagnostic.scene = source.id;
        throw error;
      }
    }
    if (this.disposed) throw new Error("Scene sequence is disposed");
    const normalized = new Map<string, Record<string, ControlValue>>();
    sources.forEach((s, i) => normalized.set(s.id, Object.fromEntries(compiled[i].controls.map(c => [c.id, c.value]))));
    return { compiled, values: normalized };
  }
  submit(change: Submission): Promise<SubmitResult> {
    return this.enqueue(async () => {
      try {
        if (this.disposed) throw new Error("Scene sequence is disposed");
        let sources: SceneSource[];
        if (change.type === "load") sources = structuredClone(change.scenes);
        else if (change.type === "replace") {
          const index = this.index(change.scene);
          sources = this.sources.map((s, i) => i === index ? { ...s, source: change.source } : { ...s });
        } else if (change.type === "insert") {
          sources = this.sources.map(s => ({ ...s }));
          const index = change.after === null ? -1 : this.index(change.after);
          sources.splice(index + 1, 0, ...structuredClone(change.scenes));
        } else throw new Error("Unknown submission type");
        if (!Array.isArray(sources) || sources.length > 100) throw new Error("Scene count limit exceeded (100)");
        const ids = new Set<string>();
        for (const s of sources) {
          if (!s || typeof s.id !== "string" || !s.id || s.id.length > 256 || ids.has(s.id)) throw new Error(`Invalid or duplicate scene ID: ${s?.id}`);
          ids.add(s.id);
        }
        const append = change.type === 'insert' && change.after === (this.sources.at(-1)?.id ?? null);
        const candidate = await this.reconstruct(sources, change.type === "load" ? new Map() : this.values, append ? this.compiled : []);
        this.sources = sources; this.compiled = candidate.compiled; this.values = candidate.values; this.revision++;
        return { ok: true, revision: this.revision, diagnostics: [] };
      } catch (error) {
        return { ok: false, revision: this.revision, diagnostics: [error instanceof SceneCompileError ? error.diagnostic : { severity: "error", code: "SUBMISSION", message: error instanceof Error ? error.message : String(error) }] };
      } finally { this.compiler.retain(this.compiled); this.assetGeometry.retain(this.compiled); }
    });
  }
  setControl(sceneId: string, id: string, value: ControlValue): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed) throw new Error("Scene sequence is disposed");
      const index = this.index(sceneId), scene = this.compiled[index];
      const control = scene.controls.find(c => c.id === id);
      if (!control) throw new Error(`Unknown control: ${sceneId}/${id}`);
      if (control.reactive) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Slider ${id} requires a finite number`);
        value = Math.max(control.min!, Math.min(control.max!, value));
        if (value === control.value) return;
      }
      const values = new Map(this.values);
      values.set(sceneId, { ...values.get(sceneId), [id]: value });
      try {
        if (control.reactive && this.compiler.canUpdate(scene)) {
          const updates = await this.compiler.update(scene, values.get(sceneId)!, [id], this.options);
          const updated = { ...scene, controls: scene.controls.map(c => c.id === id ? { ...c, value } : c), reactiveBindings: mergeReactiveUpdates(scene, updates, [id]) };
          // Preserve transactional handoffs. Earlier scenes and the changed builder
          // are reused; downstream sources still receive a freshly evaluated end frame.
          const end = index < this.sources.length - 1 ? await this.sampleScene(scene, scene.duration, values.get(sceneId)!, updated) : undefined;
          const candidate = await this.reconstruct(this.sources, values, [...this.compiled.slice(0, index), updated], end ? evaluateScene(end, scene.duration) : undefined);
          scene.controls = updated.controls; scene.reactiveBindings = updated.reactiveBindings;
          candidate.compiled[index] = scene; // Retain its callback program and live behavior identity.
          this.compiled = candidate.compiled; this.values = candidate.values;
        } else {
          // A lost worker can recover from the last committed values on the next update.
          const candidate = await this.reconstruct(this.sources, values, control.reactive ? this.compiled.slice(0, index) : []);
          this.compiled = candidate.compiled; this.values = candidate.values;
        }
      } finally { this.compiler.retain(this.compiled); this.assetGeometry.retain(this.compiled); }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.compiler.dispose();
    this.assetGeometry.dispose();
  }
}
