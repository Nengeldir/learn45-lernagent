import { createSceneProgram, SceneCompileError } from "./compiler.js";
import type { SceneProgram } from "./compiler.js";
import type { CompileInput, CompiledScene, ControlValue, Diagnostic, ReactiveUpdate } from "./types.js";

export interface CompileLimits { executionLimitMs?: number }
export type CompilerRequest =
  | { id: number; type?: 'compile'; source: string; input: CompileInput; limits: CompileLimits }
  | { id: number; type: 'update'; session: number; values: Record<string, ControlValue>; changed: string[]; time?: number; duration: number; limits: CompileLimits }
  | { id: number; type: 'release'; sessions: number[] };
export type CompilerResponse =
  | { id: number; ok: true; scene: CompiledScene }
  | { id: number; ok: true; updates: ReactiveUpdate[] }
  | { id: number; ok: false; diagnostic: Diagnostic };
type Result = CompiledScene | ReactiveUpdate[];
interface Pending {
  kind: 'scene' | 'updates';
  resolve: (value: Result) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** The browser worker owns bounded QuickJS programs, including retained callbacks. */
export class SourceCompiler {
  private worker?: Worker;
  private pending = new Map<number, Pending>();
  private sessions = new Map<CompiledScene, number>();
  private programs = new Map<number, SceneProgram>();
  private nextId = 0;
  private disposed = false;

  private failWorker(error: Error): void {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
    }
    for (const program of this.programs.values()) program.dispose();
    this.programs.clear(); this.sessions.clear();
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout); request.reject(error);
    }
    this.pending.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./compiler-worker.js", import.meta.url), { type: "module", name: "animlib-source" });
    worker.onmessage = (event: MessageEvent<CompilerResponse>) => {
      const response = event.data;
      const request = response && this.pending.get(response.id);
      if (!response || typeof response.id !== 'number' || typeof response.ok !== 'boolean'
        || (response.ok ? !('scene' in response && response.scene && typeof response.scene === 'object') && !('updates' in response && Array.isArray(response.updates))
          : !response.diagnostic || typeof response.diagnostic.message !== 'string' || typeof response.diagnostic.code !== 'string')
        || response.ok && request && (request.kind === 'scene' ? !('scene' in response) : !('updates' in response))) {
        this.failWorker(new SceneCompileError({ severity: 'error', code: 'COMPILER_WORKER', message: 'The scene compiler returned an invalid response.' }));
        return;
      }
      if (!request) return;
      this.pending.delete(response.id); clearTimeout(request.timeout);
      if (response.ok) request.resolve('scene' in response ? response.scene : response.updates);
      else request.reject(new SceneCompileError(response.diagnostic));
    };
    worker.onerror = event => {
      event.preventDefault();
      this.failWorker(new SceneCompileError({ severity: 'error', code: 'COMPILER_WORKER', message: event.message || 'The scene compiler worker could not start.', hint: 'Check worker and WebAssembly asset loading.' }));
    };
    worker.onmessageerror = () => this.failWorker(new SceneCompileError({ severity: 'error', code: 'COMPILER_WORKER', message: 'The scene compiler response could not be read.' }));
    this.worker = worker;
    return worker;
  }

  private request(request: Exclude<CompilerRequest, { type: 'release' }>, kind: Pending['kind'], local: () => Promise<Result>): Promise<Result> {
    if (this.disposed) return Promise.reject(new Error('Source compiler is disposed'));
    return new Promise((resolve, reject) => {
      const limit = request.limits.executionLimitMs ?? 200;
      const timeout = setTimeout(() => this.failWorker(new SceneCompileError({ severity: 'error', code: 'COMPILER_TIMEOUT', message: 'The scene compiler did not respond in time.' })), Number.isFinite(limit) ? Math.max(15000, limit + 5000) : 15000);
      this.pending.set(request.id, { kind, resolve, reject, timeout });
      if (typeof Worker === 'undefined') {
        void local().then(value => {
          const pending = this.pending.get(request.id); if (!pending) return;
          this.pending.delete(request.id); clearTimeout(pending.timeout); pending.resolve(value);
        }, error => {
          const pending = this.pending.get(request.id); if (!pending) return;
          this.pending.delete(request.id); clearTimeout(pending.timeout); pending.reject(error instanceof Error ? error : new Error(String(error)));
        });
      } else {
        try { this.ensureWorker().postMessage(request); }
        catch (error) { this.failWorker(error instanceof Error ? error : new Error(String(error))); }
      }
    });
  }

  async compile(source: string, input: CompileInput = {}, limits: CompileLimits = {}): Promise<CompiledScene> {
    const id = ++this.nextId;
    const workerLimits = { executionLimitMs: limits.executionLimitMs };
    const scene = await this.request({ id, source, input, limits: workerLimits }, 'scene', async () => {
      const program = await createSceneProgram(source, input, workerLimits);
      if (this.pending.has(id) && program.scene.reactiveBindings?.length) this.programs.set(id, program);
      else program.dispose();
      return program.scene;
    }) as CompiledScene;
    if (this.disposed) throw new Error('Source compiler is disposed');
    if (scene.reactiveBindings?.length) this.sessions.set(scene, id);
    return scene;
  }

  canUpdate(scene: CompiledScene): boolean { return this.sessions.has(scene); }

  update(scene: CompiledScene, values: Record<string, ControlValue>, changed: string[], limits: CompileLimits = {}, time?: number): Promise<ReactiveUpdate[]> {
    const session = this.sessions.get(scene);
    if (session === undefined) return Promise.reject(new Error('Reactive runtime is unavailable'));
    return this.request({ id: ++this.nextId, type: 'update', session, values, changed, duration: scene.duration, ...(time !== undefined ? { time } : {}), limits: { executionLimitMs: limits.executionLimitMs } }, 'updates', async () => {
      const program = this.programs.get(session);
      if (!program) throw new Error('Reactive runtime is unavailable');
      return program.update(values, changed, time, scene.duration);
    }) as Promise<ReactiveUpdate[]>;
  }

  /** Release abandoned candidates and superseded programs after each transaction. */
  retain(scenes: CompiledScene[]): void {
    const keep = new Set(scenes), released: number[] = [];
    for (const [scene, id] of this.sessions) if (!keep.has(scene)) {
      this.sessions.delete(scene); released.push(id);
      this.programs.get(id)?.dispose(); this.programs.delete(id);
    }
    if (released.length && this.worker) {
      try { this.worker.postMessage({ id: ++this.nextId, type: 'release', sessions: released } satisfies CompilerRequest); }
      catch (error) { this.failWorker(error instanceof Error ? error : new Error(String(error))); }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failWorker(new Error('Source compiler is disposed'));
  }
}
