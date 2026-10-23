import type { SampledState, SampledStateOptions } from './diagrams/sampled-state-types.js';
export type * from './diagrams/sampled-state-types.js';
import type { NucleicDuplexProps, NucleicDuplexResult, NucleicTranscriptProps, NucleicTranscriptResult } from './nucleic-types.js';
import type { NucleicSpliceProps, NucleicSpliceResult, NucleicThreadProps, NucleicThreadResult } from './nucleic-processing-types.js';
export type * from './nucleic-processing-types.js';
import type { NucleicTranscriptionCycleProps, NucleicTranscriptionCycleResult } from './nucleic-transcription-cycle-types.js';
export type * from './nucleic-transcription-cycle-types.js';
import type { NucleicTranslationProps, NucleicTranslationResult } from './nucleic-translation-types.js';
export type * from './nucleic-translation-types.js';
import type { PeptideSpec, PeptidePose } from './peptide-types.js';
export type * from './peptide-types.js';
export type * from './nucleic-types.js';
export type * from './molecular-structure-types.js';
import type { ModelAsset, ModelMetadata, ModelProps, ModelHandle, ModelReference } from './model-types.js';
export type * from './model-types.js';
import type { ExplanatoryGeometry, ScalarColors } from "./explanatory-types.js";
import type { AssetGeometryRef, AssetGeometryResolver, AssetRegistry, AssetDescriptor, ModelAssetDescriptor, ImageProps, ImageTexture } from './asset-types.js';
export type * from './asset-types.js';
export type { ClipPlane, MeshOutline, ScalarRamp, ScalarColors, SurfaceScalar, ExplanatoryGeometry } from "./explanatory-types.js";
import type { Color, PaletteColor } from "./palette.js";
import type { SurfaceProps, ParametricSurfaceProps } from "./surface-types.js";
import type { BoxProps, CylinderProps, ConeProps, TorusProps, TubeProps } from "./solid-types.js";
import type { MoleculeProps } from './molecule-types.js';
import type { MolecularBackboneProps, MolecularBackboneResult, ArticulatedChainSpec } from './molecular-backbone-types.js';
import type { PlaneOptions, CoordinatePlane } from './diagrams/coordinate-types.js';
import type { GraphData, GraphOptions, GraphDiagram, SearchTrace } from './diagrams/graph-types.js';
import type { CollectionItem, CollectionOptions, CollectionDiagram } from './diagrams/collection-types.js';
import type { CompactQueueOptions, CompactQueueDiagram } from './diagrams/compact-queue-types.js';
export type * from './diagrams/compact-queue-types.js';
export type * from './molecular-backbone-types.js';
export type * from './diagrams/coordinate-types.js';
export type * from './diagrams/graph-types.js';
export type * from './diagrams/collection-types.js';
export type * from './molecule-types.js';
export type { Color, PaletteColor } from "./palette.js";
export type { SurfaceProps, ParametricSurfaceProps } from "./surface-types.js";
export type { BoxProps, CylinderProps, ConeProps, TorusProps, TubeProps } from "./solid-types.js";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Position = Vec2 | Vec3;
export type Mode = "2d" | "3d";
export type Ease = "linear" | "smooth" | "in" | "out";
export type ControlValue = number | boolean | string;

/** Immutable host-owned palette. Scene code cannot replace or disable it. */
export interface ColorPalette {
  readonly colors: Readonly<Partial<Record<PaletteColor, string>>>;
  readonly background: PaletteColor;
  readonly foreground: PaletteColor;
}

/** A named color, optionally with separate alpha; arbitrary CSS is not accepted. */
export type ColorValue = Color | { readonly color: PaletteColor; readonly opacity: number };

/** Two palette colors mixed by a deterministic, object-space 3D pattern. */
export interface ProceduralTexture {
  pattern: "checker" | "stripes" | "noise" | "marble" | "wood";
  /** Secondary color; the element fill is the primary color. */
  color: ColorValue;
  /** Pattern coordinates = local position * scale + offset. Default 1. */
  scale?: number | Vec3;
  offset?: Vec3;
  /** Integer 0–65535, default 0. Varies noise, marble, and wood. */
  seed?: number;
  /** Signed bump height in local units, -1–1; default 0. Changes lighting only. */
  bumpStrength?: number;
}

