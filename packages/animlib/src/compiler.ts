import { createSampledState } from './diagrams/sampled-state.js';
import { createNucleicBuilders } from './nucleic-structures.js';
import { createNucleicProcessingBuilders } from './nucleic-processing.js';
import { createNucleicTranscriptionCycleBuilders } from './nucleic-transcription-cycle.js';
import { createNucleicTranslationBuilders } from './nucleic-translation.js';
import { createPeptideBuilders } from './peptide-motion.js';
import { validateImageGeometry } from "./image-validation.js";
import { validateModelMetadata } from './model-metadata.js';
import { validateSurfaceAppearance } from "./appearance-validation.js";
import { parse } from "acorn";
import { getQuickJS } from "quickjs-emscripten";
import { buildScene } from "./runtime.js";
import { createSurfaceBuilders } from "./surfaces.js";
import { createSolidBuilders } from "./solids.js";
import { createMoleculeBuilders } from './molecules.js';
import { createAssetBuilders } from './asset-builders.js';
import { catalogImage, catalogPart, validateAssetCatalog } from './asset-catalog.js';
import type { AssetDescriptor } from './asset-types.js';
import { createMolecularBackboneBuilders } from './molecular-backbone.js';
import { createCoordinateBuilders } from './diagrams/coordinates.js';
import { createGraphAlgorithms, createGraphBuilders } from './diagrams/graphs.js';
import { createCollectionBuilders } from './diagrams/collections.js';
import { createCompactQueueBuilders } from './diagrams/compact-queue.js';
import { validateLighting } from "./lighting.js";
import { validatePath } from "./path.js";
import { validatePathStroke } from './path-stroke.js';
import { Color, enforceScenePalette, paletteResolver, validateColor } from "./palette.js";
import type { CameraState, CompileInput, CompiledScene, ControlValue, Diagnostic, ElementState, Geometry, ReactiveUpdate } from "./types.js";
import { mergeReactiveUpdates, validateReactiveBindings } from './reactive.js';
import {normalizeFocus} from './depth-focus.js';

export class SceneCompileError extends Error {
  constructor(public diagnostic: Diagnostic) { super(diagnostic.message); this.name = "SceneCompileError"; }
}

