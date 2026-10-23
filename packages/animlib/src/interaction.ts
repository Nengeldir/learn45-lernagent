import { easeAt } from './timeline.js';
import type { CameraState, CompiledScene, Track } from './types.js';

export interface Orbit { yaw: number; pitch: number }

interface Rotation {
  key: string; view: string; start: number; duration: number; ease: Track['ease'];
  from: CameraState; to: CameraState;
}
interface SceneInteraction {
  time: number;
  offsets: Map<string, Orbit>;
  handoffs: Map<string, Orbit>;
  compiled?: CompiledScene;
  rotations: Rotation[];
}

function rotationsIn(compiled: CompiledScene): Rotation[] {
  const groups = new Map<string, Rotation & { rotates: boolean }>();
  for (const track of compiled.tracks) {
    if (track.action.type !== 'camera') continue;
    const view = track.action.view ?? '';
    const key = JSON.stringify([view, track.start, track.duration, track.ease]);
    let group = groups.get(key);
    if (!group) {
      group = { key, view, start: track.start, duration: track.duration, ease: track.ease,
        from: { ...track.cameraFrom! }, to: { ...track.cameraFrom! }, rotates: false };
      groups.set(key, group);
    }
    const props = track.action.properties ?? {};
    Object.assign(group.to, props);
    group.rotates ||= Object.hasOwn(props, 'yaw') || Object.hasOwn(props, 'pitch');
  }
  // Parallel yaw/pitch actions on one camera must share a single captured start.
  return [...groups.values()].filter(group => group.rotates).map(group => ({
    ...group, key: JSON.stringify([group.key, group.from, group.to]),
  })).sort((a, b) => a.start - b.start);
}

function capture(orbit: Orbit, rotation: Rotation): Orbit {
  const result = { ...orbit };
  if (orbit.yaw !== 0 && rotation.from.perspective === 1 && rotation.to.perspective === 1) {
    // Equivalent starting yaw nearest the destination avoids unwinding viewer spins.
    // Untouched authored motion (including deliberate full turns) stays unchanged.
    const delta = rotation.from.yaw + orbit.yaw - rotation.to.yaw;
    result.yaw = rotation.to.yaw + Math.atan2(Math.sin(delta), Math.cos(delta)) - rotation.from.yaw;
  }
  return result;
}

/** Viewer state is kept outside compiled frames and isolated by scene and view ID. */
export class ViewInteraction {
  private scenes = new Map<string, SceneInteraction>();
  private offsets = new Map<string, Orbit>();

  sync(id: string, time: number, compiled: CompiledScene): void {
    let state = this.scenes.get(id);
    if (!state) {
      state = { time, offsets: new Map(), handoffs: new Map(), rotations: [] };
      this.scenes.set(id, state);
    }
    const before = state.time;
    this.offsets = state.offsets;
    const ids = new Set(['', ...(compiled.views ?? []).map(view => view.id)]);
    for (const view of this.offsets.keys()) if (!ids.has(view)) this.offsets.delete(view);
    if (state.compiled !== compiled) {
      state.compiled = compiled;
      state.rotations = rotationsIn(compiled);
      const keys = new Set(state.rotations.map(rotation => rotation.key));
      for (const key of state.handoffs.keys()) if (!keys.has(key)) state.handoffs.delete(key);
    }
    const backward = time < before;
    for (const rotation of backward ? [...state.rotations].reverse() : state.rotations) {
      const { start, duration, view, key } = rotation, end = start + duration;
      const inside = time >= start && time < end;
      const crossed = duration === 0
        ? before < start && time >= start || time < start && before >= start
        : backward ? before >= start && time < end : time > before && before < end && time >= start;
      if (!inside && !crossed) continue;
      if (backward) {
        this.offsets.delete(view);
        // Rewinding before a rotation restores its authored starting pose. Scrubs
        // within it replay the same handoff, rather than recapturing a partial pose.
        if (time < start) state.handoffs.delete(key);
      } else if (!state.handoffs.has(key)) {
        state.handoffs.set(key, capture(this.get(view), rotation));
      }
      const handoff = state.handoffs.get(key);
      if (inside && handoff) {
        const remaining = 1 - easeAt((time - start) / duration, rotation.ease);
        this.offsets.set(view, { yaw: handoff.yaw * remaining, pitch: handoff.pitch * remaining });
      } else this.offsets.delete(view);
    }
    state.time = time;
  }

  get(view = ''): Orbit { return { ...(this.offsets.get(view) ?? { yaw: 0, pitch: 0 }) }; }
  set(orbit: Orbit, view = ''): void { this.offsets.set(view, { ...orbit }); }
  reset(): void { this.scenes.clear(); this.offsets = new Map(); }
}