/** Stylized surface lighting; omitted keeps the original directional shading. */
export interface Material {
  /** 0–1, default 0. Metals tint reflections with the fill. */
  metalness?: number;
  /** 0.05–1, default 0.45. Larger values broaden and soften highlights. */
  roughness?: number;
  /** Nonmetal base highlight strength, 0–1, default 0.5. */
  specular?: number;
  /** Adds surface color; no bloom or illumination of neighboring objects. */
  emissive?: ColorValue;
  /** 0–4, default 1. Emissive color alpha also scales the emission. */
  emissiveIntensity?: number;
}

export interface Geometry extends ExplanatoryGeometry {
  /** Static host-owned mesh; inline vertices/indices/normals are mutually exclusive. */
  asset?: AssetGeometryRef;
  /** Text/LaTeX: default depth tests glyphs; other modes act on the whole label anchor. */
  labelOcclusion?: "depth" | "overlay" | "hide" | "fade";
  kind: "circle" | "sphere" | "rectangle" | "path" | "line" | "arrow" | "text" | "latex" | "mesh" | "group" | "model";
  model?: ModelReference;
  radius?: number;
  width?: number;
  height?: number;
  points?: Position[];
  closed?: boolean;
  /** SVG path data in local XY coordinates (positive Y up); Z closes each contour. */
  d?: string;
  /** Smooth Catmull–Rom interpolation through path points; omitted means straight edges. */
  curve?: "linear" | "smooth";
  text?: string;
  tex?: string;
  fontSize?: number;
  vertices?: Position[];
  triangles?: [number, number, number][];
  scalarColors?: ScalarColors;
  /** Mesh lighting; omitted preserves unlit rendering. Smooth normals share vertex indices. */
  shading?: "unlit" | "flat" | "smooth";
  /** Optional per-vertex local normals for smooth mesh shading; normalized when rendered. */
  normals?: Vec3[];
  uv0?: Vec2[];
  imageTexture?: ImageTexture;
  /** Procedural fill on meshes and spheres only. */
  texture?: ProceduralTexture;
  /** Configurable lighting on spheres and meshes. */
  material?: Material;
  children?: string[];
  /** Composite this group's children before applying its opacity. */
  isolated?: boolean;
  /** Named LaTeX part whose center is the element's origin. */
  anchor?: string;
  /** Values rendered in fixed-width \\animnum{name} LaTeX slots. */
  numbers?: Record<string, number>;
  numberFormat?: { decimals?: number; digits?: number };
}

export interface PathStrokeStyle {
  /** Normalized cumulative local arc length. Start >= end hides the stroke, not fill. */
  strokeStart?: number;
  strokeEnd?: number;
  /** Positive local lengths, alternating painted and unpainted; odd arrays repeat. */
  dashArray?: number[];
  /** Signed local distance into the dash pattern. */
  dashOffset?: number;
}
export interface ElementStyle extends PathStrokeStyle {
  position?: Position;
  rotation?: Position | number;
  scale?: number;
  opacity?: number;
  fill?: ColorValue;
  stroke?: ColorValue;
  strokeWidth?: number;
  /** Round world-space tubes instead of flat stroke ribbons. Not animated. */
  strokeProfile?: "flat" | "round";
  space?: "world" | "screen";
  /** false excludes this element (or group descendants) from planar shadows. Not animated. */
  castShadow?: boolean;
  billboard?: boolean;
  billboardOffset?: Position;
  /** Camera-independent translation in fractions of the viewport width/height. */
  viewportOffset?: Vec2;
}