const kinds = new Set(["circle", "sphere", "rectangle", "path", "line", "arrow", "text", "latex", "mesh", "group", "model"]);
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function number(value: unknown, label: string) { check(typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e6, `Invalid ${label}`); }
function vec(value: unknown, label: string, size = 3) { check(Array.isArray(value) && value.length === size, `Invalid ${label}`); value.forEach(n => number(n, label)); }
function geometry(g: Geometry, catalog: AssetDescriptor[] = []) {
  check(g && kinds.has(g.kind), "Invalid geometry kind");
  if(g.asset) {
    check(g.kind==='mesh'&&g.vertices===undefined&&g.triangles===undefined&&g.normals===undefined&&g.scalarColors===undefined&&g.uv0===undefined,'Referenced model assets cannot contain inline or deformed geometry');
    catalogPart(g.asset,catalog);
  }
  const part=g.asset?catalogPart(g.asset,catalog):undefined;
  validateImageGeometry(g,part?.vertexCount,part?.hasUV0??Boolean(g.uv0));
  if(g.imageTexture)catalogImage(g.imageTexture.image,catalog);
  check(!Object.keys(g).some(k => k.startsWith('_')), 'Internal geometry fields are host-owned');
  if (g.kind === 'model') {
    const r = g.model;
    check(r && typeof r.asset === 'string' && r.asset.length > 0 && r.asset.length <= 256 && Number.isInteger(r.primitive) && r.primitive >= 0 && r.primitive < 256, 'Invalid model reference');
    vec(r.bounds?.min, 'model bounds'); vec(r.bounds?.max, 'model bounds');
    check(r.bounds.min.every((v,i) => v <= r.bounds.max[i]), 'Invalid model bounds');
  } else check(g.model === undefined, 'Model references require model geometry');
  for (const key of ["radius", "width", "height", "fontSize"] as const) if (g[key] !== undefined) { number(g[key], key); check(g[key]! >= 0, `${key} must be nonnegative`); }
  for (const key of ["points", "vertices"] as const) if (g[key]) {
    check(Array.isArray(g[key]) && g[key]!.length <= 20000, `Invalid or oversized ${key}`);
    g[key]!.forEach(p => { check(Array.isArray(p) && (p.length === 2 || p.length === 3), `Invalid ${key} coordinate`); p.forEach(v => number(v, key)); });
  }
  for (const key of ["text", "tex"] as const) if (g[key] !== undefined) check(typeof g[key] === "string" && g[key]!.length <= 20000, `Invalid or oversized ${key}`);
  if (g.kind === "text") check(typeof g.text === "string", "Text requires a string");
  if (g.kind === "latex") check(typeof g.tex === "string", "LaTeX requires a tex string");
  if (g.anchor !== undefined) check(g.kind === "latex" && typeof g.anchor === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(g.anchor), "Invalid LaTeX anchor");
  if (g.numberFormat !== undefined) check(g.kind === "latex" && g.numberFormat && typeof g.numberFormat === "object" && !Array.isArray(g.numberFormat), "Invalid numeric format");
  const decimals = g.numberFormat?.decimals === undefined ? 2 : g.numberFormat.decimals, digits = g.numberFormat?.digits === undefined ? 1 : g.numberFormat.digits;
  check(Number.isInteger(decimals) && decimals >= 0 && decimals <= 4 && Number.isInteger(digits) && digits >= 1 && digits <= 6, "Numeric format requires decimals 0–4 and digits 1–6");
  if (g.numbers !== undefined) {
    check(g.kind === "latex" && g.numbers && typeof g.numbers === "object" && !Array.isArray(g.numbers) && Object.keys(g.numbers).length <= 100, "Invalid numeric slots");
    for (const [id,value] of Object.entries(g.numbers)) {
      check(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id), "Invalid numeric slot ID"); number(value,"numeric slot value");
      check(Math.abs(Number(value.toFixed(decimals))) < 10 ** digits, `Numeric slot ${id} exceeds its reserved digit width`);
    }
  }
  if (g.d !== undefined || g.curve !== undefined) check(g.kind === "path", "Only paths support d or curve");
  if (g.kind === "path") validatePath(g);
  if (g.kind === "line" || g.kind === "arrow") check((g.points?.length ?? 0) >= 2, "Line/arrow requires at least two points");
  if (g.kind === "group") check(Array.isArray(g.children) && g.children.length <= 2000 && g.children.every(id => typeof id === "string"), "Invalid group children");
  if (g.isolated !== undefined) check(g.kind === "group" && typeof g.isolated === "boolean", "Only groups support isolation");
  if (g.shading !== undefined) check(g.kind === "mesh" && ["unlit", "flat", "smooth"].includes(g.shading), "Invalid mesh shading");
  validateSurfaceAppearance(g);
  if (g.clipPlanes !== undefined) {
    check((g.kind === "mesh" || g.kind === "sphere") && Array.isArray(g.clipPlanes) && g.clipPlanes.length <= 4, "Clipping requires at most four planes on a mesh or sphere");
    for (const p of g.clipPlanes) {
      check(p && typeof p === "object", "Invalid clip plane");
      vec(p.normal, "clip normal"); check(Math.hypot(...p.normal) > 1e-12, "Clip normal must be nonzero"); number(p.offset, "clip offset");
      if (p.section !== undefined) {
        check(p.section && typeof p.section === "object" && !Array.isArray(p.section), "Invalid section");
        validateColor(p.section.color);
        if (p.section.cap !== undefined) validateColor(p.section.cap);
        if (p.section.width !== undefined) { number(p.section.width, "section width"); check(p.section.width > 0, "Section width must be positive"); }
      }
    }
  }
  if (g.outline !== undefined) {
    const o = g.outline;
    check((g.kind === "mesh" || g.kind === "sphere") && o && typeof o === "object" && !Array.isArray(o), "Outlines require mesh or sphere geometry");
    validateColor(o.color);
    if (o.width !== undefined) { number(o.width, "outline width"); check(o.width > 0, "Outline width must be positive"); }
    if (o.creaseAngle !== undefined) { number(o.creaseAngle, "crease angle"); check(o.creaseAngle >= 0 && o.creaseAngle <= Math.PI, "Crease angle must be in [0, PI]"); }
    if (o.silhouette !== undefined) check(typeof o.silhouette === "boolean", "Invalid silhouette flag");
  }
  if (g.scalarColors !== undefined) {
    const c = g.scalarColors;
    check(g.kind === "mesh" && c && typeof c === "object" && Array.isArray(c.values) && c.values.length === g.vertices?.length, "Scalar values must match mesh vertices");
    c.values.forEach(v => number(v, "scalar value")); vec(c.domain, "scalar domain", 2); check(c.domain[0] < c.domain[1], "Scalar domain must increase");
    check(Array.isArray(c.colors) && c.colors.length >= 2 && c.colors.length <= 16, "Scalar ramp requires 2–16 colors");
    for (const color of c.colors) { check(typeof color === "string" && (color as string) !== "none", "Scalar ramp requires named palette colors"); validateColor(color); }
  }
  if (g.labelOcclusion !== undefined) check((g.kind === "text" || g.kind === "latex") && ["depth", "overlay", "hide", "fade"].includes(g.labelOcclusion), "Invalid label occlusion");
  if (g.normals !== undefined) {
    check(g.kind === "mesh" && Array.isArray(g.normals) && g.normals.length === g.vertices?.length, "Mesh normals must match vertices");
    for (const normal of g.normals) { vec(normal, "mesh normal"); check(Math.hypot(...normal) > 0, "Mesh normals must be nonzero"); }
  }
  if (g.kind === "mesh" && !g.asset) {
    check(Array.isArray(g.vertices) && Array.isArray(g.triangles) && g.triangles.length <= 20000, "Mesh requires vertices and triangles");
    for (const triangle of g.triangles) check(triangle.length === 3 && triangle.every(i => Number.isInteger(i) && i >= 0 && i < g.vertices!.length), "Invalid mesh triangle index");
  }
}
function element(e: ElementState, catalog: AssetDescriptor[] = []) {
  check(e && typeof e.id === "string" && e.id.length <= 512, "Invalid element ID");
  geometry(e.geometry,catalog); vec(e.position, "position"); vec(e.rotation, "rotation");
  validatePathStroke(e, e.geometry.kind);
  number(e.scale, "scale"); number(e.opacity, "opacity"); number(e.strokeWidth, "strokeWidth");
  check(e.scale >= 0 && e.opacity >= 0 && e.opacity <= 1 && e.strokeWidth >= 0, "Invalid element style range");
  for (const key of ["fill", "stroke"] as const) {
    try { validateColor(e[key]); } catch (error) { throw new Error(`${e.id} ${key}: ${(error as Error).message}`); }
  }
  check(e.space === "world" || e.space === "screen", "Invalid element space");
  if (e.strokeProfile !== undefined) {
    check(e.strokeProfile === "flat" || e.strokeProfile === "round", "Invalid stroke profile");
    check(e.strokeProfile !== "round" || e.space === "world", "Round strokes require world space");
  }
  if (e.castShadow !== undefined) check(typeof e.castShadow === "boolean", "Invalid castShadow flag");
  if (e.billboard !== undefined) check(typeof e.billboard === "boolean", "Invalid billboard flag");
  if (e.billboardOffset !== undefined) vec(e.billboardOffset,"billboard offset");
  if (e.viewportOffset !== undefined) vec(e.viewportOffset,"viewport offset",2);
  check(typeof e.persistent === "boolean", "Invalid persistence flag");
  check(e.morph === undefined, "Active morphs are not valid in compiled starting states");
}
function camera(c: CameraState) {
  check(c && typeof c === "object", "Invalid camera");
  for (const key of ["yaw", "pitch", "height", "distance", "perspective"] as const) number(c[key], `camera ${key}`);
  vec(c.target, "camera target");
  check(c.height > 0 && c.distance > 0 && c.perspective >= 0 && c.perspective <= 1, "Invalid camera range");
  normalizeFocus(c.focus);
}

