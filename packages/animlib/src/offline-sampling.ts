import { createSceneProgram } from './compiler.js';
import { mergeReactiveUpdates } from './reactive.js';
import { evaluateScene } from './timeline.js';
import { SceneAssets } from './scene-assets.js';
import type { AssetGeometryResolver, AssetRegistry } from './asset-types.js';
import type { CompileInput, CompiledScene, Frame } from './types.js';

/** A scoped, compile-once sampler for export hosts. Controls are fixed by CompileInput. */
export interface OfflineSceneSampler {
  readonly assetGeometry: AssetGeometryResolver;
  /** Canonical time-zero scene; preparation may resolve its authoritative duration. */
  readonly scene: CompiledScene;
  /** Evaluate absolute time, clamped to the scene. Omitted time samples the outgoing endpoint. */
  sample(time?: number): Frame;
}

/** Keep retained callbacks alive only while the export consumes this scene.
 * Both synchronous and asynchronous export failures release the QuickJS context/runtime.
 */
export async function withOfflineScene<T>(
  source: string,
  input: CompileInput,
  use: (sampler: OfflineSceneSampler) => T | Promise<T>,
  limits: { executionLimitMs?: number; modelAssets?: AssetRegistry } = {},
): Promise<T> {
  const program = await createSceneProgram(source, { ...input, assetCatalog: limits.modelAssets?.catalog ?? input.assetCatalog }, limits);
  const assets = new SceneAssets(limits.modelAssets);
  let disposed = false;
  try {
    const scene = program.scene;
    assets.prepare(scene);
    const values = Object.fromEntries(scene.controls.map(control => [control.id, control.value]));
    return await use({
      scene,
      assetGeometry: assets,
      sample(time = scene.duration) {
        if (disposed) throw new Error('Offline scene sampler is disposed');
        if (!Number.isFinite(time)) throw new Error('Sample time must be finite');
        time = Math.max(0, Math.min(scene.duration, time));
        let snapshot = scene;
        if (scene.reactiveBindings?.some(binding => binding.time) && time !== scene.reactiveTime) {
          const updates = program.update(values, [], time, scene.duration);
          snapshot = { ...scene, reactiveBindings: mergeReactiveUpdates(scene, updates, [], time), reactiveTime: time };
        }
        return evaluateScene(snapshot, time);
      },
    });
  } finally {
    disposed = true;
    program.dispose();
    assets.dispose();
  }
}