export type ElementProps = Omit<Geometry, "kind"> & ElementStyle;
export interface ElementState extends PathStrokeStyle {
  id: string;
  geometry: Geometry;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  opacity: number;
  fill: ColorValue;
  stroke: ColorValue;
  strokeWidth: number;
  strokeProfile?: "flat" | "round";
  space: "world" | "screen";
  /** false excludes this element (or group descendants) from planar shadows. Not animated. */
  castShadow?: boolean;
  billboard?: boolean;
  billboardOffset?: Vec3;
  viewportOffset?: Vec2;
  /** Region owning this element; omitted for the main scene. */
  view?: string;
  persistent: boolean;
  transient?: boolean;
  morph?: { from: Geometry; to: Geometry; progress: number; map?: Record<string, string> };
}

export interface ControlPlacement {
  /** Top-left corner, in fractions of the canvas width/height. */
  position?: Vec2;
  /** Widget width in CSS pixels; defaults to 220. */
  width?: number;
}

export interface ViewOptions {
  /** [left, top, width, height], in fractions of the canvas size. */
  rect: [number, number, number, number];
  camera?: Partial<CameraState>;
  orbit?: boolean;
  /** Restrict orbit starts to pickable model surfaces; standalone text is ignored. */
  orbitHitTest?: "geometry";
}

export interface ViewState {
  id: string;
  rect: [number, number, number, number];
  camera: CameraState;
  orbit: boolean;
  orbitHitTest?: "geometry";
}

export interface CameraFocus {
  /** Optical distance along the camera forward axis, in world units (0.01–1e6). */
  distance:number;
  /** Lens radius in world units (0–1000). Zero preserves exact pinhole output. */
  aperture:number;
  /** Deterministic disk samples, default 16. Fixed during an animated focus change. */
  samples?:8|16|32;
}

export interface CameraState {
  yaw: number;
  pitch: number;
  target: Vec3;
  height: number;
  distance: number;
  perspective: number;
  /** Optical focus. Omit or set aperture=0 for the exact pinhole rendering path. */
  focus?: CameraFocus;
}

/** White scene lights. Intensities multiply the legacy studio contributions. */
export interface SceneLighting {
  /** 0–4, default 1. */
  ambient?: number;
  directional?: {
    /** Direction TOWARD the light; normalized. Default [-0.4, 0.65, 1]. */
    direction?: Vec3;
    /** Default camera: +X right, +Y up, +Z toward viewer. */
    space?: "world" | "camera";
    /** 0–4, default 1. */
    intensity?: number;
    /** Projects opaque caster silhouettes onto receiver, without self-shadowing. */
    shadow?: {
      /** Angular disk radius in radians, 0–0.25; default 0.04. */
      softness?: number;
      /** 1, 7, or 13 deterministic directions; default medium (7). */
      quality?: "low" | "medium" | "high";
      /** Receiver offset in world units, 0–0.05; default 0.002. */
      bias?: number;
      /** 0–1, default 0.35. Occlusion of direct light at full coverage. */
      opacity?: number;
    };
  };
  /** Finite horizontal XZ plane shared by scene views; receives shadows only. */
  receiver?: {
    /** Center in world units, default [0,-1,0]. */
    position?: Vec3;
    /** Width (X), depth (Z), both positive world units. */
    size: Vec2;
    /** Opaque palette token, default GREY_D. */
    fill?: PaletteColor;
  };
}

export interface SceneOptions {
  mode?: Mode;
  end?: "hold" | "advance";
  audio?: string;
  orbit?: boolean;
  background?: PaletteColor;
  /** Omitted inherits across handoffs; "studio" resets to the original lighting. */
  lighting?: SceneLighting | "studio";
}

export interface AnimationAction {
  ids: string[];
  type: "animate" | "morph" | "camera" | "numbers";
  properties?: Partial<ElementState> | Partial<CameraState>;
  geometry?: Geometry;
  map?: Record<string, string>;
  /** Camera region; omitted for the main scene camera. */
  view?: string;
  fromOpacity?: number;
  values?: Record<string, number>;
}

export interface Track {
  start: number;
  duration: number;
  ease: Ease;
  action: AnimationAction;
  from: Record<string, ElementState>;
  cameraFrom?: CameraState;
}

export interface ControlDefinition extends ControlPlacement {
  id: string;
  label: string;
  kind: "slider" | "toggle" | "select";
  value: ControlValue;
  default: ControlValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Opt-in runtime input; its value is consumed by s.bind callbacks. */
  reactive?: boolean;
}