/** Validate the VM boundary: scene code may only return bounded plain animation data. */
export function validateCompiledScene(scene: CompiledScene, catalog: AssetDescriptor[] = []): void {
  validateAssetCatalog(catalog);
  check(scene && typeof scene === "object", "Source must default-export a scene() definition");
  number(scene.duration, "scene duration"); check(scene.duration >= 0 && scene.duration <= 86400, "Scene duration must be between 0 and 24 hours");
  check(scene.options && ["2d", "3d"].includes(scene.options.mode) && ["hold", "advance"].includes(scene.options.end), "Invalid scene options");
  check(typeof scene.options.orbit === "boolean" && typeof scene.options.background === "string" && scene.options.background.length <= 128, "Invalid scene display options");
  if (scene.options.audio !== undefined) check(typeof scene.options.audio === "string" && scene.options.audio.length <= 256, "Invalid audio asset ID");
  validateLighting(scene.options.lighting);
  camera(scene.camera);
  check(scene.views === undefined || Array.isArray(scene.views) && scene.views.length <= 32, "Invalid or oversized views");
  const viewIds = new Set<string>();
  for (const view of scene.views ?? []) {
    check(typeof view.id === "string" && view.id.length > 0 && view.id.length <= 256 && !view.id.startsWith("@") && !viewIds.has(view.id), "Invalid or duplicate view ID");
    viewIds.add(view.id);
    vec(view.rect, "view rectangle", 4);
    const [x,y,w,h] = view.rect;
    check(x >= 0 && y >= 0 && w > 0 && h > 0 && x+w <= 1+1e-9 && y+h <= 1+1e-9, "View rectangle must fit within the canvas");
    check(typeof view.orbit === "boolean", "Invalid view orbit flag");
    check(view.orbitHitTest === undefined || view.orbitHitTest === 'geometry', 'Invalid view orbit hit test');
    camera(view.camera);
  }
  const checkView = (e: ElementState) => check(e.view === undefined || typeof e.view === "string" && viewIds.has(e.view), "Element references unknown view");
  check(Array.isArray(scene.initial) && scene.initial.length <= 2000, "Invalid initial elements"); scene.initial.forEach(e => { element(e,catalog); checkView(e); });
  check(Array.isArray(scene.lifecycle) && scene.lifecycle.length <= 20000, "Invalid lifecycle");
  let totalPoints = 0;
  const examine = (e: ElementState) => { element(e,catalog); checkView(e); totalPoints += (e.geometry.kind === 'path' ? validatePath(e.geometry) : e.geometry.points?.length ?? 0) + (e.geometry.asset ? catalogPart(e.geometry.asset,catalog).vertexCount : e.geometry.vertices?.length ?? 0); check(totalPoints <= 100000, "Scene geometry budget exceeded"); };
  const groupGraph = new Map<string, string[]>();
  for (const e of scene.initial) if (e.geometry.children) groupGraph.set(e.id, e.geometry.children);
  for (const event of scene.lifecycle) {
    number(event.time, "lifecycle time"); check(event.time >= 0 && event.time <= scene.duration, "Lifecycle outside scene duration");
    check(["add", "remove", "keep"].includes(event.type) && Array.isArray(event.ids) && event.ids.length <= 2000 && event.ids.every(id => typeof id === "string"), "Invalid lifecycle event");
    if (event.type === "add") {
      check(Array.isArray(event.elements) && event.elements.length === event.ids.length, "Invalid added elements");
      event.elements.forEach((e, i) => { check(e.id === event.ids[i], "Mismatched lifecycle ID"); examine(e); if (e.geometry.children) groupGraph.set(e.id, e.geometry.children); });
    }
  }
  const visited = new Set<string>();
  const visit = (id: string, path: Set<string>) => {
    check(!path.has(id), `Cyclic group ${id}`); if (visited.has(id)) return;
    const next = new Set(path).add(id); for (const child of groupGraph.get(id) ?? []) visit(child, next); visited.add(id);
  };
  for (const id of groupGraph.keys()) visit(id, new Set());
  const all = new Map([...scene.initial, ...scene.lifecycle.flatMap(e => e.elements ?? [])].map(e => [e.id, e]));
  for (const root of all.values()) if (root.geometry.isolated) {
    const spaces = new Set<string>();
    const inspect = (id: string, depth: number) => {
      const e = all.get(id); if (!e) return;
      const next = depth + (e.geometry.isolated ? 1 : 0);
      check(next <= 16, "Isolated group nesting limit exceeded (16)");
      if (e.geometry.kind === "group") for (const child of e.geometry.children ?? []) inspect(child, next);
      else spaces.add(e.space);
    };
    inspect(root.id, 0);check(spaces.size <= 1, "An isolated group must use one coordinate space");
  }
  check(scene.behaviors === undefined || Array.isArray(scene.behaviors) && scene.behaviors.length <= 4000, "Invalid or oversized behaviors");
  const behaviorKeys = new Set<string>();
  for (const { target, behavior: b } of scene.behaviors ?? []) {
    check(all.has(target) && b && ["drag", "spring", "custom"].includes(b.type), "Invalid behavior target or type");
    const key = JSON.stringify([target, b.type, b.type === "custom" ? b.name : ""]);
    check(!behaviorKeys.has(key), "Duplicate behavior"); behaviorKeys.add(key);
    if (b.type === "drag") {
      check(b.plane === undefined || ["screen", "xy", "xz", "yz"].includes(b.plane), "Invalid drag plane");
      check(b.axis === undefined || ["x", "y", "z"].includes(b.axis), "Invalid drag axis");
      check(b.axis === undefined || b.plane === undefined, "Choose a drag axis or plane");
      check(b.bounds === undefined || b.path === undefined, "Choose drag bounds or path");
      if (b.bounds !== undefined) {
        check(b.bounds && typeof b.bounds === 'object', 'Invalid drag bounds');
        check(b.axis !== undefined || ['xy','xz','yz'].includes(b.plane ?? ''), 'Drag bounds require a fixed world plane or axis');
        vec(b.bounds.min, 'drag bounds min'); vec(b.bounds.max, 'drag bounds max');
        check(b.bounds.min.every((v,i)=>v<=b.bounds!.max[i]), 'Drag bounds min must not exceed max');
      }
      if (b.path !== undefined) {
        check(b.path && typeof b.path === 'object', 'Invalid drag path');
        check(b.axis === undefined && ['xy','xz','yz'].includes(b.plane ?? ''), 'Drag path requires a fixed world plane and no axis');
        check(b.path.closed === undefined || typeof b.path.closed === 'boolean', 'Invalid closed drag path');
        const points=b.path.points;
        check(Array.isArray(points) && points.length >= (b.path.closed ? 3 : 2) && points.length <= 256, 'Drag path requires 2–256 points (at least 3 when closed)');
        points.forEach(p=>vec(p,'drag path point'));
        const fixed=b.plane==='xy'?2:b.plane==='xz'?1:0;
        check(points.every(p=>Math.abs(p[fixed]-points[0][fixed])<1e-9), 'Drag path must lie on its selected world plane');
        for(let i=0;i<points.length-(b.path.closed?0:1);i++) {
          const a=points[i],next=points[(i+1)%points.length];
          check(Math.hypot(...a.map((v,j)=>v-next[j]))>1e-6, 'Drag path segments must have nonzero length; do not repeat the closing point');
        }
      }
    } else if (b.type === "spring") {
      for (const k of ["stiffness", "damping"] as const) if (b[k] !== undefined) { number(b[k], k); check(b[k]! > 0 && b[k]! <= 1000, `Invalid spring ${k}`); }
    } else {
      check(typeof b.name === "string" && b.name.length > 0 && b.name.length <= 128, "Invalid custom behavior name");
      check(JSON.stringify(b.options ?? null).length <= 16000, "Custom behavior options exceed 16 KB");
    }
  }
  check(scene.bindings === undefined || Array.isArray(scene.bindings) && scene.bindings.length <= 2000, "Invalid or oversized bindings");
  const dependencies = new Map<string, string[]>();
  // Parent transforms and bindings both contribute dependencies.
  for (const e of all.values()) for (const id of e.geometry.children ?? []) dependencies.set(id, [e.id]);
  const bound = new Set<string>();
  for (const b of scene.bindings ?? []) {
    check(b && ["attach", "connect"].includes(b.type) && all.has(b.target), "Invalid binding");
    check(!bound.has(b.target), "An element can have only one binding"); bound.add(b.target);
    const target = all.get(b.target)!;
    const sources = b.type === "attach" ? [b.source] : [b.from, b.to];
    for (const id of sources) check(all.has(id) && all.get(id)!.view === target.view && all.get(id)!.space === target.space, "Bindings require existing elements in the same view and space");
    if (b.type === "attach") {
      if (b.offset !== undefined) vec(b.offset, "attachment offset");
      check(b.anchor===undefined || b.anchor==='origin' || b.anchor==='midpoint', 'Invalid attachment anchor');
      if(b.anchor==='midpoint') check(['line','arrow'].includes(all.get(b.source)!.geometry.kind), 'Midpoint attachment requires a line or arrow');
    }
    else {
      check(["line", "arrow"].includes(target.geometry.kind), "Connect requires a line or arrow");
      check(b.endpoints === undefined || ["center", "surface", "bounds"].includes(b.endpoints), "Invalid connector endpoints");
      if (b.offset !== undefined) number(b.offset, "connector offset");
      if (b.endpoints === "surface") for (const id of sources) check(["sphere", "circle"].includes(all.get(id)!.geometry.kind), "Surface connectors require spheres or circles");
    }
    dependencies.set(b.target, [...(dependencies.get(b.target) ?? []), ...sources]);
  }
  const resolved = new Set<string>();
  const resolve = (id: string, path = new Set<string>()) => {
    check(!path.has(id), "Cyclic binding or parent dependency"); if (resolved.has(id)) return;
    const next = new Set(path).add(id); for (const dep of dependencies.get(id) ?? []) resolve(dep, next); resolved.add(id);
  };
  for (const id of dependencies.keys()) resolve(id);
  for (const b of scene.behaviors ?? []) check(!bound.has(b.target), "A bound element cannot also have behaviors");
  const live = new Map(scene.initial.map(e => [e.id, structuredClone(e)]));
  const checkGroups = () => {
    const owners = new Map<string, string>();
    for (const e of live.values()) for (const child of e.geometry.children ?? []) {
      check(live.has(child), `Group ${e.id} references missing child ${child}`);
      check(!owners.has(child), `Group child ${child} has multiple parents`);
      check(e.view === live.get(child)!.view || e.id.startsWith("@") && e.transient, "Groups must contain elements from the same view");
      owners.set(child, e.id);
    }
  };
  checkGroups();
  for (const event of [...scene.lifecycle].sort((a, b) => a.time - b.time)) {
    if (event.type === "add") {
      for (const e of event.elements ?? []) { check(!live.has(e.id), `Duplicate element ID ${e.id}`); live.set(e.id, structuredClone(e)); }
    } else if (event.type === "remove") {
      for (const id of event.ids) live.delete(id);
      for (const e of live.values()) if (e.geometry.children) e.geometry.children = e.geometry.children.filter(id => !event.ids.includes(id));
    }
    checkGroups();
  }
  check(Array.isArray(scene.tracks) && scene.tracks.length <= 10000, "Invalid animation tracks");
  const animatedKeys = new Set(["position", "rotation", "scale", "opacity", "fill", "stroke", "strokeWidth", "viewportOffset", "strokeStart", "strokeEnd", "dashOffset"]);
  for (const track of scene.tracks) {
    number(track.start, "track start"); number(track.duration, "track duration");
    check(track.start >= 0 && track.duration >= 0 && track.start + track.duration <= scene.duration + 1e-6, "Track outside scene duration");
    check(["linear", "smooth", "in", "out"].includes(track.ease), "Invalid easing");
    const a = track.action;
    check(a && ["camera", "animate", "morph", "numbers"].includes(a.type) && Array.isArray(a.ids) && a.ids.length <= 2000, "Invalid animation action");
    if (a.type === "camera") {
      check(a.view === undefined || typeof a.view === "string" && viewIds.has(a.view), "Camera references unknown view");
      camera(track.cameraFrom!);
      check(Object.keys(a.properties ?? {}).every(key => ["yaw", "pitch", "height", "distance", "perspective", "target", "focus"].includes(key)), "Unknown camera property");
      camera({ ...track.cameraFrom!, ...a.properties });
      const before=normalizeFocus(track.cameraFrom?.focus),after=normalizeFocus((a.properties as Partial<CameraState>)?.focus);
      if(track.duration>0&&before&&after)check(before.samples===after.samples,'Focus samples cannot change during an animation; use a zero-duration camera change.');
    } else {
      check(track.from && typeof track.from === "object", "Missing animation starting states");
      for (const id of a.ids) {
        check(typeof id === "string" && Object.hasOwn(track.from, id), "Missing animation element");
        const from = track.from[id]; element(from,catalog); checkView(from);
        check(from.id === id, "Mismatched animation starting ID");
        if (a.type === "morph") {
          check(!from.geometry.asset&&!a.geometry?.asset,'Referenced model assets cannot morph');
          check(from.geometry.kind !== 'model' && a.geometry?.kind !== 'model', 'Model geometry cannot be morphed');
          geometry(a.geometry!,catalog);
          validatePathStroke(from, a.geometry!.kind);
          if (a.map) check(typeof a.map === "object" && Object.entries(a.map).every(([x, y]) => typeof x === "string" && typeof y === "string"), "Invalid morph map");
        } else if (a.type === "numbers") {
          check(from.geometry.kind === "latex" && from.geometry.numbers && a.values && typeof a.values === "object" && !Array.isArray(a.values), "countTo requires LaTeX numeric slots and values");
          check(Object.keys(a.values).every(key => Object.hasOwn(from.geometry.numbers!,key)), "Unknown numeric slot in countTo");
          geometry({ ...from.geometry, numbers: { ...from.geometry.numbers, ...a.values } },catalog);
        } else {
          check(Object.keys(a.properties ?? {}).every(key => animatedKeys.has(key)), "Unknown animatable property");
          element({ ...from, ...a.properties } as ElementState,catalog);
        }
      }
    }
  }
  check(Array.isArray(scene.controls) && scene.controls.length <= 100, "Invalid controls");
  const ids = new Set<string>();
  for (const c of scene.controls) {
    check(typeof c.id === "string" && !ids.has(c.id) && typeof c.label === "string" && c.label.length <= 512, "Invalid control ID or label"); ids.add(c.id);
    check(["slider", "toggle", "select"].includes(c.kind), "Invalid control kind");
    check(c.reactive === undefined || typeof c.reactive === 'boolean' && c.kind === 'slider', 'Only sliders support reactive inputs');
    if (c.position !== undefined) { vec(c.position, "control position", 2); check(c.position.every(v => v >= 0 && v <= 1), "Control position must be within the canvas"); }
    if (c.width !== undefined) { number(c.width, "control width"); check(c.width > 0 && c.width <= 4096, "Invalid control width"); }
    if (c.kind === "slider") { number(c.value, "slider value"); number(c.default, "slider default"); number(c.min, "slider min"); number(c.max, "slider max"); check(c.min! <= c.max! && Number(c.value) >= c.min! && Number(c.value) <= c.max!, "Invalid slider range"); if (c.step !== undefined) { number(c.step, "slider step"); check(c.step > 0, "Invalid slider step"); } }
    if (c.kind === "toggle") check(typeof c.value === "boolean" && typeof c.default === "boolean", "Invalid toggle value");
    if (c.kind === "select") check(Array.isArray(c.options) && c.options.length <= 100 && c.options.every(o => typeof o === "string" && o.length <= 256) && c.options.includes(String(c.value)), "Invalid select options/value");
  }
  validateReactiveBindings(scene);
}

