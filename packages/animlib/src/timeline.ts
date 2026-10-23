import type { CameraState, ColorValue, CompiledScene, ElementState, Frame, Track } from "./types.js";
import { paletteResolver } from "./palette.js";
import { applyBindings } from "./bindings.js";
import { applyReactiveProperties } from "./reactive.js";
import {normalizeFocus} from './depth-focus.js';

export function easeAt(progress: number, ease: Track["ease"]): number {
  const t = Math.max(0, Math.min(1, progress));
  return ease === "smooth" ? t * t * (3 - 2 * t) : ease === "in" ? t * t : ease === "out" ? 1 - (1 - t) ** 2 : t;
}

function interpolate(from: unknown, to: unknown, t: number): unknown {
  if (t === 0) return structuredClone(from);
  if (t === 1) return structuredClone(to);
  if (typeof from === "number" && typeof to === "number") return from + (to - from) * t;
  if (Array.isArray(from) && Array.isArray(to)) return from.map((x, i) => interpolate(x, to[i], t));
  return t < 1 ? from : to;
}

/** Pure evaluation: seek and normal playback return the same frame for the same inputs. */
export function evaluateScene(scene: CompiledScene, requestedTime: number, options: { bindings?: boolean } = {}): Frame {
  const palette = paletteResolver(scene.options.palette);
  const time = Math.max(0, Math.min(scene.duration, requestedTime));
  const elements = new Map(scene.initial.map(e => [e.id, structuredClone(e)]));
  let camera = structuredClone(scene.camera);
  let cameraAnimated = false;
  const views = new Map((scene.views ?? []).map(v => [v.id, { ...structuredClone(v), cameraAnimated: false }]));
  const events = [
    ...scene.lifecycle.map((event, index) => ({ time: event.time, index, event })),
    ...scene.tracks.map((track, index) => ({ time: track.start, index: scene.lifecycle.length + index, track })),
  ].sort((a, b) => a.time - b.time || a.index - b.index);

  for (const item of events) {
    if (item.time > time) break;
    if ("event" in item) {
      const event = item.event;
      if (event.type === "add") for (const e of event.elements ?? []) elements.set(e.id, structuredClone(e));
      else if (event.type === "remove") {
        for (const id of event.ids) elements.delete(id);
        for (const e of elements.values()) if (e.geometry.children) e.geometry.children = e.geometry.children.filter(id => !event.ids.includes(id));
      }
      else for (const id of event.ids) { const e = elements.get(id); if (e) { e.persistent = true; delete e.transient; } }
      continue;
    }
    const track = item.track;
    const t = easeAt(track.duration === 0 ? 1 : (time - track.start) / track.duration, track.ease);
    if (track.action.type === "camera") {
      const view = track.action.view ? views.get(track.action.view) : undefined;
      const targetCamera = view?.camera ?? camera;
      if (time < track.start + track.duration) {
        if (view) view.cameraAnimated = true; else cameraAnimated = true;
      }
      for (const [key, target] of Object.entries(track.action.properties ?? {})) {
        const k = key as keyof CameraState;
        if(k==='focus'){
          const from=normalizeFocus(track.cameraFrom?.focus),to=normalizeFocus(target);
          if(t===1){targetCamera.focus=to;continue;}
          if(!from&&!to){delete targetCamera.focus;continue;}
          const start=from??{...to!,aperture:0},end=to??{...from!,aperture:0};
          targetCamera.focus={distance:start.distance+(end.distance-start.distance)*t,aperture:start.aperture+(end.aperture-start.aperture)*t,samples:start.samples};
          continue;
        }
        (targetCamera as unknown as Record<string, unknown>)[k] = interpolate(track.cameraFrom?.[k], target, t);
      }
      continue;
    }
    for (const id of track.action.ids) {
      const e = elements.get(id), from = track.from[id];
      if (!e || !from) continue;
      if (track.action.type === "morph") {
        const to = track.action.geometry!;
        e.geometry = structuredClone(t === 1 ? to : from.geometry);
        if (t < 1) e.morph = { from: structuredClone(from.geometry), to: structuredClone(to), progress: t, map: track.action.map };
        else delete e.morph;
      } else if (track.action.type === "numbers") {
        e.geometry.numbers = { ...e.geometry.numbers };
        for (const [key,target] of Object.entries(track.action.values ?? {})) {
          e.geometry.numbers[key] = interpolate(from.geometry.numbers?.[key],target,t) as number;
        }
      } else for (const [key, target] of Object.entries(track.action.properties ?? {})) {
        const start=key==='viewportOffset'?from.viewportOffset??[0,0]:key==='strokeEnd'?from.strokeEnd??1:key==='strokeStart'||key==='dashOffset'?from[key]??0:from[key as keyof ElementState];
        (e as unknown as Record<string, unknown>)[key] = key === "fill" || key === "stroke" ? palette.interpolate(start as ColorValue, target as ColorValue, t) : interpolate(start, target, t);
      }
    }
  }
  for (const binding of scene.reactiveBindings ?? []) {
    const target = elements.get(binding.target);
    if (target) applyReactiveProperties(target, binding.properties);
  }
  for (const e of elements.values()) {
    palette.validate(e.fill); palette.validate(e.stroke);
  }
  const frame = { ...(scene.options.lighting !== undefined ? { lighting: structuredClone(scene.options.lighting) } : {}), elements: [...elements.values()], camera, cameraAnimated, views: [...views.values()] };
  return options.bindings === false ? frame : applyBindings(frame, scene.bindings);
}