export interface SliderHandle { readonly id: string; readonly reactive: true }
export interface SliderOptions extends ControlPlacement {
  label?: string; default: number; min: number; max: number; step?: number;
}
/** Scene-local seconds, clamped to the timeline; read only through a binding. */
export interface TimeHandle { readonly time: true }
export type ReactiveDependency = SliderHandle | TimeHandle;
/** Absolute property replacements. Mesh connectivity is never writable. */
export type ReactiveProperties = Pick<ElementStyle, 'position' | 'rotation' | 'scale' | 'opacity' | 'fill' | 'strokeStart' | 'strokeEnd' | 'dashOffset'> & Pick<Geometry, 'radius' | 'vertices' | 'points'> & {
  /** Null (or vertices without normals) recomputes shading normals. */
  normals?: Vec3[] | null;
  /** Whole-object replacements; null restores the original untextured/simple appearance. */
  material?: Material | null;
  texture?: ProceduralTexture | null;
  scalarColors?: ScalarColors | null;
};
export interface ReactiveBinding {
  target: string;
  /** Distinguishes disjoint bindings on one target; absent for a single binding. */
  slot?: number;
  controls: string[];
  time?: true;
  properties: ReactiveProperties;
}
export interface ReactiveUpdate { target: string; slot?: number; properties: ReactiveProperties }

export interface Lifecycle {
  time: number;
  type: "add" | "remove" | "keep";
  ids: string[];
  elements?: ElementState[];
}

