import { createSceneProgram, SceneCompileError } from './compiler.js';
import type { SceneProgram } from './compiler.js';
import type { CompilerRequest, CompilerResponse } from './compiler-client.js';

const programs = new Map<number, SceneProgram>();
// Programs and callbacks stay inside QuickJS without browser host bindings.
const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<CompilerRequest>) => void) | null;
  postMessage(response: CompilerResponse): void;
};
worker.onmessage = event => {
  const request = event.data;
  if (request.type === 'release') {
    for (const id of request.sessions) { programs.get(id)?.dispose(); programs.delete(id); }
    return;
  }
  void (async () => {
    if (request.type === 'update') {
      const program = programs.get(request.session);
      if (!program) throw new Error('Reactive runtime is unavailable');
      worker.postMessage({ id: request.id, ok: true, updates: program.update(request.values, request.changed, request.time, request.duration) });
    } else {
      const program = await createSceneProgram(request.source, request.input, request.limits);
      if (program.scene.reactiveBindings?.length) programs.set(request.id, program);
      else program.dispose();
      worker.postMessage({ id: request.id, ok: true, scene: program.scene });
    }
  })().catch(error => {
    worker.postMessage({ id: request.id, ok: false, diagnostic: error instanceof SceneCompileError ? error.diagnostic : {
      severity: 'error', code: 'SCENE_CODE', message: error instanceof Error ? error.message : String(error),
    } });
  });
};
