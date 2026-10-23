import { createSampledState } from './diagrams/sampled-state.js';
import { createNucleicBuilders } from './nucleic-structures.js';
import { createNucleicProcessingBuilders } from './nucleic-processing.js';
import { createNucleicTranscriptionCycleBuilders } from './nucleic-transcription-cycle.js';
import { createNucleicTranslationBuilders } from './nucleic-translation.js';
import { createPeptideBuilders } from './peptide-motion.js';
import type { AnimationAction, CameraState, CompileInput, CompiledScene, ControlDefinition, ControlValue, ElementHandle, ElementProps, ElementState, ElementStyle, Geometry, ReactiveDependency, ReactiveProperties, ReactiveUpdate, SceneContext, SceneOptions, SliderHandle, SliderOptions, Vec2, Vec3, ViewState } from "./types.js";
import { createSurfaceBuilders } from "./surfaces.js";
import { createSolidBuilders } from "./solids.js";
import { createMoleculeBuilders } from './molecules.js';
import { createAssetBuilders } from './asset-builders.js';
import { createMolecularBackboneBuilders } from './molecular-backbone.js';
import { createCoordinateBuilders } from './diagrams/coordinates.js';
import { createGraphAlgorithms, createGraphBuilders } from './diagrams/graphs.js';
import { createCollectionBuilders } from './diagrams/collections.js';
import { createCompactQueueBuilders } from './diagrams/compact-queue.js';

type MeshBuilders = ReturnType<typeof createSurfaceBuilders> & ReturnType<typeof createSolidBuilders> & ReturnType<typeof createMoleculeBuilders>;
type DomainFactories = {createCompactQueueBuilders: typeof createCompactQueueBuilders; createNucleicTranslationBuilders: typeof createNucleicTranslationBuilders; createNucleicTranscriptionCycleBuilders: typeof createNucleicTranscriptionCycleBuilders; createNucleicProcessingBuilders: typeof createNucleicProcessingBuilders; createPeptideBuilders: typeof createPeptideBuilders; createSampledState: typeof createSampledState; createAssetBuilders: typeof createAssetBuilders; createCoordinateBuilders: typeof createCoordinateBuilders; createGraphAlgorithms: typeof createGraphAlgorithms; createGraphBuilders: typeof createGraphBuilders; createCollectionBuilders: typeof createCollectionBuilders; createMolecularBackboneBuilders: typeof createMolecularBackboneBuilders; createNucleicBuilders: typeof createNucleicBuilders};