export interface CompiledScene {
  options: Required<Omit<SceneOptions, "audio" | "lighting">> & { audio?: string; lighting?: SceneLighting | "studio"; palette?: ColorPalette };
  duration: number;
  controls: ControlDefinition[];
  initial: ElementState[];
  camera: CameraState;
  views?: ViewState[];
  lifecycle: Lifecycle[];
  tracks: Track[];
  behaviors?: BehaviorDeclaration[];
  bindings?: BindingDeclaration[];
  /** Serializable outputs; callback functions stay in the sandbox runtime. */
  reactiveBindings?: ReactiveBinding[];
  /** Time represented by retained callback outputs; absent for control-only scenes. */
  reactiveTime?: number;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type BehaviorSpec =
  | { type: "drag"; plane?: "screen" | "xy" | "xz" | "yz"; axis?: "x" | "y" | "z";
      /** World-space limits on the target origin during a gesture; choose a fixed plane or axis. */
      bounds?: { min: Vec3; max: Vec3 };
      /** Ordered world-space polyline on the selected fixed plane. Mutually exclusive with bounds/axis. */
      path?: { points: Vec3[]; closed?: boolean } }
  | { type: "spring"; stiffness?: number; damping?: number }
  | { type: "custom"; name: string; options?: JsonValue };
export interface BehaviorDeclaration { target: string; behavior: BehaviorSpec; }
export type BindingDeclaration =
  | { type: "attach"; target: string; source: string; anchor?: 'origin' | 'midpoint'; offset?: Vec3 }
  | { type: "connect"; target: string; from: string; to: string; endpoints?: "center" | "surface" | "bounds"; offset?: number };
export interface Ray { origin: Vec3; direction: Vec3; }
export interface InteractionSnapshot {
  /** Detached copy of the displayed frame and effective view camera. */
  frame: Frame; camera: CameraState; width: number; height: number;
  rect: [number, number, number, number];
}
export interface BehaviorInput {
  type: "start" | "move" | "end" | "cancel" | "key";
  ray?: Ray; normal?: Vec3; key?: string;
}
export interface BehaviorContext {
  readonly time: number;
  readonly dt: number;
  readonly held: boolean;
  readonly authored: Readonly<ElementState>;
  /** Mutable presentation copy. Changes never modify the authored timeline. */
  readonly element: ElementState;
  readonly frame: Frame;
  worldPosition(): Vec3;
  authoredWorldPosition(): Vec3;
  /** Retains a local position offset relative to the moving authored target. */
  setWorldPosition(position: Vec3): void;
}
export interface Behavior {
  /** Return true while another presentation frame is needed, including when paused. */
  update?(context: BehaviorContext): boolean | void;
  /** Return true from start to capture this gesture. */
  input?(event: BehaviorInput, context: BehaviorContext): boolean | void;
  dispose?(): void;
}
export type BehaviorFactory = (options: JsonValue | undefined) => Behavior;

export interface Frame {
  lighting?: SceneLighting | "studio";
  elements: ElementState[];
  camera: CameraState;
  cameraAnimated: boolean;
  views?: (ViewState & { cameraAnimated: boolean })[];
}

/** Axis-aligned bounds in CSS pixels, with X rightwards and Y downwards. */
export interface Bounds2D { left: number; top: number; right: number; bottom: number; }
/** Axis-aligned bounds in local/world units or camera coordinates. */
export interface Bounds3D { min: Vec3; max: Vec3; }
export interface BoundsOptions {
  assetGeometry?: AssetGeometryResolver;
  /** Optional tessellation viewport; defaults to 800 × 450 CSS pixels. */
  width?: number;
  height?: number;
  /** Override the element's authored view camera (also affects billboards). */
  camera?: CameraState;
  palette?: ColorPalette;
  /** Include zero-opacity paint and ancestors for layout. Default false. */
  includeInvisible?: boolean;
  /** Include painted strokes and arrowheads. Default true. */
  includeStroke?: boolean;
}
export interface ScreenBoundsOptions extends BoundsOptions {
  /** Full canvas CSS dimensions; view bounds are translated into canvas coordinates. */
  width: number;
  height: number;
  /** Clip to the view rectangle and canvas. Camera near/far clipping always applies. Default true. */
  clip?: boolean;
}
export type PlayerBoundsOptions = Omit<BoundsOptions, 'width' | 'height' | 'camera' | 'palette'> & {
  /** Defaults to screen. Screen bounds use pixels relative to the selected view's top-left. */
  space?: 'local' | 'world' | 'camera' | 'screen';
  clip?: boolean;
};
/** Canvas CSS pixels, with x increasing rightwards and y increasing downwards. */
export interface OverlapBounds extends Bounds2D {}
export type OverlapSeverity = "unacceptable";
export interface OverlapDiagnostic {
  /** Distinct text/LaTeX element IDs, sorted lexically for stable pair identity. */
  elements: [string, string];
  /** Only text-against-text collisions are reported. */
  severity: OverlapSeverity;
  kind: "text-overlap";
  /** Bounding box of actual intersections, not just intersecting element boxes. */
  bounds: OverlapBounds;
  elementBounds: [OverlapBounds, OverlapBounds];
  /** A point inside an actual glyph intersection, suitable for a debug marker. */
  witness: Vec2;
}
export interface OverlapOptions {
  assetGeometry?: AssetGeometryResolver;
  /** Logical canvas size in CSS pixels. Required: projection depends on aspect ratio. */
  width: number;
  height: number;
  palette?: ColorPalette;
  /** Skip primitives below this effective alpha, including groups and morph fades. Default 0.01. */
  minOpacity?: number;
  /** Intentional overlaps. Group IDs apply to all their descendants; order is irrelevant. */
  ignorePairs?: readonly (readonly [string, string])[];
}
export interface SceneOverlapOptions extends OverlapOptions {
  /** Include text affected by active tracks, groups, bindings, or cameras. Default false. */
  includeAnimating?: boolean;
  /** Explicit local sample times; sorted/deduplicated. Overrides sampleRate. */
  times?: readonly number[];
  /** Samples per second, default 10. Includes endpoints, lifecycle events and track boundaries. */
  sampleRate?: number;
}
export interface SceneOverlapSample {
  time: number;
  overlaps: OverlapDiagnostic[];
}

export interface ElementHandle {
  readonly id: string;
  animate(properties: Omit<ElementStyle, "space" | "billboard" | "billboardOffset" | "strokeProfile" | "castShadow" | "dashArray">): AnimationAction;
  moveTo(position: Position): AnimationAction;
  rotateTo(rotation: Position | number): AnimationAction;
  scaleTo(scale: number): AnimationAction;
  /** New elements start hidden when this is their first scheduled opacity animation. */
  fadeIn(): AnimationAction;
  fadeOut(): AnimationAction;
  morphTo(geometry: Geometry, options?: { map?: Record<string, string> }): AnimationAction;
  countTo(values: Record<string, number>): AnimationAction;
}

export interface SceneContext {
  modelInfo(asset: string): ModelAssetDescriptor;
  image(id: string, props: ImageProps): ElementHandle;
  circle(id: string, props?: ElementProps): ElementHandle;
  sphere(id: string, props?: ElementProps): ElementHandle;
  rectangle(id: string, props?: ElementProps): ElementHandle;
  path(id: string, props: ElementProps): ElementHandle;
  line(id: string, props: ElementProps): ElementHandle;
  arrow(id: string, props: ElementProps): ElementHandle;
  line3D(id: string, props: ElementProps): ElementHandle;
  arrow3D(id: string, props: ElementProps): ElementHandle;
  text(id: string, props: ElementProps): ElementHandle;
  latex(id: string, props: ElementProps): ElementHandle;
  mesh(id: string, props: ElementProps): ElementHandle;
  /** Resolve either model inventory; duplicate asset IDs require an explicit source. */
  model(id: string, props: ModelProps): ModelHandle;
  /** Sample z = fn(x, y) into a shaded triangle mesh. */
  surface(id: string, props: SurfaceProps): ElementHandle;
  /** Sample a two-parameter map into a shaded triangle mesh. */
  parametricSurface(id: string, props: ParametricSurfaceProps): ElementHandle;
  box(id: string, props?: BoxProps): ElementHandle;
  cylinder(id: string, props?: CylinderProps): ElementHandle;
  cone(id: string, props?: ConeProps): ElementHandle;
  torus(id: string, props?: TorusProps): ElementHandle;
  tube(id: string, props: TubeProps): ElementHandle;
  molecule(id: string, props: MoleculeProps): ElementHandle;
  molecularBackbone(id: string, props: MolecularBackboneProps): ElementHandle;
  nucleicDuplex(props: NucleicDuplexProps, opening: number): NucleicDuplexResult;
  nucleicTranscript(props: NucleicTranscriptProps, time: number): NucleicTranscriptResult;
  nucleicSplice(props: NucleicSpliceProps, progress: number): NucleicSpliceResult;
  nucleicThread(props: NucleicThreadProps, progress: number): NucleicThreadResult;
  nucleicTranscriptionCycle(props: NucleicTranscriptionCycleProps, time: number): NucleicTranscriptionCycleResult;
  nucleicTranslationCycle(props: NucleicTranslationProps, time: number): NucleicTranslationResult;
  peptidePose(spec: PeptideSpec, phi: number[], psi: number[]): PeptidePose;
  molecularBackboneGeometry(props: MolecularBackboneProps): MolecularBackboneResult;
  articulatedChainPose(spec: ArticulatedChainSpec, time: number): Vec3[];
  sampledState(options: SampledStateOptions): SampledState;
  plane(id: string, options: PlaneOptions): CoordinatePlane;
  graph(id: string, data: GraphData, options?: GraphOptions): GraphDiagram;
  dijkstra(data: GraphData, source: string): SearchTrace;
  collection(id: string, items: readonly CollectionItem[], options?: CollectionOptions): CollectionDiagram;
  compactQueue(id: string, items: readonly CollectionItem[], options?: CompactQueueOptions): CompactQueueDiagram;
  /** Read-only preflight of local, same-view, unparented, distinct children and optional planned element IDs/budget. Reserves nothing. */
  validateGroup(children: readonly ElementHandle[], newIds?: readonly string[]): void;
  group(id: string, children: ElementHandle[], options?: { isolated?: boolean; castShadow?: boolean }): ElementHandle;
  behavior(target: ElementHandle, behavior: BehaviorSpec): void;
  attach(target: ElementHandle, source: ElementHandle, options?: { anchor?: 'origin' | 'midpoint'; offset?: Position }): void;
  connect(target: ElementHandle, from: ElementHandle, to: ElementHandle, options?: { endpoints?: "center" | "surface" | "bounds"; offset?: number }): void;
  play(actions: AnimationAction | AnimationAction[], options: { duration: number; ease?: Ease }): void;
  wait(seconds: number): void;
  keep(element: ElementHandle): void;
  remove(element: ElementHandle): void;
  view(id: string, options: ViewOptions, builder: (context: ViewContext) => void): void;
  slider(id: string, options: SliderOptions & { reactive: true }): SliderHandle;
  slider(id: string, options: SliderOptions & { reactive?: false }): number;
  readonly time: TimeHandle;
  bind(target: ElementHandle, dependencies: ReactiveDependency[], callback: (...values: number[]) => ReactiveProperties): void;
  /** Deform captured rest vertices without changing triangle indices. */
  deform(target: ElementHandle, dependencies: ReactiveDependency[], callback: (point: Vec3, index: number, ...values: number[]) => Vec3): void;
  toggle(id: string, options: ControlPlacement & { label?: string; default: boolean }): boolean;
  select(id: string, options: ControlPlacement & { label?: string; default: string; options: string[] }): string;
  previous: { get(id: string): ElementHandle; exiting(): ElementHandle };
  camera: {
    animate(properties: Partial<CameraState>): AnimationAction;
    to3D(properties?: Partial<CameraState>): AnimationAction;
    to2D(properties?: Partial<CameraState>): AnimationAction;
  };
}

export type ViewContext = Omit<SceneContext, "view">;

export interface SceneSource {
  id: string;
  source: string;
  /** Omitted: previous scene. Null: independent scene. ID: an earlier scene's end. */
  handoffFrom?: string | null;
  /** Host-owned audio asset binding, independent of IDs used by generated source. */
  audioId?: string;
}
export type Submission =
  | { type: "load"; scenes: SceneSource[] }
  | { type: "replace"; scene: string; source: string }
  | { type: "insert"; after: string | null; scenes: SceneSource[] };

export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  scene?: string;
  line?: number;
  column?: number;
  hint?: string;
}
export type SubmitResult =
  | { ok: true; revision: number; diagnostics: Diagnostic[] }
  | { ok: false; revision: number; diagnostics: Diagnostic[] };