export interface SceneProgram {
  scene: CompiledScene;
  update(values: Record<string, ControlValue>, changed: string[], time?: number, duration?: number): ReactiveUpdate[];
  dispose(): void;
}

/** A worker-owned program retains callback closures; only plain data leaves this boundary. */
export async function createSceneProgram(source: string, input: CompileInput = {}, limits: { executionLimitMs?: number } = {}): Promise<SceneProgram> {
  let vm: ReturnType<Awaited<ReturnType<typeof getQuickJS>>["newContext"]> | undefined;
  let retained = false;
  try {
    for (const m of Object.values(input.models ?? {})) validateModelMetadata(m);
    const resolver = paletteResolver(input.palette);
    validateAssetCatalog(input.assetCatalog);
    input = { ...input, assetCatalog: structuredClone(input.assetCatalog ?? []), models: structuredClone(input.models ?? {}), palette: resolver.palette };
    check(typeof source === "string" && source.length <= 256000, "Scene source limit exceeded (256 KB)");
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
    const exports = ast.body.filter(node => node.type === "ExportDefaultDeclaration");
    check(exports.length === 1, "Each source must have exactly one default-exported scene");
    check(!ast.body.some(node => ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)), "Imports and additional exports are not supported; use scene and math from the provided environment");
    const declaration = exports[0] as unknown as { start: number; declaration: { start: number } };
    const rewritten = source.slice(0, declaration.start) + "globalThis.__animlibResult = " + source.slice(declaration.declaration.start);
    const QuickJS = await getQuickJS();
    vm = QuickJS.newContext();
    vm.runtime.setMemoryLimit(32 * 1024 * 1024);
    vm.runtime.setMaxStackSize(512 * 1024);
    let deadline = 0;
    const execute = (code: string, file: string): string | undefined => {
      const result = vm!.evalCode(code, file);
      if (result.error) {
        const error = vm!.dump(result.error) as { message?: string; stack?: string }; result.error.dispose();
        const match = /scene\.js:(\d+)(?::(\d+))?/.exec(error.stack ?? "");
        throw new SceneCompileError({ severity: "error", code: error.message?.includes("interrupt") ? "EXECUTION_LIMIT" : "SCENE_CODE", message: error.message ?? String(error), ...(match ? { line: Number(match[1]), column: Number(match[2] ?? 1) } : {}), hint: "Use a synchronous scene builder, bounded loops, and the provided scene API." });
      }
      const value = vm!.dump(result.value); result.value.dispose();
      return typeof value === "string" ? value : undefined;
    };
    execute(`"use strict"; const __input = JSON.parse(${JSON.stringify(JSON.stringify(input))});
      const __tokens = values => new Proxy(Object.freeze(values), {
        get(target, key) {
          if (typeof key === "string" && key !== "toJSON" && !(key in target)) throw new Error("Unknown palette color token: " + key);
          return Reflect.get(target, key);
        }
      });
      const Color = __tokens(${JSON.stringify(Color)});
      const palette = Object.freeze({ ...__input.palette, colors: __tokens(Object.fromEntries(Object.keys(__input.palette.colors).map(name => [name, name]))) });
      const __buildScene = ${buildScene.toString()};
      const __meshBuilders = Object.freeze({ ...(${createSurfaceBuilders.toString()})(), ...(${createSolidBuilders.toString()})(), ...(${createMoleculeBuilders.toString()})() });
      const __domainFactories = Object.freeze({createCompactQueueBuilders:${createCompactQueueBuilders.toString()},createNucleicTranslationBuilders:${createNucleicTranslationBuilders.toString()},createNucleicTranscriptionCycleBuilders:${createNucleicTranscriptionCycleBuilders.toString()},createNucleicProcessingBuilders:${createNucleicProcessingBuilders.toString()},createPeptideBuilders:${createPeptideBuilders.toString()},createSampledState:${createSampledState.toString()},createAssetBuilders:${createAssetBuilders.toString()},createCoordinateBuilders:${createCoordinateBuilders.toString()},createGraphAlgorithms:${createGraphAlgorithms.toString()},createGraphBuilders:${createGraphBuilders.toString()},createCollectionBuilders:${createCollectionBuilders.toString()},createMolecularBackboneBuilders:${createMolecularBackboneBuilders.toString()},createNucleicBuilders:${createNucleicBuilders.toString()}});
      const scene = (options, builder) => __buildScene(options, builder, __input, update => { globalThis.__animlibUpdate = update; }, __meshBuilders, __domainFactories);
      let __seed = ${JSON.stringify(input.seed ?? 1)} >>> 0;
      Math.random = () => { __seed = (__seed * 1664525 + 1013904223) >>> 0; return __seed / 4294967296; };
      const math = Object.freeze(Math);
      globalThis.Date = undefined;
      globalThis.Promise = undefined;`, "runtime.js");
    // Install the trusted library before starting the authored-code budget.
    // Runtime parsing/setup grew with the domain helpers and can exceed a short
    // scene deadline under CPU contention without executing any authored code.
    deadline = Date.now() + (limits.executionLimitMs ?? 200);
    vm.runtime.setInterruptHandler(() => Date.now() > deadline);
    execute(rewritten, "scene.js");
    const json = execute("JSON.stringify(globalThis.__animlibResult)", "result.js");
    check(json && json.length <= 8 * 1024 * 1024, "Invalid or oversized compiled scene");
    const compiled = JSON.parse(json) as CompiledScene;
    validateCompiledScene(compiled,input.assetCatalog);
    const verifyModel = (g: Geometry) => {
      if (g.kind !== 'model') return;
      const reference = g.model!, metadata = input.models?.[reference.asset];
      check(metadata && JSON.stringify(metadata.primitives[reference.primitive]?.bounds) === JSON.stringify(reference.bounds), 'Model reference is missing or does not match its registered metadata');
    };
    for (const e of [...compiled.initial, ...compiled.lifecycle.flatMap(e => e.elements ?? []), ...compiled.tracks.flatMap(t => Object.values(t.from))]) verifyModel(e.geometry);
    let importedTriangles=0;
    for(const e of [...compiled.initial,...compiled.lifecycle.flatMap(e=>e.elements??[])]) {
      const ref=e.geometry.model;
      if(ref)importedTriangles+=input.models![ref.asset].primitives[ref.primitive].triangles;
    }
    check(importedTriangles<=500000,'Scene imported model budget exceeded (500,000 triangles across instances)');
    for (const t of compiled.tracks) if (t.action.geometry) { check(t.action.geometry.kind !== 'model', 'Model geometry cannot be morphed'); verifyModel(t.action.geometry); }
    enforceScenePalette(compiled, resolver);
    retained = true;
    return {
      scene: compiled,
      update(values, changed, time, duration = compiled.duration) {
        if (!vm) throw new Error('Scene runtime is disposed');
        // Audio preparation can extend the host scene after this worker program
        // was compiled. Clamp against the authoritative duration sent by the host.
        check(Number.isFinite(duration) && duration >= 0 && duration <= 1e6, 'Invalid reactive duration');
        if (time !== undefined) { check(Number.isFinite(time), 'Reactive time must be finite'); time = Math.max(0, Math.min(duration, time)); }
        deadline = Date.now() + (limits.executionLimitMs ?? 200);
        const json = execute(`JSON.stringify(globalThis.__animlibUpdate(JSON.parse(${JSON.stringify(JSON.stringify(values))}), JSON.parse(${JSON.stringify(JSON.stringify(changed))}), ${time === undefined ? "undefined" : time}))`, 'bindings.js');
        check(json && json.length <= 1024 * 1024, 'Invalid or oversized reactive update');
        const updates = JSON.parse(json) as ReactiveUpdate[];
        mergeReactiveUpdates(compiled, updates, changed, time);
        return updates;
      },
      dispose() { vm?.dispose(); vm = undefined; },
    };
  } catch (error) {
    if (error instanceof SceneCompileError) throw error;
    const e = error as Error & { loc?: { line: number; column: number } };
    throw new SceneCompileError({ severity: "error", code: e.loc ? "SYNTAX" : "SCENE_VALIDATION", message: e.message ?? String(error), ...(e.loc ? { line: e.loc.line, column: e.loc.column + 1 } : {}) });
  } finally { if (!retained) vm?.dispose(); }
}

/** Standalone compilation remains serializable; runtime callbacks are disposed. */
export async function compileSource(source: string, input: CompileInput = {}, limits: { executionLimitMs?: number; sampleTime?: number | "end" } = {}): Promise<CompiledScene> {
  const program = await createSceneProgram(source, input, limits);
  try {
    const scene = program.scene;
    const requested = limits.sampleTime === 'end' ? scene.duration : limits.sampleTime ?? 0;
    check(Number.isFinite(requested), 'Sample time must be finite');
    const time = Math.max(0, Math.min(scene.duration, requested));
    if (time === 0 || !scene.reactiveBindings?.some(b => b.time)) return scene;
    const updates = program.update(Object.fromEntries(scene.controls.map(c => [c.id, c.value])), [], time);
    return { ...scene, reactiveBindings: mergeReactiveUpdates(scene, updates, [], time), reactiveTime: time };
  } finally { program.dispose(); }
}