/** Self-contained on purpose: the function is installed inside QuickJS, never eval'd by the host. */
export function buildScene(options: SceneOptions, builder: (context: SceneContext) => void, input: CompileInput = {}, installReactive?: (update: (values: Record<string, ControlValue>, changed: string[], time?: number) => ReactiveUpdate[]) => void, meshBuilders: MeshBuilders = {...createSurfaceBuilders(), ...createSolidBuilders(), ...createMoleculeBuilders()}, domainFactories: DomainFactories = {createCompactQueueBuilders, createNucleicTranslationBuilders, createNucleicTranscriptionCycleBuilders, createNucleicProcessingBuilders, createPeptideBuilders, createSampledState, createAssetBuilders, createCoordinateBuilders, createGraphAlgorithms, createGraphBuilders, createCollectionBuilders, createMolecularBackboneBuilders, createNucleicBuilders}): CompiledScene {
  const algorithms = domainFactories.createGraphAlgorithms();
  const molecular = domainFactories.createMolecularBackboneBuilders(meshBuilders);
  const nucleic = domainFactories.createNucleicBuilders(molecular);
  const processing = domainFactories.createNucleicProcessingBuilders();
  const transcriptionCycle = domainFactories.createNucleicTranscriptionCycleBuilders();
  const translation = domainFactories.createNucleicTranslationBuilders();
  const peptide = domainFactories.createPeptideBuilders();
  const assets = domainFactories.createAssetBuilders(input.assetCatalog);
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const vector = (value: number[] = [0, 0, 0]): Vec3 => [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
  const rotation = (value: number | number[] = 0): Vec3 => typeof value === "number" ? [0, 0, value] : vector(value);
  const viewport = (value: Vec2): Vec2 => { if(!Array.isArray(value)||value.length!==2)throw new Error("Viewport offset requires two coordinates");return [value[0],value[1]]; };
  const finite = (value: number, label: string) => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e6) throw new Error(`${label} must be a finite number with magnitude <= 1,000,000`);
    return value;
  };
  const numericFormat = (format: Geometry["numberFormat"]): void => {
    if(format===undefined)return;
    if(!format||typeof format!=="object"||Array.isArray(format))throw new Error("Invalid numeric format");
    const decimals=format.decimals===undefined?2:format.decimals,digits=format.digits===undefined?1:format.digits;
    if(!Number.isInteger(decimals)||decimals<0||decimals>4||!Number.isInteger(digits)||digits<1||digits>6)throw new Error("Numeric format requires decimals 0–4 and digits 1–6");
  };
  const idCheck = (id: string) => { if (typeof id !== "string" || !id || id.length > 256 || id.startsWith("@")) throw new Error("IDs must be nonempty strings <=256 characters, without an @ prefix"); };
  const mode = options.mode ?? "2d";
  const defaultCamera: CameraState = { yaw: mode === "3d" ? 0.55 : 0, pitch: mode === "3d" ? 0.35 : 0, target: [0, 0, 0], height: 8, distance: 12, perspective: mode === "3d" ? 1 : 0 };
  const camera = clone(input.previous?.camera ?? defaultCamera);
  let cameraNow = clone(camera);
  const views = new Map<string, ViewState>((input.previous?.views ?? []).map(v => [v.id, { id: v.id, rect: clone(v.rect), camera: clone(v.camera), orbit: v.orbit, ...(v.orbitHitTest ? {orbitHitTest:v.orbitHitTest} : {}) }]));
  const viewCameras = new Map([...views].map(([id, view]) => [id, clone(view.camera)]));
  const declaredViews = new Set<string>();
  let currentView: string | undefined;
  const previousElements = input.previous?.elements ?? [];
  const originalParents = new Map<string, ElementState>();
  for (const e of previousElements) for (const child of e.geometry.children ?? []) originalParents.set(child, e);
  const persistentIds = new Set(previousElements.filter(e => e.persistent).map(e => e.id));
  const rotateVector = (v: Vec3, r: Vec3): Vec3 => {
    let [x,y,z] = v;
    let c=Math.cos(r[0]), sn=Math.sin(r[0]); [y,z]=[y*c-z*sn,y*sn+z*c];
    c=Math.cos(r[1]); sn=Math.sin(r[1]); [x,z]=[x*c+z*sn,-x*sn+z*c];
    c=Math.cos(r[2]); sn=Math.sin(r[2]); return [x*c-y*sn,x*sn+y*c,z];
  };
  const quaternion = ([x,y,z]: Vec3): number[] => {
    const cx=Math.cos(x/2),cy=Math.cos(y/2),cz=Math.cos(z/2),sx=Math.sin(x/2),sy=Math.sin(y/2),sz=Math.sin(z/2);
    return [sx*cy*cz-cx*sy*sz,cx*sy*cz+sx*cy*sz,cx*cy*sz-sx*sy*cz,cx*cy*cz+sx*sy*sz];
  };
  const combineRotation = (parent: Vec3, child: Vec3): Vec3 => {
    const [a,b,c,d]=quaternion(parent),[e,f,g,h]=quaternion(child);
    const x=d*e+a*h+b*g-c*f,y=d*f-a*g+b*h+c*e,z=d*g+a*f-b*e+c*h,w=d*h-a*e-b*f-c*g;
    return [Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y)),Math.asin(Math.max(-1,Math.min(1,2*(w*y-z*x)))),Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))];
  };
  const initial = clone(previousElements.filter(e => e.persistent)).map(e => {
    e.viewportOffset ??= [0,0];
    // Keeping one child does not implicitly keep its siblings. Bake departing
    // ancestors until the next durable ancestor, preserving the child's visual pose.
    let parent = originalParents.get(e.id);
    const visited = new Set<string>();
    while (parent && !parent.persistent) {
      if (visited.has(parent.id)) throw new Error(`Group cycle at ${parent.id}`);
      visited.add(parent.id);
      e.position = rotateVector(e.position.map(v => v*parent!.scale) as Vec3,parent.rotation).map((v,i)=>v+parent!.position[i]) as Vec3;
      e.rotation = combineRotation(parent.rotation,e.rotation);
      e.scale *= parent.scale; e.opacity *= parent.opacity;
      if (parent.castShadow === false) e.castShadow = false;
      if(parent.viewportOffset)e.viewportOffset=[(e.viewportOffset?.[0]??0)+parent.viewportOffset[0],(e.viewportOffset?.[1]??0)+parent.viewportOffset[1]];
      parent = originalParents.get(parent.id);
    }
    if (e.geometry.children) e.geometry.children = e.geometry.children.filter(id => persistentIds.has(id));
    return e;
  });
  const states = new Map(initial.map(e => [e.id, clone(e)]));
  const inherited = new Set(initial.map(e => e.id));
  const used = new Set(states.keys());
  const groups = new Set(initial.flatMap(e => e.geometry.children ?? []));
  const controls: ControlDefinition[] = [];
  const tracks: CompiledScene["tracks"] = [];
  const lifecycle: CompiledScene["lifecycle"] = [];
  const behaviors: NonNullable<CompiledScene["behaviors"]> = [];
  const bindings: NonNullable<CompiledScene["bindings"]> = [];
  const callbacks: { target: string; slot?: number; controls: string[]; dependencies: ReactiveDependency[]; time?: true; callback: (...values: number[]) => ReactiveProperties; keys?: string[] }[] = [];
  const reactiveHandles = new Set<SliderHandle>();
  const elementHandles = new WeakMap<ElementHandle, string>();
  const timeHandle = Object.freeze({ time: true as const, [Symbol.toPrimitive]() { throw new Error("Read s.time through a binding"); } });
  let building = true;
  let cursor = 0;
  let exiting: ElementHandle | undefined;

  const descendants = (id: string, path = new Set<string>()): string[] => {
    if (path.has(id)) throw new Error(`Group cycle at ${id}`);
    const e = states.get(id);
    if (!e) throw new Error(`Element ${id} is missing or was removed`);
    path.add(id);
    const result = [id, ...(e.geometry.children ?? []).flatMap(child => descendants(child, new Set(path)))];
    return [...new Set(result)];
  };

  const validateIds = (ids: readonly string[]): void => {
    const planned = new Set<string>();
    for (const id of ids) {
      idCheck(id);
      if (used.has(id) || planned.has(id)) throw new Error(`Duplicate element ID: ${id}`);
      planned.add(id);
    }
    if (used.size + planned.size > 2000) throw new Error("Scene element limit exceeded (2000)");
  };
  const validateGroup = (children: readonly ElementHandle[], newIds: readonly string[] = []): string[] => {
    const childIds = Array.from(children, child => {
      if (!child || elementHandles.get(child) !== child.id) throw new Error("Groups require handles from this scene");
      return child.id;
    });
    if (new Set(childIds).size !== childIds.length) throw new Error("Duplicate group child handle");
    for (const child of childIds) if (states.get(child)?.view !== currentView) throw new Error("Groups must contain elements from the same view");
    for (const child of childIds) {
      descendants(child);
      if (groups.has(child)) throw new Error(`Element ${child} already has a parent group`);
    }
    validateIds(newIds);
    return childIds;
  };

  const handle = (id: string): ElementHandle => {
    const result: ElementHandle = {
    id,
    animate: properties => {
      const normalized = { ...properties };
      if (properties.position) normalized.position = vector(properties.position);
      if (properties.rotation !== undefined) normalized.rotation = rotation(properties.rotation);
      if (properties.viewportOffset !== undefined) normalized.viewportOffset = viewport(properties.viewportOffset);
      return { ids: [id], type: "animate", properties: normalized as Partial<ElementState> };
    },
    moveTo: position => ({ ids: [id], type: "animate", properties: { position: vector(position) } }),
    rotateTo: value => ({ ids: [id], type: "animate", properties: { rotation: rotation(value) } }),
    scaleTo: scale => ({ ids: [id], type: "animate", properties: { scale } }),
    fadeIn: () => ({ ids: [id], type: "animate", properties: { opacity: 1 }, fromOpacity: 0 }),
    fadeOut: () => ({ ids: [id], type: "animate", properties: { opacity: 0 } }),
    morphTo: (geometry, morphOptions = {}) => { if(geometry.asset || descendants(id).some(id=>states.get(id)?.geometry.asset)) throw new Error('Referenced model assets cannot morph'); numericFormat(geometry.numberFormat);return { ids: [id], type: "morph", geometry: clone(geometry), map: morphOptions.map }; },
    countTo: values => ({ ids: [id], type: "numbers", values: clone(values) }),
    };
    elementHandles.set(result, id);
    return result;
  };

  const add = (kind: Geometry["kind"], id: string, props: ElementProps = {}, internal = false): ElementHandle => {
    if (!internal) validateIds([id]);
    else {
      if (used.has(id)) throw new Error(`Duplicate element ID: ${id}`);
      if (used.size >= 2000) throw new Error("Scene element limit exceeded (2000)");
    }
    used.add(id);
    const { position, rotation: r, scale, opacity, fill, stroke, strokeWidth, strokeProfile, strokeStart, strokeEnd, dashArray, dashOffset, space, castShadow, billboard, billboardOffset, viewportOffset, ...geometry } = props;
    numericFormat(geometry.numberFormat);
    const element: ElementState = {
      id, geometry: { kind, ...clone(geometry) }, position: vector(position), rotation: rotation(r),
      scale: scale ?? 1, opacity: opacity ?? 1, fill: fill === undefined ? (kind === "line" || kind === "arrow" ? "none" : (input.palette?.foreground ?? "WHITE")) : fill,
      stroke: stroke === undefined ? (kind === "line" || kind === "arrow" ? (input.palette?.foreground ?? "WHITE") : "none") : stroke, strokeWidth: strokeWidth ?? (space === "screen" ? 1 : 0.04),
      ...(strokeProfile !== undefined ? { strokeProfile } : {}),
      ...(strokeStart !== undefined ? { strokeStart } : {}),
      ...(strokeEnd !== undefined ? { strokeEnd } : {}),
      ...(dashArray !== undefined ? { dashArray: clone(dashArray) } : {}),
      ...(dashOffset !== undefined ? { dashOffset } : {}),
      ...(castShadow !== undefined ? { castShadow } : {}),
      space: space ?? "world", ...(billboard !== undefined ? { billboard } : {}), ...(billboardOffset !== undefined ? { billboardOffset:vector(billboardOffset) } : {}), viewportOffset: viewportOffset !== undefined ? viewport(viewportOffset) : [0,0], ...(currentView ? { view: currentView } : {}), persistent: false,
    };
    states.set(id, element);
    lifecycle.push({ time: cursor, type: "add", ids: [id], elements: [clone(element)] });
    return handle(id);
  };

  // Constructor callbacks and sampling options stay inside the builder. Only
  // ordinary mesh data and supported style properties cross the VM boundary.
  const generatedMesh = (id: string, geometry: Geometry, props: ElementStyle & Pick<Geometry, "texture" | "material" | "clipPlanes" | "outline">): ElementHandle => {
    const style: ElementStyle = {};
    for (const key of ["position", "rotation", "scale", "opacity", "fill", "stroke", "strokeWidth", "strokeProfile", "space", "castShadow", "billboard", "billboardOffset", "viewportOffset"] as const) {
      if (props[key] !== undefined) Object.assign(style, { [key]: props[key] });
    }
    const { kind: _kind, ...mesh } = geometry;
    return add("mesh", id, { ...mesh, ...style, ...(props.clipPlanes !== undefined ? { clipPlanes: props.clipPlanes } : {}), ...(props.outline !== undefined ? { outline: props.outline } : {}), ...(props.texture !== undefined ? { texture: props.texture } : {}), ...(props.material !== undefined ? { material: props.material } : {}) });
  };

  const control = (id: string, definition: Omit<ControlDefinition, "id" | "label" | "value"> & { label?: string }): ControlValue => {
    idCheck(id);
    if (controls.some(c => c.id === id)) throw new Error(`Duplicate control ID: ${id}`);
    if (controls.length >= 100) throw new Error("Scene control limit exceeded (100)");
    let value = Object.hasOwn(input.controls ?? {}, id) ? input.controls![id] : definition.default;
    if (definition.kind === "slider") {
      const min = finite(definition.min!, "slider min"), max = finite(definition.max!, "slider max");
      const step = definition.step ?? 0.01;
      if (min > max || !(step > 0) || !Number.isFinite(step)) throw new Error(`Invalid bounds or step for slider ${id}`);
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Slider ${id} requires a finite number`);
      value = Math.min(max, Math.max(min, value));
    } else if (definition.kind === "toggle") {
      if (typeof value !== "boolean") throw new Error(`Toggle ${id} requires a boolean`);
    } else if (!definition.options?.includes(String(value))) {
      if (definition.options?.includes(String(definition.default))) value = definition.default;
      else throw new Error(`Select ${id} has an invalid default`);
    }
    controls.push({ ...clone(definition), id, label: definition.label ?? id, value });
    return value;
  };

  const context: SceneContext = {
    view: (id, spec, build) => {
      idCheck(id);
      if (currentView !== undefined) throw new Error("Views cannot be nested");
      if (declaredViews.has(id)) throw new Error(`Duplicate view ID: ${id}`);
      if (declaredViews.size >= 32) throw new Error("Scene view limit exceeded (32)");
      declaredViews.add(id);
      const inheritedCamera = views.get(id)?.camera;
      const viewCamera: CameraState = { yaw: 0.55, pitch: 0.35, target: [0,0,0], height: 8, distance: 12, perspective: 1, ...clone(inheritedCamera ?? {}), ...clone(spec.camera ?? {}) };
      views.delete(id);
      if (spec.orbitHitTest !== undefined && spec.orbitHitTest !== 'geometry') throw new Error('orbitHitTest must be "geometry"');
      views.set(id, { id, rect: clone(spec.rect), orbit: spec.orbit ?? true, camera: viewCamera, ...(spec.orbitHitTest ? {orbitHitTest:spec.orbitHitTest} : {}) });
      viewCameras.set(id, clone(viewCamera));
      currentView = id;
      const { view: _view, ...scoped } = context;
      // A captured view builder must retain its ownership after this callback
      // returns (and when used inside another view). Do not let it add objects to
      // whichever view happens to be active at call time.
      for (const key of Object.keys(scoped)) {
        const value = (scoped as unknown as Record<string, unknown>)[key];
        if (typeof value !== "function") continue;
        (scoped as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
          const priorView = currentView;
          currentView = id;
          try { return value(...args); }
          finally { currentView = priorView; }
        };
      }
      scoped.camera = {
        animate: properties => ({ type: "camera", ids: [], view: id, properties }),
        to3D: properties => ({ type: "camera", ids: [], view: id, properties: { perspective: 1, yaw: 0.55, pitch: 0.35, ...properties } }),
        to2D: properties => ({ type: "camera", ids: [], view: id, properties: { perspective: 0, yaw: 0, pitch: 0, ...properties } }),
      };
      try {
        const result: unknown = build(scoped);
        if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("View builders must be synchronous");
      } finally { currentView = undefined; }
    },
    circle: (id, props) => add("circle", id, { radius: 0.5, ...props }),
    sphere: (id, props) => add("sphere", id, { radius: 0.5, ...props }),
    rectangle: (id, props) => add("rectangle", id, { width: 1, height: 1, ...props }),
    path: (id, props) => add("path", id, props),
    line: (id, props) => add("line", id, { points: [[0, 0], [1, 0]], ...props }),
    arrow: (id, props) => add("arrow", id, { points: [[0, 0], [1, 0]], ...props }),
    line3D: (id, props) => add("line", id, { points: [[0,0,0],[1,0,0]], ...props, strokeProfile: "round" }),
    arrow3D: (id, props) => add("arrow", id, { points: [[0,0,0],[1,0,0]], ...props, strokeProfile: "round" }),
    text: (id, props) => add("text", id, { fontSize: props.space === "screen" ? 16 : 0.4, ...props }),
    latex: (id, props) => add("latex", id, { fontSize: props.space === "screen" ? 24 : 0.6, ...props }),
    mesh: (id, props) => add("mesh", id, props),
    image: (id,props) => generatedMesh(id,assets.image(props),props),
    modelInfo: id => assets.modelInfo(id),
    model: (id, props) => {
      idCheck(id);
      if (!props || typeof props.asset !== 'string') throw new Error('Model requires an asset ID');
      if (props.source !== undefined && props.source !== 'prepared' && props.source !== 'glb') throw new Error('Invalid model source');
      const prepared = input.assetCatalog?.some(asset => asset.kind === 'model' && asset.id === props.asset);
      const metadata = Object.hasOwn(input.models ?? {}, props.asset) ? input.models![props.asset] : undefined;
      if (props.source === undefined && prepared && metadata) throw new Error(`Ambiguous model asset: ${props.asset}. Specify source: 'prepared' or 'glb'.`);
      const modelHandle = (element: ElementHandle) => Object.assign(element, {
        tintTo: (color: import('./types.js').ColorValue): AnimationAction => ({ type: 'animate', ids: descendants(element.id).filter(id => ['mesh', 'model'].includes(states.get(id)!.geometry.kind)), properties: { fill: color } }),
      });
      if (props.source === 'prepared' || props.source === undefined && prepared) {
        if ('tint' in props) throw new Error('Prepared models use fill instead of tint');
        const style = props as import('./asset-types.js').PreparedModelProps;
        const parts = assets.model(style);
        validateIds([id, ...parts.map(part => `${id}.${part.id}`)]);
        const children = parts.map(part => generatedMesh(`${id}.${part.id}`, part.geometry, {
          fill:style.fill,stroke:style.stroke,strokeWidth:style.strokeWidth,strokeProfile:style.strokeProfile,material:style.material,
          texture:style.texture,clipPlanes:style.clipPlanes,outline:style.outline,space:style.space,
        }));
        for (const child of children) groups.add(child.id);
        const root = add('group',id,{children:children.map(child=>child.id),position:style.position,rotation:style.rotation,scale:style.scale,
          opacity:style.opacity,space:style.space,castShadow:style.castShadow,viewportOffset:style.viewportOffset,billboard:style.billboard,billboardOffset:style.billboardOffset});
        return Object.assign(modelHandle(root), { part: (key: string) => {
          const index = parts.findIndex(part => part.id === key);
          if (index < 0) throw new Error(`Unknown model part: ${key}`);
          return modelHandle(children[index]);
        } });
      }
      if (!metadata) throw new Error(`Unknown model asset: ${props.asset}`);
      const { asset, tint, source: _source, ...style } = props as import('./model-types.js').GLBModelProps;
      if (Object.keys(style).some(k => !['position','rotation','scale','opacity','castShadow'].includes(k))) throw new Error('Unsupported model property');
      const handles = new Map<string, ElementHandle>();
      const partId = (part: string) => `${id}/${part}`;
      for (const part of [...metadata.parts].reverse()) {
        const children = part.primitives.map(index => add('model', `${id}/primitive-${index}`, {
          model: { asset, primitive: index, bounds: clone(metadata.primitives[index].bounds) },
          fill: tint ?? 'WHITE', stroke: 'none',
        }));
        children.push(...metadata.parts.filter(p => p.parent === part.id).map(p => handles.get(p.id)!));
        const group = context.group(partId(part.id), children);
        // Group origins preserve imported node pivots. Imported static rotations/scales are baked in host geometry.
        const position = vector(part.position);
        states.get(group.id)!.position = position;
        lifecycle.at(-1)!.elements![0].position = clone(position);
        handles.set(part.id, group);
      }
      const root = context.group(id, metadata.parts.filter(p => !p.parent).map(p => handles.get(p.id)!));
      const state = states.get(id)!;
      if (style.position) state.position = vector(style.position);
      if (style.rotation !== undefined) state.rotation = rotation(style.rotation);
      if (style.scale !== undefined) state.scale = style.scale;
      if (style.opacity !== undefined) state.opacity = style.opacity;
      if (style.castShadow !== undefined) state.castShadow = style.castShadow;
      lifecycle.at(-1)!.elements![0] = clone(state);
      return Object.assign(modelHandle(root), { part: (key: string) => {
        const matches = metadata.parts.filter(p => p.id === key || p.name === key);
        if (matches.length !== 1) throw new Error(`Unknown or ambiguous model part: ${key}. Use its node ID.`);
        return modelHandle(handles.get(matches[0].id)!);
      } });
    },
    surface: (id, props) => generatedMesh(id, meshBuilders!.surface(props), props),
    parametricSurface: (id, props) => generatedMesh(id, meshBuilders!.parametricSurface(props), props),
    box: (id, props = {}) => generatedMesh(id, meshBuilders!.box(props), props),
    cylinder: (id, props = {}) => generatedMesh(id, meshBuilders!.cylinder(props), props),
    cone: (id, props = {}) => generatedMesh(id, meshBuilders!.cone(props), props),
    torus: (id, props = {}) => generatedMesh(id, meshBuilders!.torus(props), props),
    tube: (id, props) => generatedMesh(id, meshBuilders!.tube(props), props),
    molecule: (id, props) => {
      idCheck(id);
      const meshes = meshBuilders!.molecule(props);
      const children = meshes.map((geometry, i) => generatedMesh(`${id}/batch-${i}`, geometry, {
        fill: props.fill, stroke: props.stroke, strokeWidth: props.strokeWidth, strokeProfile: props.strokeProfile, material: props.material, space: props.space,
      }));
      for (const child of children) groups.add(child.id);
      return add('group', id, {children: children.map(child => child.id), position: props.position, rotation: props.rotation,
        scale: props.scale, opacity: props.opacity, space: props.space, castShadow: props.castShadow, viewportOffset: props.viewportOffset});
    },
    molecularBackbone: (id, props) => {
      idCheck(id);
      const children = molecular.molecularBackbone(props).meshes.map((geometry,i)=>generatedMesh(`${id}/batch-${i}`,geometry,{
        fill:props.fill,stroke:props.stroke,strokeWidth:props.strokeWidth,strokeProfile:props.strokeProfile,material:props.material,space:props.space,
      }));
      for(const child of children)groups.add(child.id);
      return add('group',id,{children:children.map(child=>child.id),position:props.position,rotation:props.rotation,scale:props.scale,opacity:props.opacity,space:props.space,castShadow:props.castShadow,viewportOffset:props.viewportOffset});
    },
    nucleicDuplex: (props, opening) => nucleic.nucleicDuplex(props, opening),
    nucleicTranscript: (props, time) => nucleic.nucleicTranscript(props, time),
    nucleicSplice: (props, progress) => processing.nucleicSplice(props, progress),
    nucleicThread: (props, progress) => processing.nucleicThread(props, progress),
    nucleicTranscriptionCycle: (props, time) => transcriptionCycle.nucleicTranscriptionCycle(props, time),
    nucleicTranslationCycle: (props, time) => translation.nucleicTranslationCycle(props, time),
    peptidePose: (spec, phi, psi) => peptide.peptidePose(spec, phi, psi),
    molecularBackboneGeometry: props => molecular.molecularBackbone(props),
    articulatedChainPose: (spec,time) => molecular.articulatedChainPose(spec,time),
    sampledState: options => domainFactories.createSampledState(options),
    plane: (id,options) => domainFactories.createCoordinateBuilders(context).plane(id,options),
    graph: (id,data,options) => domainFactories.createGraphBuilders(context,algorithms).graph(id,data,options),
    collection: (id,items,options) => domainFactories.createCollectionBuilders(context).collection(id,items,options),
    compactQueue: (id,items,options) => domainFactories.createCompactQueueBuilders(context).compactQueue(id,items,options),
    dijkstra: (data,source) => algorithms.dijkstra(data,source),
    behavior: (target, behavior) => {
      descendants(target.id);
      behaviors.push({ target: target.id, behavior: clone(behavior) });
    },
    attach: (target, source, spec = {}) => {
      descendants(target.id); descendants(source.id);
      bindings.push({ type: "attach", target: target.id, source: source.id, ...(spec.anchor !== undefined ? {anchor:spec.anchor} : {}), ...(spec.offset ? { offset: vector(spec.offset) } : {}) });
    },
    connect: (target, from, to, spec = {}) => {
      descendants(target.id); descendants(from.id); descendants(to.id);
      bindings.push({ type: "connect", target: target.id, from: from.id, to: to.id, ...clone(spec) });
    },
    validateGroup: (children, newIds) => { validateGroup(children, newIds); },
    group: (id, children, spec = {}) => {
      const childIds = validateGroup(children, [id]);
      const group = add("group", id, { children: childIds, space: states.get(childIds[0])?.space ?? "world", ...clone(spec) });
      for (const child of childIds) groups.add(child);
      return group;
    },
    play: (actionList, timing) => {
      const duration = finite(timing.duration, "duration");
      if (duration < 0) throw new Error("Animation duration must be nonnegative");
      const actions = Array.isArray(actionList) ? actionList : [actionList];
      const writes = new Set<string>();
      for (const action of actions) {
        if (action.type === "camera" && action.view !== undefined && !viewCameras.has(action.view)) throw new Error(`Unknown camera view: ${action.view}`);
        if(action.type==="morph")numericFormat(action.geometry?.numberFormat);
        if (tracks.length >= 10000) throw new Error("Animation track limit exceeded (10000)");
        const from: Record<string, ElementState> = Object.create(null);
        const properties = action.type === "morph" || action.type === "numbers" ? ["geometry"] : Object.keys(action.properties ?? {});
        for (const id of action.type === "camera" ? [`@camera:${action.view ?? ""}`] : action.ids) {
          for (const property of properties) {
            const key = `${id}/${property}`;
            if (writes.has(key)) throw new Error(`Conflicting animations for ${key} in the same play()`);
            writes.add(key);
          }
          if (action.type !== "camera") {
            const e = states.get(id);
            if (!e) throw new Error(`Element ${id} is missing or was removed`);
            from[id] = clone(e);
            if (action.fromOpacity !== undefined) from[id].opacity = action.fromOpacity;
          }
        }
        tracks.push({ start: cursor, duration, ease: timing.ease ?? "smooth", action: clone(action), from,
          ...(action.type === "camera" ? { cameraFrom: clone(action.view ? viewCameras.get(action.view) : cameraNow) } : {}) });
        if (action.type === "camera") {
          if (action.view) {
            if (!viewCameras.has(action.view)) throw new Error(`Unknown camera view: ${action.view}`);
            viewCameras.set(action.view, { ...viewCameras.get(action.view)!, ...clone(action.properties ?? {}) });
          } else cameraNow = { ...cameraNow, ...clone(action.properties ?? {}) };
        } else for (const id of action.ids) {
          const e = states.get(id)!;
          if (action.type === "morph") {
            if (!action.geometry) throw new Error("Morph needs destination geometry");
            if (e.geometry.kind === "group" || action.geometry.kind === "group") throw new Error("Morph group children individually");
            if ((e.geometry.kind === "latex" || action.geometry.kind === "latex") && !action.map) throw new Error("LaTeX morphs require an explicit map (an empty map fades all parts)");
            e.geometry = clone(action.geometry);
          } else if (action.type === "numbers") {
            if (e.geometry.kind !== "latex" || !e.geometry.numbers) throw new Error("countTo requires LaTeX numeric slots");
            for (const key of Object.keys(action.values ?? {})) if (!Object.hasOwn(e.geometry.numbers,key)) throw new Error(`Unknown numeric slot: ${key}`);
            e.geometry.numbers = { ...e.geometry.numbers, ...clone(action.values ?? {}) };
          } else Object.assign(e, clone(action.properties ?? {}));
        }
      }
      cursor += duration;
      if (cursor > 86400) throw new Error("Scene duration limit exceeded (24 hours)");
    },
    wait: seconds => { finite(seconds, "wait"); if (seconds < 0) throw new Error("Wait must be nonnegative"); cursor += seconds; if (cursor > 86400) throw new Error("Scene duration limit exceeded (24 hours)"); },
    keep: element => {
      const ids = descendants(element.id);
      for (const id of ids) { states.get(id)!.persistent = true; delete states.get(id)!.transient; }
      lifecycle.push({ time: cursor, type: "keep", ids });
    },
    remove: element => {
      const ids = descendants(element.id);
      for (const id of ids) states.delete(id);
      for (const e of states.values()) if (e.geometry.children) e.geometry.children = e.geometry.children.filter(id => !ids.includes(id));
      for (const id of ids) groups.delete(id);
      lifecycle.push({ time: cursor, type: "remove", ids });
    },
    slider: ((id: string, spec: SliderOptions & { reactive?: boolean }) => {
      const value = control(id, { ...spec, kind: "slider" });
      if (!spec.reactive) return value as number;
      const handle: SliderHandle = Object.freeze({ id, reactive: true as const,
        [Symbol.toPrimitive]() { throw new Error('Reactive sliders are handles; use s.bind to read their values'); },
      });
      reactiveHandles.add(handle);
      return handle;
    }) as SceneContext['slider'],
    time: timeHandle,
    bind: (target, dependencies, callback) => {
      descendants(target.id);
      if (!Array.isArray(dependencies) || !dependencies.length || dependencies.length > 100 || dependencies.some(c => c !== timeHandle && !reactiveHandles.has(c as SliderHandle))) throw new Error('s.bind requires reactive slider handles or s.time from this scene');
      if (typeof callback !== 'function' || callbacks.length >= 2000) throw new Error('Invalid or oversized reactive bindings');
      const siblings = callbacks.filter(c => c.target === target.id);
      for (const sibling of siblings) sibling.slot ??= callbacks.indexOf(sibling);
      callbacks.push({ target: target.id, ...(siblings.length ? { slot: callbacks.length } : {}), controls: dependencies.filter((c): c is SliderHandle => c !== timeHandle).map(c => c.id), dependencies: [...dependencies], ...(dependencies.includes(timeHandle) ? { time: true as const } : {}), callback });
    },
    deform: (target, dependencies, callback) => {
      descendants(target.id);
      const geometry = states.get(target.id)!.geometry;
      if(geometry.asset) throw new Error('Referenced model assets cannot deform');
      if (geometry.kind !== 'mesh' || typeof callback !== 'function') throw new Error('s.deform requires a mesh and a callback');
      const rest = geometry.vertices!.map(point => vector(point));
      context.bind(target, dependencies, (...values) => ({ vertices: rest.map((point, index) => {
        const result = callback([...point], index, ...values);
        if (!Array.isArray(result) || result.length !== 3) throw new Error('s.deform callback must return a Vec3');
        return [...result] as Vec3;
      }) }));
    },
    toggle: (id, spec) => control(id, { ...spec, kind: "toggle" }) as boolean,
    select: (id, spec) => control(id, { ...spec, kind: "select" }) as string,
    previous: {
      get: id => { if (!inherited.has(id) || !states.has(id)) throw new Error(`Missing persistent element: ${id}`); return handle(id); },
      exiting: () => {
        if (!building) throw new Error('Scene building APIs cannot be called from reactive bindings');
        if (exiting) return exiting;
        const old = clone(input.previous?.elements.filter(e => !e.persistent && !e.transient) ?? []);
        const ids = new Set(old.map(e => e.id));
        const names = new Map<string, string>();
        for (const e of old) {
          let name = `@exit:${e.id}`, suffix = 1;
          while (used.has(name)) name = `@exit:${e.id}:${suffix++}`;
          names.set(e.id, name); used.add(name);
        }
        for (const e of old) {
          e.id = names.get(e.id)!;
          e.persistent = false; e.transient = true;
          if (e.geometry.children) e.geometry.children = e.geometry.children.filter(id => ids.has(id)).map(id => names.get(id)!);
          states.set(e.id, e); used.add(e.id);
        }
        const allChildren = new Set(old.flatMap(e => e.geometry.children ?? []));
        lifecycle.push({ time: cursor, type: "add", ids: old.map(e => e.id), elements: clone(old) });
        let groupId = "@exiting", suffix = 1;
        while (used.has(groupId)) groupId = `@exiting:${suffix++}`;
        exiting = add("group", groupId, { children: old.filter(e => !allChildren.has(e.id)).map(e => e.id) }, true);
        states.get(groupId)!.transient = true;
        lifecycle[lifecycle.length - 1].elements![0].transient = true;
        return exiting;
      },
    },
    camera: {
      animate: properties => ({ type: "camera", ids: [], properties }),
      to3D: properties => ({ type: "camera", ids: [], properties: { perspective: 1, yaw: 0.55, pitch: 0.35, ...properties } }),
      to2D: properties => ({ type: "camera", ids: [], properties: { perspective: 0, yaw: 0, pitch: 0, ...properties } }),
    },
  };
  // Retained callbacks may calculate property values, but cannot mutate the builder.
  for (const key of Object.keys(context)) {
    const fn = (context as unknown as Record<string, unknown>)[key];
    if (typeof fn === 'function' && !['nucleicTranslationCycle','nucleicTranscriptionCycle','nucleicSplice','nucleicThread','peptidePose','molecularBackboneGeometry','articulatedChainPose','dijkstra','nucleicDuplex','nucleicTranscript'].includes(key)) (context as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
      if (!building) throw new Error('Scene building APIs cannot be called from reactive bindings');
      return fn(...args);
    };
  }
  const returned: unknown = builder(context);
  if (returned && typeof (returned as { then?: unknown }).then === "function") throw new Error("Scene builders must be synchronous");
  building = false;
  // A new object's first opacity animation declares its entrance. Hide it at
  // creation, not just when fadeIn starts, including during earlier waits or
  // movement tracks. Later reappearances must preserve the preceding visibility.
  const births = new Map(lifecycle.flatMap(event => event.type === "add"
    ? (event.elements ?? []).filter(e => !e.transient).map(e => [e.id, e] as const) : []));
  const opacityAnimated = new Set<string>();
  for (const track of tracks) {
    if (track.action.type !== "animate" || !Object.hasOwn(track.action.properties ?? {}, "opacity")) continue;
    for (const id of track.action.ids) {
      if (opacityAnimated.has(id)) continue;
      opacityAnimated.add(id);
      const birth = births.get(id);
      // Leave invalid authored opacity intact for boundary validation.
      if (birth && track.action.fromOpacity === 0 && birth.opacity >= 0 && birth.opacity <= 1) birth.opacity = 0;
    }
  }
  const update = (values: Record<string, ControlValue>, changed: string[], time?: number): ReactiveUpdate[] => callbacks.filter(binding => time !== undefined && binding.time || binding.controls.some(id => changed.includes(id))).map(binding => {
    const output = binding.callback(...binding.dependencies.map(dep => dep === timeHandle ? time ?? 0 : values[(dep as SliderHandle).id] as number));
    if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Reactive bindings must return property objects');
    const keys = Object.keys(output).sort();
    if (!keys.length || keys.some(key => !['radius','position','rotation','scale','opacity','fill','vertices','normals','material','texture','scalarColors','points','strokeStart','strokeEnd','dashOffset'].includes(key))) throw new Error('Unsupported reactive property');
    if (binding.keys && JSON.stringify(keys) !== JSON.stringify(binding.keys)) throw new Error('Reactive bindings must return the same property keys on every update');
    binding.keys ??= keys;
    const properties = { ...output };
    for (const key of ['normals', 'material', 'texture', 'scalarColors'] as const) {
      const value = properties[key];
      if (Object.hasOwn(properties, key) && value !== null && (!value || typeof value !== 'object' || (key === 'normals' ? !Array.isArray(value) : Array.isArray(value)))) throw new Error(`Invalid reactive ${key}`);
    }
    if (properties.position !== undefined) properties.position = vector(properties.position);
    if (properties.rotation !== undefined) properties.rotation = rotation(properties.rotation);
    return { target: binding.target, ...(binding.slot !== undefined ? { slot: binding.slot } : {}), properties: clone(properties) };
  });
  const initialUpdates = update(Object.fromEntries(controls.map(c => [c.id, c.value])), controls.map(c => c.id), 0);
  const reactiveBindings = callbacks.map((binding, i) => ({ target: binding.target, ...(binding.slot !== undefined ? { slot: binding.slot } : {}), controls: binding.controls, ...(binding.time ? { time: true as const } : {}), properties: initialUpdates[i].properties }));
  if (callbacks.length) installReactive?.(update);
  const lighting = options.lighting === undefined ? input.previous?.lighting : options.lighting;
  return { options: { ...(lighting !== undefined ? { lighting: clone(lighting) } : {}), mode, end: options.end ?? "hold", orbit: options.orbit ?? mode === "3d", background: options.background === undefined ? input.palette?.background ?? "BLACK" : options.background, ...(options.audio ? { audio: options.audio } : {}) }, duration: cursor, controls, initial, camera, views: [...views.values()].filter(v => declaredViews.has(v.id) || [...initial, ...lifecycle.flatMap(event => event.elements ?? [])].some(e => e.view === v.id)), lifecycle, tracks, behaviors, bindings, ...(reactiveBindings.length ? { reactiveBindings } : {}), ...(callbacks.some(b => b.time) ? { reactiveTime: 0 } : {}) };
}