export interface PlayerState {
  revision: number;
  scene: string | null;
  time: number;
  duration: number;
  status: "empty" | "paused" | "playing" | "ended" | "blocked";
  scenes: { id: string; duration: number }[];
  controls: ControlDefinition[];
  orbitEnabled: boolean;
  views: { id: string; rect: ViewState["rect"]; orbitEnabled: boolean }[];
  error?: string;
}

export interface CompileInput {
  /** Descriptor-only catalog; no bytes or resolver capabilities enter the VM. */
  assetCatalog?: AssetDescriptor[];
  models?: Record<string, ModelMetadata>;
  /** Defaults to THREE_BLUE_ONE_BROWN_PALETTE. */
  palette?: ColorPalette;
  previous?: Frame;
  controls?: Record<string, ControlValue>;
  seed?: number;
}

export type Asset = { kind: "audio"; url: string } | ModelAsset;
export interface PlayerOptions {
  /** Host-owned static models; existing audio assets remain independent. */
  modelAssets?: AssetRegistry;
  /** Defaults to THREE_BLUE_ONE_BROWN_PALETTE; applies to every scene. */
  palette?: ColorPalette;
  /** Player owns the drawing surface until disposal. Mount it in an unmanaged host
   * when using a UI framework: backend recovery may replace this element. */
  canvas: HTMLCanvasElement;
  /** Called when recovery replaces a context-locked canvas with a fresh surface. */
  onCanvasChange?: (canvas: HTMLCanvasElement) => void;
  /** Explicit opt-in to DOM controls. The default player only owns its canvas. */
  controlsRoot?: HTMLElement | false;
  /** Host-registered implementations for declarative custom behaviors. */
  behaviors?: Record<string, BehaviorFactory>;
  assets?: Record<string, Asset>;
  seed?: number;
  executionLimitMs?: number;
}
