# animlib reference

For the purpose and core requirements, see the [README](../README.md).

For domain coverage, current visual direction, reusable fixture provenance and
current independent proof decisions, see the [expansion index](expansion-index.md).

For planning, start with [capabilities](capabilities.md). For implementation,
use the [general animation recipes](#general-animation-recipes) and
[molecular and biological recipes](#molecular-and-biological-animation-recipes)
below, then follow their detailed API links. Fences marked `js scene` are
standalone executable examples; fences marked `ts host` run outside scene code
and declare their required inputs.

For deposited coordinate import and `s.molecule` batched display beads, see
[Molecular coordinates](molecules.md). Parsing and smooth density-envelope
generation are host-side; scene source uses compact coordinates or finished meshes.

A framework-free TypeScript library for code-authored, realtime GPU animations
on a canvas.
Scenes are written in ordinary JavaScript. Each scene builds a local, seekable
timeline using sequential animation instructions. A framework-free player handles
playback, scene navigation, persistent objects, interaction, live code submissions,
and one optional audio track per scene.

**Status: working initial implementation.** Scenes, live submissions, deterministic
seeking, persistence, morphing, native controls, 2D/3D camera transitions, and
per-scene audio are implemented. The API is new and may evolve. The document starts
with the gist and examples, then specifies behavior and implementation limits.

Rendering prefers **WebGPU**, with automatic **WebGL2** fallback for both 2D and
3D scenes when WebGPU initialization is unavailable or fails. Both backends share
tessellation, colors, draw ordering and camera evaluation. If neither works, the
player reports both failure reasons. WebGPU requires a secure context, normally
HTTPS or localhost; WebGL2 does not require disabling browser security settings. See the [WebGPU specification](https://gpuweb.github.io/gpuweb/).

Use Node.js 22.16 or newer for development. From the repository root:

```sh
npm install
npm run dev          # fullscreen demo at http://localhost:5173
npm run typecheck
npm test
npm run build        # library JS/types and the backend preview bundle
npm run demo:build   # bundled static demo in shared/animlib/dist/demo
npm --workspace animlib run test:gpu  # optional native WebGPU/Dawn checks
```

The demo has a black fullscreen canvas, mostly white drawing, selective color
accents, native scene controls, and a bottom progress bar and play/pause control. Its three scenes
demonstrate linear algebra, a molecule becoming 3D, and bubble sort. The demo's
scrubber maps sequence progress to `{ scene, time }`; scenes retain separate clocks.

The package lives in `shared/animlib` and is a local npm workspace named
`animlib`. Build before importing
`createPlayer` from `"animlib"` elsewhere in this project. It has not been published.
For Bun and Node consumers, `animlib/core` exports `compileSource`, `evaluateScene`,
`SceneSequence`, and the public types without loading the browser renderer.
See the [shared evaluation example](../README.md#shared-scene-evaluation).

## 1. The gist

```js
export default scene({ mode: "2d", end: "hold" }, s => {
  const scale = s.slider("scale", {
    label: "Scale",
    default: 1,
    min: 0.5,
    max: 3,
    step: 0.1,
  });

  const dot = s.circle("main-shape", {
    position: [-2, 0],
    radius: scale / 2,
    fill: Color.BLUE,
  });

  s.play(dot.fadeIn(), { duration: 0.5 });
  s.play(dot.moveTo([2, 0]), { duration: 1 });
  s.wait(0.5);
  s.play(dot.morphTo({ kind: "rectangle", width: scale, height: scale }), {
    duration: 1,
  });

  s.keep(dot);
});
```

The scene builder runs to **describe** the animation. Its `play` calls do not wait
for wall-clock time, and are not promises. The player evaluates the resulting
timeline at the requested scene time. Pausing and seeking therefore use the same
animation description as normal playback.

There is one authoring style: sequential `play(...)` and `wait(...)`. Multiple
animations in a single `play` run together. Explicit timestamps stay internal.

The application demos cover linear algebra, organic chemistry, and
computer algorithms. Matrices, molecules, arrays, and graphs belong to application
stories, with built-in helpers for coordinate planes, molecular backbones, graphs,
and identity-based collections. These use the same shapes, text, paths, meshes,
and groups as hand-authored scenes. See [domain helpers and prepared assets](#domain-helpers-and-prepared-assets)
for the APIs and host/scene boundary.

### Decisions from the interview

- Each scene has its own clock and chooses whether to hold or advance at its end.
- Persistence is explicit. Only objects marked to persist become durable objects
  across scene boundaries.
- Direct navigation reconstructs incoming state from preceding scenes.
- The **incoming scene** owns boundary animations, including removing previous
  objects, introducing new ones, and morphing carried objects.
- Successful edits to the running scene restart it at time zero, preserving
  slider values and viewer rotation unless the restart crosses an authored rotation.
- Seeking uses current control values, without replaying historical input.
- Scene code chooses how elements and the camera transition between 2D and 3D.
- Viewer rotation is disabled while an authored camera animation owns the camera.
- Compatible curved paths interpolate authored control points; other compatible
  single outlines use automatic point matching for morphs.
- LaTeX morphs use explicit part mappings; unmatched parts fade in or out.
- The host submits LLM-generated JavaScript through an API supporting initial
  loading, scene replacement, and scene insertion.
- Each source defines one scene. The host can submit multiple sources together.
- Generated code gets animlib and approved math helpers, without direct access
  to the surrounding webpage or network.
- Internal dependencies are allowed; the public API has no framework dependency.
- Modern desktop browsers are the initial target.
- A scene can have one audio track.

**Canvas-only by default:** `createPlayer({ canvas })` renders and handles input on
the canvas without creating surrounding DOM. Native sliders, toggles and selects
require an explicit `controlsRoot: overlayElement`. Omit it (or pass `false`) to
read definitions from player state and update values through `setControl` yourself.
This changes the previous automatic-parent-overlay default; pass
`controlsRoot: canvas.parentElement` to retain that UI. Object interaction is
declared with behaviors, and the player owns pointer capture and frame scheduling.
Open the demo at `http://localhost:5173/?interactive` for positioned controls and
two independently rotatable 3D views.
Open `/behaviors.html` for a canvas-only drag/spring/binding/compositing example.

## 2. The host interface

### Color palettes

Scene colors use the enum-like `Color` API exported by `animlib` and
`animlib/core`. Fills, strokes, animation targets, and backgrounds accept named
palette tokens. TypeScript rejects arbitrary strings; the scene compiler and
renderer enforce the same rule for JavaScript callers. Raw hex, RGB, HSL, and CSS
names are invalid even when their RGB value happens to match a palette swatch.
Invalid submissions return diagnostics and preserve the last valid sequence.

```js
export default scene({ background: Color.BLACK }, s => {
  const dot = s.circle("dot", { fill: Color.BLUE, stroke: Color.NONE });
  s.play(dot.animate({ fill: Color.RED }), { duration: 1 });
  s.line("axis", {
    points: [[-3, 0], [3, 0]],
    stroke: { color: Color.GREY_B, opacity: 0.4 },
  });
});
```

`Color.BLUE` is the literal token `"BLUE"`, so string literal tokens are also
accepted. `Color.NONE` is `"none"`. A `ColorValue` is a token or
`{ color: PaletteColor, opacity: number }`, with opacity from 0 to 1.
`ElementStyle`, `ElementState`, and animated styles use this type; backgrounds
require an opaque `PaletteColor` token. Element `opacity`, `fadeIn`, and `fadeOut`
remain available. Scene code gets frozen `Color` and `palette` objects, with
`palette.colors.BLUE` also returning the token `"BLUE"`. Unknown members produce
an error instead of silently selecting the default color.

The default `THREE_BLUE_ONE_BROWN_PALETTE` uses the full set of swatches and median
aliases from [3Blue1Brown's Manim configuration](https://github.com/3b1b/manim/blob/master/manimlib/default_config.yml)
and [constants](https://github.com/3b1b/manim/blob/master/manimlib/constants.py).
It has a black background and white foreground, following his
[video configuration](https://github.com/3b1b/videos/blob/master/custom_config.yml)
and Manim's default object color. `Color.PURE_BLUE` selects pure blue;
`Color.BLUE` selects the usual Manim blue.

The host can supply a custom palette mapping the same typed slots to other colors:

```ts
import { Color, createPlayer, type ColorPalette } from "animlib";

const palette: ColorPalette = {
  colors: { BLACK: "#222222", WHITE: "#dddddd", BLUE: "#58c4dd" },
  background: Color.WHITE,
  foreground: Color.BLACK,
};
const player = createPlayer({ canvas, palette });
// Headless equivalents:
// new SceneSequence({ palette });
// await compileSource(source, { palette, previous, controls, seed: 1 });
```

Custom palettes are immutable host configuration. They must define at least one
`Color` slot, with opaque CSS values, plus background and foreground tokens present
in that palette. Colors are required to exist in the active palette: this example
rejects `Color.RED` because it has no RED slot. CSS values are only accepted in
host palette definitions. Scene code cannot replace or disable the host palette.

Compiled scenes, evaluated frames, and JSON handoffs retain typed tokens, so
inherited elements resolve against the receiving palette. Color animations select
intermediate palette swatches by Oklab distance while interpolating alpha
continuously. This internal interpolation does not allow invalid authored colors.
The renderer resolves tokens to RGB at the drawing boundary for every view.

Enforcement applies to base drawing colors. Lighting, opacity blending,
antialiasing, procedural textures, emissive surfaces, and morph crossfades still
produce intermediate pixel colors;
this is not a posterization filter. Backgrounds remain opaque. Native DOM controls
and surrounding application CSS are outside the scene palette.

### Player API

The host owns the page, the editor or LLM connection, and asset loading. Animlib
owns the animation player. The submitted code does not receive the player itself.

```ts
import { createPlayer } from "animlib";

const player = createPlayer({
  canvas,
  controlsRoot: overlayElement,
  assets: {
    "intro-voice": { kind: "audio", url: "/audio/intro.mp3" },
  },
});

// A single submission API handles all source changes.
const result = await player.submit({
  type: "load",
  scenes: [
    { id: "intro", source: introSource },
    { id: "explanation", source: explanationSource },
  ],
});

if (!result.ok) {
  showDiagnostics(result.diagnostics);
}

await player.play();
player.pause();
await player.seek({ scene: "explanation", time: 1.5 });

await player.submit({
  type: "replace",
  scene: "explanation",
  source: revisedExplanationSource,
});

await player.submit({
  type: "insert",
  after: "intro",
  scenes: [{ id: "interlude", source: interludeSource }],
});
```

`setSceneBarriers(ids)` replaces the host's set of scene ends that must hold, even
when authored with `end: "advance"`. At a barrier the final frame remains visible
with status `ended`, and `play()` cannot restart it. Clearing a barrier does not
resume automatically; the host can seek to the newly prepared scene and play when
appropriate. Explicit seeks and navigation remain available while waiting.

The host assigns stable scene IDs. Source code supplies the scene's options and
builder, without duplicating its host-assigned ID. Element and control IDs are
specified inside scene code. The host can read `player.canvas` after recovery and
observe replacements through `onCanvasChange`. `player.backend` reports the active
backend after initialization. `registerAssets` adds audio and model assets for
progressive lessons; `unlockAudio` lets a host unlock audio during a user gesture.
`setDisplayPalette` remaps the existing palette slots for rendering and controls
without recompiling or changing authored scene state. It must retain all slot names from
the original palette. `resetView` clears live navigation and behavior offsets.
Navigation, camera snapshots, projection and rays are described under
[canvas navigation](#canvas-navigation-and-camera-access).

### TypeScript surface

These are representative public types. The complete types are in
[src/types.ts](../src/types.ts), with generated declarations under `dist/` after a build.

```ts
type SceneId = string;

type SceneSource = {
  id: SceneId;
  source: string;
  // Default: adjacent predecessor. Null: independent start. ID: earlier scene's end.
  handoffFrom?: SceneId | null;
  // Optional host binding that overrides the source's audio asset ID.
  audioId?: string;
};

type Submission =
  | { type: "load"; scenes: SceneSource[] }
  | { type: "replace"; scene: SceneId; source: string }
  | { type: "insert"; after: SceneId | null; scenes: SceneSource[] };

type Diagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  scene?: SceneId;
  line?: number;
  column?: number;
  hint?: string;
};

type SubmitResult =
  | { ok: true; revision: number; diagnostics: Diagnostic[] }
  | { ok: false; revision: number; diagnostics: Diagnostic[] };

type PlayerState = {
  revision: number;
  scene: SceneId | null;
  time: number;
  duration: number;
  status: "empty" | "paused" | "playing" | "ended" | "blocked";
  scenes: { id: SceneId; duration: number }[];
  error?: string;
  controls: ControlDefinition[];
  orbitEnabled: boolean;
  views: { id: string; rect: [number, number, number, number]; orbitEnabled: boolean }[];
};

interface Player {
  submit(change: Submission): Promise<SubmitResult>;
  play(): Promise<void>;
  pause(): void;
  setSceneBarriers(ids: SceneId[]): void;
  seek(position: { scene: SceneId; time: number }): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  setControl(change: {
    scene: SceneId;
    id: string;
    value: number | boolean | string;
  }): Promise<void>;
  readonly canvas: HTMLCanvasElement; // Current surface; recovery can replace it.
  readonly backend: 'webgpu' | 'webgl2' | undefined;
  setMuted(muted: boolean): void;
  registerAssets(assets: Record<string, Asset>): void;
  unlockAudio(): Promise<void>;
  setDisplayPalette(palette: ColorPalette): void;
  resetView(): void;
  setNavigationMode(mode: 'orbit' | 'pan'): void;
  getPan(view?: string): Vec3;
  setPan(value: Vec3, view?: string): void;
  getInteractionSnapshot(view?: string): InteractionSnapshot | undefined;
  project(point: Vec3, view?: string):
    { x: number; y: number; depth: number; visible: boolean; scale: number } | undefined;
  ray(x: number, y: number, view?: string): Ray | undefined;
  getBounds(id: string, options?: PlayerBoundsOptions): Bounds2D | Bounds3D | undefined;
  /** Coalesced redraw on the next animation frame, also while paused. */
  invalidateFrame(): void;
  getState(): PlayerState;
  subscribe(listener: (state: PlayerState) => void): () => void;
  dispose(): void;
}
```

Defaults:

- `load` replaces the sequence and opens its first scene, paused at zero.
- `insert` with `after: null` prepends scenes. Otherwise it inserts after the named
  scene, without changing existing IDs.
- `seek`, `next`, and `previous` are asynchronous because reconstruction and asset
  preparation may be required. Manual navigation pauses at its destination.
- Seek time is clamped to the destination scene's duration. Seeking to a scene's
  end displays its final state; it does not trigger automatic advancement.
- `end: "advance"` takes effect when forward playback reaches the end. The last
  scene holds even if it requests advancement.
- `subscribe` returns an unsubscribe function; `dispose` releases player-owned
  rendering, audio, interaction, and runtime resources.

## 3. Writing a scene

### Source format

A source is a JavaScript module with one default-exported scene definition:

```js
export default scene(
  { mode: "2d", end: "advance", audio: "intro-voice" },
  s => {
    const heading = s.text("heading", {
      text: "A vector changes direction",
      position: [0, 2],
      fontSize: 0.4,
    });

    s.play(heading.fadeIn(), { duration: 0.4 });
    s.wait(1);
    s.keep(heading);
  },
);
```

The execution environment provides `scene`, `Color`, `palette`, and `math`/`Math`.
`math` is the frozen standard JavaScript `Math` object, with seeded randomness;
it is not a symbolic algebra or vector/matrix package.
Application helpers can be ordinary functions declared in the submitted source.
Host-side helper registration is not yet exposed. Arbitrary imports are not part
of the source contract.

Builders are synchronous and describe a finite animation. Ordinary variables,
loops, conditionals, and helper functions are supported. There are no sleeps,
timers, DOM operations, network requests, or per-frame mutation loops in scene code.

Scene options are `mode: '2d' | '3d'`, `end: 'hold' | 'advance'`, an optional
registered `audio` ID, `orbit`, a palette-token `background`, and `lighting`
(`'studio'` or the lighting object documented below). Set `orbit: false` explicitly
when viewer rotation is unwanted; 3D mode otherwise enables whole-scene orbit by
default. The application may impose stricter controls/orbit rules than the library.

### Local timing

The cursor starts at zero. A `play` occupies a duration and advances the cursor by
that duration. A `wait` advances it without changing object properties.

```js
s.play(dot.fadeIn(), { duration: 0.5 });
s.play([dot.moveTo([1, 0]), label.fadeOut()], {
  duration: 1,
  ease: "smooth",
});
s.wait(0.5);
```

This describes fade-in at `0–0.5`, simultaneous movement and fade-out at
`0.5–1.5`, and a hold at `1.5–2`. All animations in one `play` share its duration
and easing. Initially, nested scheduling and different per-animation start times
are unnecessary public concepts.

Durations must be finite and nonnegative. Conflicting writes to the same property
in one `play` produce a diagnostic. Two animations may affect different properties
of the same object in parallel.

Object creation is recorded at the current cursor. When a new element's first
scheduled opacity animation is `fadeIn()`, it starts hidden from creation until
that fade begins, even if other animations or waits come first. This also applies
to groups: their children inherit the group's hidden state. No explicit
`opacity: 0` is needed for these entrances. A zero-duration `fadeIn()` reveals the
element instantly at its scheduled time.

Elements without a fade-in entrance retain their authored opacity (default `1`).
An earlier opacity animation, such as `fadeOut()`, preserves the preceding
visibility; a later `fadeIn()` is a reappearance. Elements carried over from a
previous scene also retain their initial visibility. Each `fadeIn()` animates
from zero to one at its scheduled cursor. Other animation starting values come
from the object's evaluated state at the start of the interval. Scene-builder
calls never draw intermediate frames.

### Elements and coordinates

Basic creation methods are `circle`, `sphere`, `rectangle`, `line`, `arrow`,
`path`, `text`, `latex`, `mesh`, and `group`. For spatial geometry, use
`surface`, `parametricSurface`, `box`, `cylinder`, `cone`, `torus`, `tube`,
`line3D`, and `arrow3D`. `molecule` batches supplied coordinates into display
beads, and `model` instantiates a host-registered static GLB with named parts.
All take stable IDs. Groups supply parent transforms and operate on their children
together. Surface callbacks run during scene compilation and produce plain mesh data.

### Shaded meshes

`s.mesh(id, { vertices, triangles, shading?, normals?, texture?, material?, ...style })` accepts local
positions and zero-based triangle index triples. Omitted `shading` preserves the
existing unlit appearance. Choose `"flat"` for a normal per triangle or `"smooth"`
for area-weighted normals averaged at shared vertex indices. Duplicate positions
with different indices remain separate at hard edges. Optional `normals` supply
one finite, nonzero local `Vec3` per vertex for smooth shading; the renderer
normalizes them. Flat shading ignores supplied normals. Use consistent triangle
winding when computing smooth normals.

```js
s.mesh('facet', {
  vertices: [[-1, 0, 0], [1, 0, 0], [0, 1, 0.7]],
  triangles: [[0, 1, 2]],
  shading: 'flat', fill: Color.BLUE, stroke: Color.NONE,
});
```

Flat and smooth meshes use the same simple directional lighting as spheres and
round 3D strokes on both WebGPU and WebGL2. They support element/group transforms,
independent views, depth testing, opacity, and palette colors. The fixed studio
light remains the default; scene lighting below can override it. Optional textures
and materials are described below.
Prefer opaque bodies when surfaces intersect;
triangle transparency sorting does not solve every intersection. Ordinary 2D
fills and raw meshes without a shading option retain their existing appearance.

`vertices`, `triangles`, `shading`, `normals`, `texture`, and `material` are
geometry, while `fill`,
`stroke`, `strokeWidth`, `position`, `rotation`, `scale`, and `opacity` are element
style/transform properties. The surface and solid helpers below return ordinary
mesh element handles; their sampled callbacks and construction parameters are not
retained as animatable properties. Move, rotate, scale, group, fade, and keep these
handles like other elements. A mesh morph still needs corresponding vertices and
compatible topology. Morphs without authored normals recompute lighting from the
intermediate geometry. If either endpoint supplies normals, normalized endpoint
normals interpolate instead; the missing endpoint is derived from its geometry.
Exactly opposite normals use a finite fallback at their ambiguous midpoint.
Nonuniform changes of shape can use fixed-topology `s.deform` or vertex bindings below.

### Scene lighting and planar shadows

```js
export default scene({
  mode: '3d',
  lighting: {
    ambient: 1,
    directional: {
      direction: [-0.7, 1, 0.5], space: 'world', intensity: 1,
      shadow: { softness: 0.08, quality: 'medium', bias: 0.002, opacity: 0.75 },
    },
    receiver: { position: [0, -1, 0], size: [9, 7], fill: 'GREY_C' },
  },
}, s => {
  s.play(s.camera.to3D({yaw: 0.5, pitch: -0.55}), {duration: 0});
  s.sphere('ball', {radius: 1, fill: 'GOLD', material: {metalness: 0.6}});
  s.box('noncaster', {position: [2, 0, 0], castShadow: false, fill: 'BLUE'});
  s.wait(1);
});
```

Omitting lighting in an initial scene preserves the original studio appearance,
including material reflections and unlit surfaces. `lighting: {}` uses the same
defaults. Across a handoff, omitted lighting inherits the previous frame's settings;
`lighting: 'studio'` explicitly resets lights and removes the receiver. A supplied
object replaces the complete lighting configuration. Options are ordinary bounded,
serializable data; no functions, device resources or accumulated sampling state.
They are constant within a compiled scene. Ordinary controls can rebuild them
(see [the lighting study](../demo/lighting.ts)); light properties are not timeline
animation or reactive binding targets.

- `ambient` and `directional.intensity`: white-light multipliers from `0` to `4`,
  each defaulting to `1`. Simple shading is `0.32 * ambient + 0.68 * intensity *
  max(dot(normal, light), 0)`. Materials scale diffuse/specular and studio reflection
  contributions coherently; emission remains independent. Unlit geometry is unchanged.
- `directional.direction`: nonzero XYZ vector **toward the light**, normalized by
  the renderer; default `[-0.4, 0.65, 1]`. `space: 'camera'` (default) uses screen-right,
  screen-up, and toward-viewer axes. `space: 'world'` fixes XYZ in world coordinates.
  Effective authored cameras and interactive orbit are applied separately per view.
- `receiver`: finite, opaque, lit, horizontal XZ plane. `position` is its center in
  world units (default `[0,-1,0]`), `size` is `[widthX, depthZ]`, each in `(0,10000]`.
  `fill` is an opaque palette token (default `GREY_D`) resolved through the host palette.
  The plane appears in the main view and each clipped regional view. It is decorative,
  not a pickable element; it cannot be transformed or kept independently of lighting.
- `directional.shadow`: opt-in and requires a receiver. `softness` is an angular
  disk radius in radians, `0`–`0.25`, default `0.04`. Penumbra grows with caster height.
  `quality` is `'low'`, `'medium'` (default), or `'high'`: 1, 7, or 13 fixed directions.
  Zero softness always uses 1 direction. This is a bounded stylized soft shadow;
  discrete bands can be visible at wide softness, especially at low quality.
- `bias`: `0`–`0.05` world units, default `0.002`; lifts the projected mask above
  the receiver to avoid coplanar depth fighting. Keep it small relative to objects;
  excessive bias detaches contacts. Casters are clipped against the original plane,
  and projected silhouettes are clipped to its finite bounds.
- `opacity`: `0`–`1`, default `0.35`, controls occlusion of the receiver's directional
  contribution. Ambient remains, including under bright lighting: the receiver's
  coverage is accumulated independently of albedo, then lit before final output
  saturation. The receiver and its masks resolve as one opaque layer before unrelated translucent surfaces or isolated
  groups, so those surfaces never receive the floor's shadows. Every sample forms
  an opaque silhouette union before
  opacity is applied, so overlapping triangles/casters do not multiply darkness.
  Sample coverage is averaged with normalized full-coverage opacity at every quality,
  including on dark receiver colors.

Only opaque world-space **mesh, sphere, and imported-model fills** cast, including generated solids
and surfaces, final morphed/deformed triangles, and group transforms. Alpha-masked
model primitives do not cast. Unlit meshes
can still cast. Strokes, labels, billboards, screen objects, viewport-offset geometry,
translucent fills/textures and members of translucent isolated groups do not cast.
`castShadow: false` on an element or `s.group(id, children, {castShadow: false})`
disables casting for its descendants; it is a static
style flag. Fading geometry stops casting as soon as effective alpha is below 1.
The system does not approximate colored transmission or partial transparent shadows.

These are **planar projected shadows**, not a shadow-map system: no self-shadowing,
object-to-object shadows, arbitrary mesh receivers, point/spot lights, or environment
maps. Geometry below the receiver does not cast onto its top. Directions at/below
its horizon (`worldLight.y <= 0.001`) produce no shadow; soft samples below that
threshold contribute no occlusion. Shadow calculation consumes the actual final
packed geometry separately for each view, without changing scene state. Play/pause,
seek and handoff repeat the same projection. WebGPU and WebGL2 share geometry and
sample settings; edge antialiasing can differ slightly.

The optional shadow pass costs up to 13 projections of eligible triangles and
isolated compositing passes per view, plus one opaque receiver composite. Shadow
projection is bypassed without a shadow setting; no receiver work runs without a
receiver. WebGPU vertex-buffer growth is capped at the actual device limit. A frame
whose packed upload exceeds that limit reports a recoverable scene error before
allocation/submission, retaining the last good image; reduce mesh density, shadow
quality, or view count and retry. A successful smaller frame clears this scene error
so the public player can play again; backend failures still require backend recovery.
No shadow samples are silently dropped to fit.
Use medium quality and modest caster counts for interactive scenes.

### Procedural textures and materials

Spheres and meshes (including every surface, solid, and tube helper) accept
`texture` and `material` geometry options. Both backends evaluate textures per
fragment: a two-triangle sheet can display detailed patterns without a denser
mesh. No UV maps, downloads, images, or callbacks are needed.

```js
export default scene({ mode: '3d', orbit: true }, s => {
  const roughness = s.slider('roughness', {
    label: 'Roughness', default: 0.25, min: 0.05, max: 1,
  });
  s.sphere('gold', {
    radius: 1, position: [-1.6, 0, 0], fill: Color.GOLD,
    material: { metalness: 1, roughness },
  });
  s.box('marble', {
    position: [1.6, 0, 0], fill: Color.BLUE_A,
    texture: {
      pattern: 'marble', color: Color.BLUE_E,
      scale: [2, 3, 2], offset: [0.25, 0.25, 0.25], seed: 17, bumpStrength: 0.08,
    },
    material: { roughness, specular: 0.6 },
  });
  s.wait(1);
});
```

`ProceduralTexture` is exported as a TypeScript type from both package entry points:

- `pattern` (required): `'checker'`, `'stripes'`, `'noise'`, `'marble'`, or `'wood'`.
  Checker alternates 3D cells; stripes run across local X; noise combines three
  independently filtered scales of 3D value noise with subtle color variation;
  marble distorts X bands with noise; wood distorts rings around
  local Y. These are stylized color patterns, not simulated physical materials.
- `color` (required): the secondary `ColorValue`. The element's `fill` supplies
  the primary color. Both accept palette tokens or `{ color, opacity }`.
- `scale`: positive scalar or three positive components, default `1`.
  Each component must be at most `1000`. Larger values give finer patterns;
  checker cells and stripe bands are `1 / scale` local units wide.
- `offset`: three finite components within ±1,000,000, default `[0, 0, 0]`.
  Pattern coordinates are `localPosition * scale + offset`. Use a fractional
  offset when a flat sheet coincides with a checker boundary; at a boundary the
  antialiasing filter blends the neighboring colors.
- `seed`: integer `0`–`65535`, default `0`. Varies noise, marble, and wood;
  checker and stripes ignore it. Independent of the scene's random seed.
- `bumpStrength`: signed height in local scene units, from `-1` to `1`, default
  `0`. Perturbs the lighting normal using the filtered pattern as a height field.
  For noise, height uses weaker, finer detail independently of the broad color
  variation. Other patterns raise the secondary-color regions. Negative values
  invert the relief. Start around `0.02`–`0.15`, reducing strength for finer scales.
  Use matching fill and texture colors for
  relief without color variation. Requires sphere lighting or flat/smooth mesh
  shading; works with both simple lighting and configurable materials.

Bump mapping changes diffuse lighting and metallic/specular highlights, not
vertices, silhouettes, picking, or shadows. It follows object/group transforms;
bump height scales with the object. Grazing or degenerate projections retain
the base normal. Fine patterns use the same approximate filtering as their color,
and very strong/high-frequency bump can alias. There is no tangent-space normal
image or displacement geometry.

Patterns follow element/group translation, rotation, and uniform scale. They use
local XYZ, not surface UV parameters or distance along a tube. Rebuilding or
morphing vertex positions resamples the pattern at the new local positions.
Very fine patterns fade toward their average using approximate pixel-footprint
filtering; extreme scale/coordinate values can lose floating-point detail.

`Material` is also exported from both entry points:

- `metalness`: `0`–`1`, default `0`. Metals reduce diffuse color and tint
  reflections with the textured fill. Use `1` with `GOLD`, a brown/copper palette
  slot, or `GREY_A` for gold, copper, or silver-like finishes.
- `roughness`: `0.05`–`1`, default `0.45`. Low values give tight highlights;
  high values broaden and soften them.
- `specular`: `0`–`1`, default `0.5`. Controls the base highlight strength of
  nonmetals; metallic reflectance comes from the fill and `metalness`.
- `emissive`: a palette `ColorValue`, default no emission. Adds surface color
  independently of the lighting. Its optional color opacity scales emission.
- `emissiveIntensity`: `0`–`4`, default `1`. Multiplies the emissive color;
  `0` disables emission. Bright values saturate the output. Emission keeps the
  fill/texture alpha; it neither creates a halo nor lights neighboring objects.

Omitting `material` preserves the original simple directional shading. Supplying
`material: {}` enables the configurable model with the defaults above. Spheres
are lit automatically; raw meshes need `shading: 'flat'` or `'smooth'` for
metalness, roughness, and specular to affect them. Unlit meshes still show the
texture and emission. Helpers already supply lit shading.

Both colors are validated against the host palette, including morph targets and
inherited geometry. Lighting and pattern interpolation can produce intermediate
pixel colors. Textures/materials affect fills only; outlines keep their own style.
`fill: Color.NONE` hides the filled surface. If either texture color is translucent,
the entire mesh uses the existing transparent-triangle sorting path; intersecting
transparent triangles retain its limitations. Picking uses geometry rather than pattern transparency. Overlap inspection
remains limited to text/LaTeX relationships.

Use `s.bind(meshOrSphere, [control], value => ({ material: { roughness: value } }))`
to replace material parameters without rebuilding geometry. `texture` works the
same way; return `null` to remove either setting. These are whole-object
replacements, not nested merges, and are not `animate` properties. Ordinary
controls can still rebuild them together with dependent labels. Settings persist with kept geometry and JSON frames. Compatible
mesh/sphere morphs use the source settings at progress zero and target settings
for the interior and endpoint; settings do not interpolate. Keep identical
settings for a continuous finish, or crossfade separate objects deliberately.

The material model uses the renderer's camera-relative directional light and a
procedural studio reflection approximation. It does not reflect other scene
objects. Scene lighting can override its ambient and directional contributions. Procedural materials do not provide environment maps, video textures,
image normal/bump maps, displacement, physically based material guarantees, or bloom.
Try the **Textures** study in `/spatial.html` for pattern, palette,
frequency, seed, bump strength, metalness, roughness, highlight, and emission controls.

### Function and parametric surfaces

`s.surface(id, { fn: (x, y) => z, xRange?, yRange?, xSegments?, ySegments?,
shading?, ...style })` samples the graph **z = f(x, y)** in local XYZ coordinates.
Both ranges default to `[-2, 2]`; both segment counts default to `32`.

```js
const amplitude = s.slider('amplitude', {
  label: 'Amplitude', default: 0.6, min: 0, max: 1.2, step: 0.05,
});
s.surface('wave', {
  fn: (x, y) => amplitude * Math.sin(2 * x) * Math.cos(2 * y),
  xRange: [-2, 2], yRange: [-2, 2],
  xSegments: 32, ySegments: 32, fill: Color.TEAL,
});
s.wait(3);
```

Use this inside a `scene({ mode: '3d', orbit: true }, s => { ... })` builder,
or create the surface in an `s.view` callback. This ordinary numeric slider
recompiles the sampled geometry at the current playback time, including while
paused. Derive dependent labels from the same value and keep duration stable.
Use `s.deform` below for retained changes to existing vertices. Segment counts,
connectivity, holes, surface sampling callbacks, solid construction parameters, and
tube centerline sampling still require reconstruction. An ordinary control is
also needed if a size change updates text.

`s.parametricSurface(id, { fn: (u, v) => [x, y, z], uRange?, vRange?,
uSegments?, vSegments?, closedU?, closedV?, shading?, ...style })` supports shapes
that are not single-valued height graphs. Both parameter ranges default to `[0, 1]`,
segment counts to `32`, and closure flags to `false`. A closed axis shares seam
indices and does not sample its duplicate upper endpoint. Set a closure flag only
when the map is periodic across that axis; it joins the seam but adds no caps.

For example, a five-lobed flower cup with real depth can be authored as one
parametric surface, with a tube stem as a separate grouped part:

```js
const flower = s.parametricSurface('flower', {
  uRange: [0, 2 * Math.PI], vRange: [0.08, 1],
  uSegments: 64, vSegments: 24, closedU: true,
  fn: (u, v) => {
    const r = v * (1 + 0.28 * Math.cos(5 * u));
    return [r * Math.cos(u), 0.7 * v * v, r * Math.sin(u)];
  },
  fill: Color.PURPLE,
});
const stem = s.tube('stem', {
  points: [[0, -1.6, 0], [0.12, -0.8, 0], [0, 0, 0]],
  radius: 0.06, fill: Color.GREEN,
});
s.group('plant', [flower, stem]);
```

Both helpers default to smooth shading and `stroke: Color.NONE`; override shading
with `"flat"` or `"unlit"` when appropriate. A nonzero stroke draws triangle edges,
including diagonals, rather than only parameter-grid lines. Sample separate paths
if the lesson needs specific coordinate curves. Drawing every triangle edge adds
substantial geometry and CPU work; keep dense surfaces stroke-free by default.

Callbacks must be synchronous and deterministic. Returning `NaN` or `Infinity`
omits that sample and every adjacent grid cell, creating a hole rather than a
bridge across an undefined domain. Returning the wrong type or throwing is an
error. Degenerate triangles are omitted. Holes and collapsed poles can change
topology, so do not assume two sampled surfaces are morph-compatible.

Ranges must contain two finite, strictly increasing endpoints within ±1,000,000.
Finite sampled coordinates have the same bound. Segment counts are integers from
1 to 20,000, or from 3 on a closed axis, subject to a **20,000 vertex and 20,000
triangle budget per surface** checked before sampling. An open grid uses
`(uSegments + 1) * (vSegments + 1)` samples and up to
`2 * uSegments * vSegments` triangles; a closed axis omits its extra endpoint.
The default open 32-by-32 grid has 1,089 vertices and at most 2,048 triangles.
Holes do not allow a larger requested grid. Start with modest segment counts:
doubling both counts roughly quadruples compilation and drawing work, and an
ordinary slider resamples on each accepted change. Keep callbacks cheap and use
transforms for rigid motion. Per-mesh limits are ceilings, not performance targets;
the scene's aggregate geometry and sandbox execution budgets also apply.

### Basic solids and swept tubes

Each helper accepts the ordinary element style/transform options plus
`shading: 'unlit' | 'flat' | 'smooth'`. All default to no stroke and smooth shading,
except `box`, which defaults to flat shading. Parameters below describe geometry
in local scene units; use `position` and `rotation` to place the resulting mesh.

- `s.box(id, { width?, height?, depth?, ...style })`: dimensions default to `1`.
  The box is centered at the origin, with width along X, height along Y, and depth
  along Z. Face vertices are separate, preserving hard edges even in smooth mode.
- `s.cylinder(id, { radius?, height?, radialSegments?, capped?, ...style })`:
  defaults are radius `1`, height `2`, radial segments `32`, and `capped: true`.
  The axis is Y, with ends at `-height / 2` and `height / 2`.
- `s.cone(id, { radius?, height?, radialSegments?, capped?, ...style })`: the same
  defaults, with a base at `-height / 2` and tip at `height / 2`. `capped` closes
  the base. Cylinder/cone caps use separate vertices to keep their rims sharp.
- `s.torus(id, { radius?, tubeRadius?, radialSegments?, tubularSegments?,
  ...style })`: defaults are `1`, `0.25`, `32`, and `12`, respectively. The ring
  lies in XZ around the Y axis, centered at the origin. `radius` measures to the
  tube center, not its outside edge; `tubeRadius` must be smaller than `radius`.
  Radial segments run around the major ring; tubular segments run around each
  cross-section. Both seams share indices.
- `s.tube(id, { points, radius?, radialSegments?, capped?, closed?, ...style })`:
  `points` is a required `Vec3[]` centerline. Defaults are radius `0.1`, radial
  segments `12`, `capped: true`, and `closed: false`. Radius is constant. Closed
  tubes join the last point to the first and ignore caps.

```js
s.box('block', { width: 1.2, height: 0.8, depth: 0.6, fill: Color.BLUE });
s.cylinder('column', { radius: 0.4, height: 1.8, position: [2, 0, 0], fill: Color.TEAL });
s.cone('tip', { radius: 0.4, height: 0.8, position: [2, 1.3, 0], fill: Color.TEAL });
s.torus('ring', { radius: 0.8, tubeRadius: 0.15, position: [-2, 0, 0], fill: Color.GOLD });
```

Tubes sweep circular rings along the supplied polyline; they do not interpolate a
Catmull–Rom curve. Sample a smooth centerline yourself when needed. Parallel
transport carries the cross-section orientation along bends, with distributed
twist correction for closed loops. Consecutive duplicate points within `1e-10`
scene units are removed, including a repeated closing endpoint. At least two
points must remain for an open tube, or three for a closed one. Exact or near
U-turns are rejected because the joint tangent is ambiguous. There is no collision
or self-intersection repair: use gentle bends and a radius small relative to the
centerline's curvature and spacing. End caps retain sharp rims.

Dimensions and radii must be finite and strictly positive, at most 1,000,000.
Input points and generated vertex coordinates must lie within ±1,000,000.
All segment counts are integers from 3 to 20,000, further constrained by the
20,000-vertex and 20,000-triangle budget per mesh. Tube input is also limited to
20,000 points before duplicate removal. Caps count toward the budget. For an open
tube with `n` retained points and `r` radial segments, the sides use `n * r`
vertices and `2 * (n - 1) * r` triangles; two caps add `2 * (r + 1)` vertices
and `2 * r` triangles. A closed tube uses `n * r` vertices and `2 * n * r`
triangles. More radial segments round the cross-section; more centerline samples
resolve bends. Keep both modest for interactive scenes.

### Molecular display beads

`s.molecule(id, props)` builds batched, smooth-shaded mesh beads around supplied
coordinates and returns one ordinary group handle. It does not create one
individually addressable element per site or infer chemical bonds.

```js
const protein = s.molecule('protein', {
  positions: [0, 0, 0, 3.8, 0.2, 0], // Packed XYZ; illustrative coordinates.
  radius: 1.5, origin: [0, 0, 0], detail: 1,
  scale: 0.2, fill: Color.GOLD,
  material: { roughness: 0.7, specular: 0.2 },
});
s.play(protein.rotateTo([0, 0.8, 0]), { duration: 2 });
s.keep(protein);
```

Props: required nonempty packed `positions` (three finite numbers per site,
at most 10,000 sites) and positive `radius`; optional `origin` (default `[0,0,0]`),
`detail` (`0`: 8 faces/site, default; `1`: 32 faces/site), `material`, and ordinary
style/transforms except billboard settings. Coordinates and generated vertices
must stay within ±1,000,000. The origin is subtracted before the group transform;
use one origin and scale across chains of a structure. Separate calls allow
different colors, radii, or independently moving parts. Children reserve IDs
`${id}/batch-N`; batches obey the 20,000-vertex/triangle per-mesh ceilings and
the aggregate geometry/source/VM budgets. The 10,000-site input cap does not
guarantee that a scene of that size will compile or render responsively.

The host-only `importPDB` export prepares legacy PDB coordinates with chain
selection, heavy-atom or CA/P residue selection, and provenance. It does not parse
mmCIF, include HETATM records, infer bonds, or reconstruct biological assemblies.
The host-only `createMolecularEnvelope` produces a bounded, Gaussian-smoothed
native mesh from supplied positions; embed its finished arrays using `s.mesh`.
Neither helper is available inside scene code. Radii, detail, subsampling, and
envelopes are schematic display choices, not atomic surfaces or folding physics.
See [molecular coordinates](molecules.md) for offline preparation and scientific limits.

### Curved paths and organic shapes

`s.path` accepts either a `points` array or SVG path data in `d`. Existing point
paths use straight segments (`curve: "linear"`, also the default). Set
`curve: "smooth"` to interpolate through the
points with a Catmull–Rom spline; a closed spline has a smooth closing seam.
Use at least two points for an open path and three for a closed smooth path.
Set `closed: true` on a point path to close it; open is the default. `d` and
`curve` are path-only properties, not options for rectangles, lines, or arrows.
The spline can overshoot between points; use Bézier controls when exact boundaries
or sharp tips matter.

```js
const leaf = s.path('leaf', {
  d: 'M0 0 C0.5 0.6 1.3 0.7 2 0 C1.3 -0.5 0.5 -0.4 0 0 Z',
  fill: Color.GREEN, stroke: Color.GREEN_A, strokeWidth: 0.03,
});
const root = s.path('root', {
  points: [[0, 0], [0.1, -0.5], [-0.3, -1]], curve: 'smooth',
  fill: Color.NONE, stroke: Color.GREEN_B, strokeWidth: 0.05,
});
s.play(leaf.morphTo({
  kind: 'path',
  d: 'M0 0 C0.5 0.8 1.3 1.0 2 0.3 C1.3 -0.2 0.5 -0.3 0 0 Z',
}), { duration: 1 });
```

Path data supports absolute and relative `M`, `L`, `H`, `V`, `C`, `S`, `Q`,
`T`, `A`, and `Z` commands. Start with `M` or `m` and include at least one drawing
segment. Coordinates use the element's local XY plane,
**positive Y upward**, in scene units (CSS pixels for screen-space elements).
`d` is geometry data, not an SVG document: it does not carry colors, transforms,
or a viewBox. Apply those through ordinary element/group properties. Do not mix
`d` with `points`, `curve`, or `closed`; use `Z` to close each subpath.

Closed contours receive fills and strokes; open contours receive strokes only.
Compound paths support disjoint shapes and nested holes using an even-odd fill
rule, independent of winding. Contours should be simple and must not intersect
each other; self-intersecting fills are not supported. Curves are adaptively
tessellated for both GPU backends using the element's projected scale. Subdivision
is bounded (at most 12 levels and about 20,000 tessellated points per path), so
extreme zoom or very complex paths can reach the quality limit. Path strings are
limited to 20,000 characters and 20,000 normalized control points per path.
Coordinates must be finite with magnitude at most 1,000,000, including after
relative commands are made absolute. Normalized control points count toward
the scene's geometry budget.

Compatible `d` paths interpolate normalized segment controls before tessellation.
Keep contour order, closure, segment types/counts, winding, and start points
consistent to preserve intended correspondence. Quadratic curves and arcs are
converted to cubic segments; matching SVG command counts alone do not guarantee
matching normalized structures. Compatible smooth-point paths with matching
point counts and closure interpolate the curves implied by corresponding points.
Single outlines with different
structures use ordinary outline matching; incompatible compound paths crossfade.
Put a blade and its vein in a group at the leaf's base for growth/rotation, and
author corresponding morphs for both when bending. See the
[plant scene](../demo/plant.ts) and [demo page](../demo/plant.html) for a complete
example using the library renderer. Curved geometry does not extend the supported
hit shapes or surface connectors; see [behaviors and live bindings](#behaviors-and-live-bindings).

### Choosing how objects relate and move

Choose the representation from the object's meaning and planned later uses,
including when the current scene is still. Two coordinates that happen to match
do not establish an attachment. Keep reusable parts under stable IDs so later
scenes can retrieve them and preserve their relationships.

| Need | Use | What it preserves or leaves to the author |
| --- | --- | --- |
| Independent geometry, such as an axis or reference mark | `s.line`, `s.arrow`, `s.path`; `line3D`/`arrow3D` for round shafts | Authored points. Creating a segment does not associate it with nearby objects. |
| A bond, graph edge, or arrow joining two objects | Create a line/arrow, then `s.connect(segment, from, to)` | Endpoints follow both sources every frame, even during authored motion. Their distance may change. |
| A label following an object's center | `s.attach(label, object, { offset })` | Position with a world-space offset. It does not inherit the source's rotation or scale. |
| Parts moving as one rigid object | `s.group`, then group `moveTo`/`rotateTo` | Relative distances, while child positions and scale stay fixed. `scaleTo` deliberately changes size and distances. |
| A chain bending while each link keeps its length | Nested groups with origins at joints and fixed local offsets; `rotateTo` on joints | Segment lengths throughout interpolation. The author supplies the hierarchy and joint angles. |
| Independent translation or style changes | `moveTo` or `animate` | Interpolated properties, without inferring relationships to other objects. |
| An intentional change of shape | `morphTo` | Object identity and supported geometric correspondence, not physical constraints such as length or rigidity. |
| Viewer dragging, bounded handles, path-following, or spring return | `s.behavior` with `drag` or `spring` | Live presentation behavior. A spring returns toward an authored target; it is not a distance constraint between objects. |

For a semantic connection, prefer `connect` even if its sources are initially
still. Animate the sources instead of independently moving or replacing the
segment. Static points are sufficient inside a rigid assembly whose parts never
move relative to one another. A label that must rotate and scale with an object
belongs in its group; use `attach` when only its position should follow.
Generic outline morphing may reverse a line's endpoint correspondence to reduce
geometric travel; it does not know which endpoint belongs to which object.
Use `connect` to preserve that relationship while the sources move.

Connection and constant length are separate requirements. Independently
interpolating two endpoint positions can stretch or collapse a segment even if
its start and end lengths match. A fixed-length vector should rotate about its
tail; a folding chain should rotate about its joints. Neither a geometry morph
nor smoother easing enforces those constraints. Animlib has no built-in
fixed-distance chain solver or generated per-frame callback API. See the
[chain handoff example](#example-a-chain-that-folds-in-a-later-scene).

### Fading a composed object

Use `s.group(id, children, { isolated: true })` when overlapping components belong
to one visual object. The renderer draws its children into a transparent layer,
then applies the group's opacity once to the resulting image. Two opaque parts
at 50% group opacity therefore stay at 50% opacity where they overlap.

```js
const object = s.group('object', [shape, outline, label], { isolated: true });
s.play(object.fadeOut(), { duration: 1 });
```

Animate the **group's** opacity; fading each child separately still represents
independent translucency. Ordinary groups retain their existing behavior of
multiplying opacity into each child. Explicit child transparency is preserved
inside an isolated group, and nested isolated groups each apply their opacity
once. Isolation is a static group option, not an animated property.

Both WebGPU and WebGL2 composite premultiplied color and preserve nearest surface
depth for external occlusion. An isolated group is an atomic compositing unit:
arbitrary interleaving with other translucent objects remains approximate, as it
does for ordinary transparent meshes. Each isolated group must use one view and
one coordinate space. Nesting is limited to 16 isolated layers. Offscreen targets
are allocated lazily and reused by nesting depth, resized with the canvas, and
released on disposal/backend recovery. Use isolation for visual objects that need
it; it adds offscreen color/depth work and storage.

### Behaviors and live bindings

Scene builders declare behavior data; they do not install browser listeners or
execute an application animation loop. These declarations apply throughout the
target element's lifetime in that scene.

```js
s.behavior(atom, { type: 'drag', plane: 'screen' });
s.behavior(atom, { type: 'spring', stiffness: 65, damping: 9 });
s.attach(label, atom, { offset: [0, 0.7, 0] });
s.connect(bond, atom, otherAtom, { endpoints: 'surface' });
```

`drag` accepts a camera-facing `plane: 'screen'` (the default), a world plane
`'xy'`, `'xz'` or `'yz'`, or a world `axis: 'x'`, `'y'` or `'z'`. Choose either an
axis or a plane. The grab point is preserved, and the held object stays at its
world position while the authored target moves. After release, a drag on its own
retains its local offset from the authored timeline.

Use `bounds` to clamp the dragged target's origin to a world-space box, or `path`
to keep it on an ordered world-space polyline. Both are built in: no host custom
behavior registration is needed.

```js
// A handle inside a rectangle. Use axis: 'x' instead for a bounded rail.
s.behavior(handle, {
  type: 'drag', plane: 'xy',
  bounds: { min: [-3, -2, 0], max: [3, 2, 0] },
});
// A vehicle following a closed road centerline; omit a repeated closing point.
s.behavior(plow, {
  type: 'drag', plane: 'xy',
  path: { points: [[-8,-8,0], [8,-8,0], [8,8,0], [-8,8,0]], closed: true },
});
```

Choose **one** constraint: `bounds` or `path`. Bounds require a fixed world plane
(`xy`, `xz`, `yz`) or an axis; min/max are finite Vec3 values with min <= max on
every coordinate. Path dragging requires a fixed world plane, no axis, and 2–256
finite Vec3 points on that plane (at least 3 when closed). Adjacent points must be
distinct; closing is implicit. Curves can be sampled into polyline points.

Bounds constrain the target **origin**, not its full geometry: inset the bounds
by the object's footprint when needed. The constraints are world-space even for
transformed children; attached labels, parts and connections follow normally.
The initial path position is projected to its nearest segment. During a gesture,
only the current segment and a neighbor at a reached endpoint are eligible:
large pointer jumps cannot select a distant parallel road or cross a block.
Corners are visited before entering the next segment; a fast pointer jump may
require further pointer movement to follow successive segments. Closed paths wrap
between the first and last segments; open paths stop at endpoints. At crossings,
movement follows the ordered segments rather than switching branches.

These constraints apply during the drag gesture. After release, ordinary local
offset/timeline and spring behavior resumes; animated targets can leave the
constraint. Authored/offline frames remain deterministic and do not simulate user
input. This is constrained translation, not collision detection, automatic vehicle
heading, swept-area history, or persistent snow clearing. Bounds with a starting
position outside the fixed coordinates of their plane/axis cannot capture a drag;
place the authored target on the intended plane/rail.

`spring` is independent of dragging. It restores the position toward the current
authored target when the object is not held. Defaults are stiffness 65 and damping
9; both must be positive and at most 1000. The player advances live behavior time
even when scene playback is paused, and stops requesting frames when all behaviors
settle. Spring integration clamps long elapsed times and subdivides its steps.

Built-in hit testing supports spheres, planar circles/rectangles, and triangle
meshes, including nested transforms and billboard placement. A behavior on a group
uses its supported descendant shapes as hit targets. Picking chooses the nearest
eligible surface; it does not test arbitrary text outlines, rods or path strokes,
nor infer continuously morphing mesh topology. Elements below 0.01 effective opacity
are ignored. Screen elements use pixel coordinates within their view.

`attach(target, source, { offset })` binds the target's position to the source's
center, with an optional offset in world units (pixels for screen elements).
`connect(line, from, to, { endpoints, offset })` maintains a line/arrow's endpoints.
By default, text/LaTeX endpoints use their **visual bounding-box centers** and
trim the connecting segment to the boxes with a small gap. This follows the
actual glyphs, named anchors, numeric values, morphs, and transformed groups.
Other source kinds use their element origins. `endpoints: 'bounds'` explicitly
selects this behavior; `endpoints: 'center'` opts out and joins element origins.
Label padding shrinks when space is tight. If even the unpadded gap cannot fit
a readable line (or an arrowhead plus shaft), the connector hides until there is
room again; move the labels farther apart to make it visible. It never reverses
direction or falls back to drawing through the expressions. Unbound lines are
unaffected.
`endpoints: 'surface'` clips to sphere/circle radii, accounting for scale and radius
morphs. A signed strand `offset` creates parallel bonds
using a deterministic perpendicular. Overlapping endpoint surfaces hide the rod.
The connector binding owns the line's geometry. Bindings work across transformed
groups, require the same view/coordinate space, resolve in dependency order, and
reject cycles (including cycles through parent transforms). Missing sources hide
their dependents. A bound target cannot simultaneously have behaviors or a second
binding; animate or interact with its source instead.

Pure `evaluateScene` resolves bindings, so headless frames and scene handoffs have
attached geometry. The player evaluates the authored frame, applies live behaviors,
resolving live parent/source dependencies before dependent behaviors and bindings. Live interaction never enters
compiled tracks or outgoing scene handoffs. A seek, reset, successful recompilation,
or scene change clears live behavior state. Removing a target disposes its behaviors
and cancels its held gesture. View pan/orbit is retained across control changes;
`resetView()` clears pan/orbit and behavior state without changing scene time.

Bindings and behavior declarations belong to the compiled scene, not to an
element's persistent state. The handoff carries evaluated authored geometry,
including resolved bindings, but no declarations or live interaction state.
In each receiving scene, retrieve the existing objects and declare needed
`connect`, `attach`, and behaviors again. Declare bindings before the
first `play`/`wait` for clarity; they apply throughout the bound target's lifetime
in that scene, rather than starting at the builder's current cursor. Matching
incoming geometry and binding parameters prevents a snap at time zero.

#### Custom behaviors

Register trusted host implementations by name. Generated scene code still contains
only serializable declarations; it never receives DOM access or host callbacks.

```ts
const player = createPlayer({
  canvas,
  behaviors: {
    pulse: options => {
      let elapsed = 0;
      return {
        update(ctx) {
          elapsed += Math.min(ctx.dt, 0.04);
          ctx.element.scale = ctx.authored.scale * (1 + 0.08 * Math.sin(elapsed * 4));
          return true; // request another live frame, even when paused
        },
        dispose() { /* release any resources owned by this instance */ },
      };
    },
  },
});
// In submitted scene code:
// s.behavior(dot, { type: 'custom', name: 'pulse', options: null });
```

A factory returns a `Behavior` with optional `update`, `input`, and `dispose`
methods. The context supplies scene `time`, wall-clock `dt`, `held`, the authored
element, the mutable presentation element/frame, and world-position helpers.
`setWorldPosition` retains a local offset from the authored position.
An `input` method receives `start`, `move`, `end`, `cancel`, or `key`; pointer events
include a ray, and `start` includes the camera-plane normal. Return true from
`start` to claim pointer capture; return true from `key` to consume that key.
Keyboard input goes to the last selected behavior target on the focused canvas;
Escape cancels a held gesture. Factories are instantiated per live target and scene.
Unknown factory names reject the submission without replacing the current scene.

Multiple behaviors on one target execute in declaration order; later writes to a
property win. Parent behaviors execute before child behaviors. A behavior should
return true only while it needs another frame. Duplicate built-in behaviors or
custom names on the same target are rejected. Hosts are responsible for their
custom implementation's validity, bounded work and cleanup.

#### Canvas navigation and camera access

An unclaimed left drag rotates its view. Shift-drag, middle-drag, right-drag, or
`player.setNavigationMode('pan')` pans it. Shift takes precedence over object
picking; ordinary object dragging takes precedence over background navigation.
`setNavigationMode('orbit')` restores the default background gesture. Pan works
with 2D/3D cameras and independent views. Right-drag suppresses the context menu.

`player.getPan(view?)`, `setPan([x,y,z], view?)`, `resetView()` and
`invalidateFrame()` expose navigation and paused redraw. `getInteractionSnapshot(view?)`
returns detached frame/camera copies plus logical view dimensions and its normalized
rectangle, or undefined before rendering. `project(point, view?)` and
`ray(x, y, view?)` use that same effective camera, including pan and viewer rotation.
Ray coordinates are logical pixels from the selected view's top-left corner;
omit the view ID for the main canvas. The internal controller also accounts for
CSS canvas bounds and pixel density. Input deltas update navigation immediately;
`invalidateFrame()` coalesces pointer/orbit/pan requests into one redraw on the next
animation frame, sharing the playback callback while playing. Explicit seek,
pause, and committed control updates still draw their committed state immediately
and consume any queued redraw. Canvas replacement rebinds input automatically.
The player sets `touch-action: none`, makes an otherwise unfocusable canvas focusable,
and restores those attributes/styles when it releases that canvas.

### Element animation and coordinates

Opaque geometry is retained in indexed GPU buffers on both backends. Camera and
object transforms update uniforms; matching spheres, round two-point bonds, and
arrows can share geometry and instance consecutive compatible draws. Untextured
spheres also share across radii. Round bonds/arrows share across translations and
orientations when length, width, and style match. No author cache or invalidation
API is required: effective geometry, normals, materials, textures, style and
palette contents invalidate automatically, including fresh evaluated frames and
in-place edits. Continuously changing geometry/style uses the CPU path until a
stable sample can be retained again. Billboard orientation remains live. Transparent triangles, morphs,
adaptive curves and stroked meshes use the CPU path to preserve ordering and
projected stroke/tessellation behavior. Precision-sensitive local coordinates and
transforms also use CPU world-space packing before float32 conversion, preserving
small details when large authored coordinates cancel through object/group transforms.
Geometry near uncertain depth clipping boundaries or with a float32-overflowing
instance transform also uses that path. Subnormal local coordinates/transforms,
values that would underflow to zero when packed, and unsafe intermediate underflow
also opt out of retention. Large normal divisors whose reciprocals approach the
subnormal range use the CPU path as well, preserving shading across backends.
Ordinary normal-valued geometry remains eligible.
GPU handles are rebuilt after recovery;
geometry unused by the current frame is released. See [performance](performance.md)
for measurements and remaining limits.

`animate` accepts position, rotation, uniform scalar scale, opacity, fill,
stroke, stroke width, and viewport offset. Geometry changes use `morphTo`,
fixed-topology `s.deform`, or the supported reactive properties below; construction
parameters are not ordinary animation properties. Elements also expose `moveTo`,
`rotateTo`, `scaleTo`, `fadeIn`, `fadeOut`, and `countTo` for named formula numbers.

```js
s.play(dot.animate({ scale: 1.5, fill: Color.WHITE }), { duration: 0.6 });
```

Coordinate conventions:

- World-space positions accept `[x, y]` or `[x, y, z]`; omitted `z` means zero.
- The 2D drawing plane is XY, with positive Y upward. Distances use scene units,
  angles use radians, and durations use seconds.
- World text scales with the scene. `space: "screen"` uses CSS pixels, with the
  origin at the canvas center and positive Y upward. Screen-space geometry and
  labels remain fixed independently of camera movement. Default screen text is
  16 pixels; default screen LaTeX is 24 pixels.
- View framing is controlled by the camera, so resizing the canvas does not change
  the mathematical coordinates. Pixel density is handled by the renderer.
- `viewportOffset: [x, y]` adds a camera-independent displacement in fractions
  of the viewport's width and height. It can be animated on an element or group,
  so `[-1.5, 0]` slides content left even after viewer rotation or on an ultrawide
  canvas. It does not change the underlying world coordinates.

Ordinary IDs are unique within a scene. Persistent IDs must also be unambiguous
among currently carried objects. Duplicate IDs or missing inherited IDs are
errors, with source locations where available.

## 4. Persistence and scene handoffs

Scenes have independent **time**, but can depend on preceding scenes for **state**.
There is no concatenated public project timeline. A position is `{ scene, time }`.

`s.keep(element)` marks an object as durable across boundaries. It keeps its
identity, geometry, style, and final authored transform until explicitly removed.
`s.remove(element)` records removal at the current cursor and ends its persistence.
A fade changes visibility; it does not itself remove an object's identity.

The incoming scene has two ways to access the outgoing state:

- `s.previous.get(id)` accesses a carried persistent object. It is already attached
  to the incoming scene at time zero, with the preceding final authored state.
- `s.previous.exiting()` attaches a temporary group containing the previous
  scene's nonpersistent survivors. The incoming scene can animate them away.
  These objects do not become durable simply because they are used for an exit.

```js
export default scene({ mode: "2d", end: "hold" }, s => {
  const leftovers = s.previous.exiting();
  const mainShape = s.previous.get("main-shape");

  s.play(leftovers.animate({ viewportOffset: [-1.5, 0] }), { duration: 0.5, ease: "smooth" });
  s.remove(leftovers);

  s.play(mainShape.moveTo([0, 0]), { duration: 0.8 });

  const caption = s.text("caption", {
    text: "The same object, in another scene",
    position: [0, -2],
    fontSize: 0.35,
  });
  s.play(caption.fadeIn(), { duration: 0.4 });
});
```

There is no separate transition object or clock. These exit and entrance
animations are ordinary instructions at the start of the incoming scene.
The player never crossfades entire scenes. For unrelated subjects, clear or move
the previous content offscreen before introducing the next subject. Keep an
element only when its identity has a meaningful relationship to the next scene;
the demo creates new atoms and bars rather than reusing an unrelated vector.

Lifetime details:

- The previous scene's nonpersistent objects are available as a frozen snapshot,
  and render in the incoming scene only if it requests `previous.exiting()`.
- An empty exit group is valid, including in the first scene.
- Temporary exit objects have a separate namespace, so an incoming caption can
  reuse a departed caption's local ID.
- Exit objects expire by the next boundary unless explicitly promoted to
  persistence. Missing exit animation means immediate disappearance at handoff.
- A morph changes the existing object's representation while preserving its ID.
  Its destination is a geometry descriptor, not a second automatically attached
  object.
- Keeping a group keeps its descendants. Keeping only a child preserves its
  visual pose by baking departing ancestor transforms into the child's incoming
  state. Its siblings do not silently become persistent.
- Removing a child detaches it from its group's membership, so later reuse of
  that local ID does not accidentally attach a new object to the old group.
- Binding and behavior declarations do not cross the boundary. Re-declare them
  on carried IDs; otherwise a carried connector retains its last evaluated
  points when its sources move independently.

### Example: a chain that folds in a later scene

The first scene only shows a straight schematic chain. It already gives each
residue and bond an ID, binds the bonds, and creates the joint needed later.
`residue-c` is offset from `joint-b` in local coordinates; the joint's origin is
placed at `residue-b`. Keeping the root group also keeps its descendants and
their hierarchy.

```js
export default scene({ mode: "2d", end: "advance" }, s => {
  const length = 1.5;
  const a = s.circle("residue-a", { radius: 0.15 });
  const b = s.circle("residue-b", { radius: 0.15, position: [length, 0] });
  const c = s.circle("residue-c", { radius: 0.15, position: [length, 0] });
  const joint = s.group("joint-b", [c]);
  const ab = s.line("bond-ab", { strokeWidth: 0.04 });
  const bc = s.line("bond-bc", { strokeWidth: 0.04 });
  const chain = s.group("chain", [a, b, joint, ab, bc]);
  s.connect(ab, a, b, { endpoints: "surface" });
  s.connect(bc, b, c, { endpoints: "surface" });
  // Initialize the pivot; c is now at [2 * length, 0] in world coordinates.
  s.play(joint.moveTo([length, 0]), { duration: 0 });
  s.keep(chain);
  s.wait(1);
});
```

The receiving scene reuses the root and joint, re-establishes the bindings, and
animates angles. It does not create replacement residues or bonds. Both adjacent
center-to-center distances remain 1.5 at every intermediate time; with unchanged
radii, the visible surface-to-surface segments also retain their lengths.

```js
export default scene({ mode: "2d", end: "hold" }, s => {
  const chain = s.previous.get("chain");
  const joint = s.previous.get("joint-b");
  const a = s.previous.get("residue-a");
  const b = s.previous.get("residue-b");
  const c = s.previous.get("residue-c");
  s.connect(s.previous.get("bond-ab"), a, b, { endpoints: "surface" });
  s.connect(s.previous.get("bond-bc"), b, c, { endpoints: "surface" });
  s.play([
    chain.rotateTo(-Math.PI / 6),
    joint.rotateTo(Math.PI / 2),
  ], { duration: 2, ease: "smooth" });
  s.keep(chain);
});
```

For longer chains, nest downstream joints with fixed offsets, and rotate the
joint groups instead of independently translating the residues. Preserve the
joint groups when carrying the chain; keeping only individual residues preserves
their current poses but loses any departing parents needed for later articulation.
In 3D, use the same principle with authored joint rotations and `line3D` bonds;
fixed world-space lengths can change apparent length under projection. This
constructs prescribed motion, without solving collisions, joint limits, or
molecular dynamics.

An incoming scene can also `connect` an existing unbound segment to its carried
endpoints. It need not replace that segment. Match the incoming endpoint positions
and clipping convention when establishing the binding so the handoff remains
continuous. Building the intended hierarchy at introduction avoids needing to
restructure already-parented parts later.

### Direct navigation and reconstruction

To open scene C directly, the player evaluates preceding scenes to their final
states, in sequence, to obtain C's incoming state. It does not visibly play those
scenes, wait through their durations, play their audio, or stop at their holds.

Evaluation uses each scene's current control values, its current source, approved
assets, and a stable random seed if seeded randomness is exposed. Persistent state
and the immediately preceding scene's exit snapshot are reconstructed together.

The initial implementation rebuilds the sequence on successful source or control
changes. Direct navigation then evaluates already compiled data without executing
source again. More selective reconstruction/caching can follow once needed.
Viewer camera interaction is a separate view setting and does not silently alter
an object's authored outgoing state.

This deliberately makes later scenes state-dependent. If an upstream edit removes
an object a later scene expects, reconstruction must report that dependency error.
The library should not invent a substitute object or reuse a stale handoff.

## 5. Morphing shapes and LaTeX

### Ordinary shapes

```js
s.play(shape.morphTo({ kind: "rectangle", width: 2, height: 1 }), {
  duration: 1,
});
```

For ordinary single outlines, point matching aligns winding and the start of
closed contours before interpolation. Matching vertex counts retain their corners;
other compatible outlines use arc-length samples that include every corner from both shapes.
An unchanged outline retains its exact geometry throughout the morph.
Circles, rectangles, and single-contour closed paths can morph into one another;
open paths, lines, and arrows can morph
into compatible open outlines. Arrow-to-arrow morphs retain arrowheads.

Compatible curved paths use their authored correspondence instead: `d` paths
with matching normalized segment structures interpolate their control points,
and smooth-point paths with matching point counts interpolate corresponding
curves. This keeps straight-to-bent segments and pointed leaf tips tied to their
authored positions. Matching compound paths preserve contour correspondence;
incompatible compound paths crossfade. See
[curved paths](#curved-paths-and-organic-shapes) for authoring rules and limits.

Meshes with matching vertex counts interpolate corresponding vertex positions.
Use matching vertex ordering and compatible topology for meaningful mesh morphs.
The library cannot infer the correspondence between two arbitrary 3D models.
Unchanged text renders once at full element opacity, with font size interpolated
when it changes. Other incompatible representations crossfade. Morph targets
describe geometry; animate position, scale, rotation, and color with separate actions in the same
`play` when needed.

### Named formula parts

LaTeX uses bundled MathJax SVG glyph outlines, tessellated for both GPU backends. A complete
formula is laid out together, preserving fractions, scripts, and normal spacing.
The library-specific `\animpart{name}{TeX}` marker identifies a part without
changing its visual content. It is consumed before MathJax typesetting.

The bundled TeX packages are `base`, `ams`, `newcommand`, and `html`; additional
extensions are not loaded. Use ordinary fractions, scripts, Greek letters,
matrices, `\mathbf`, `\vec`, `\mathrm`, and `\text`. Do not assume commands from
other packages such as `\ce`, `\cancel`, or `\si` are available. For example, write
water as `\mathrm{H_2O}`. Set color through the element's palette `fill` or named
formula parts, rather than relying on a TeX color extension.

```js
export default scene({ mode: "2d" }, s => {
  const equation = s.latex("equation", {
    tex: String.raw`\animpart{lhs}{x^2}\animpart{eq}{=}\animpart{rhs}{4}`,
    fontSize: 0.7,
  });

  s.play(equation.fadeIn(), { duration: 0.5 });
  s.wait(0.5);
  s.play(equation.morphTo({
    kind: "latex",
    tex: String.raw`\animpart{lhs}{x}\animpart{eq}{=}\animpart{rhs}{\pm 2}`,
    fontSize: 0.7,
  }, {
    map: { lhs: "lhs", eq: "eq", rhs: "rhs" },
  }), { duration: 1.5 });
});
```

Every part that morphs needs an explicit mapping, including parts with identical
names or symbols. An empty map intentionally fades the whole formula. Unmapped
source parts fade out; unmapped destination parts fade in. Repeated symbols do
not trigger guessed matches.

Mapped parts interpolate glyph contours when their path/contour structures are
compatible. Otherwise the mapped parts move between their positions and crossfade.
This preserves the author's semantic correspondence without pretending arbitrary
glyph topology has a unique interpolation.

Part names must start with a letter and contain letters, digits, `_`, or `-`.
Names are unique within a formula, and parts cannot be nested. Mappings are
one-to-one in this version; split/merge mappings are not implemented. Invalid TeX,
unknown mapped names, and duplicate destinations reject the submission.

The configured mathematical TeX packages cover base math, AMS constructs,
new commands, and the internal HTML-class annotations used for named parts.
Full document TeX is outside the renderer. Plain `text` also uses bundled vector
glyphs; unsupported characters reject rather than silently disappear. Font
selection, emoji, multiline text layout, and broad international text coverage
need a separate text implementation.

### Anchors and counting numbers

Set `anchor` to a named LaTeX part to place that part's center at the element's
origin. Use the same anchor in the morph target to keep that symbol stationary
when the rest of the formula changes, such as adding an `A` before `v`.
Without an anchor, formulas are centered as a whole.

Use `\animnum{name}` for a changing number. Its value comes from `numbers`,
and `numberFormat` reserves a fixed-width slot so changing digit widths do not
move the surrounding brackets or symbols. `countTo` interpolates the value using
the same timeline and easing as other animations; seeking displays the number
for that exact time without fading between old and new glyphs.

```js
const equation = s.latex("equation", {
  tex: String.raw`\animpart{v}{v} = \begin{bmatrix}\animnum{x}\\1\end{bmatrix}`,
  anchor: "v",
  numbers: { x: 1.5 },
  numberFormat: { decimals: 2, digits: 1 },
  position: [-2.3, 2],
  fontSize: 0.36,
});
s.play(equation.countTo({ x: 2.25 }), { duration: 2, ease: "smooth" });
```

`digits` reserves the number of integer digits; an extra sign column and the
specified decimal places are also reserved. Values must fit the selected format.
Supported formats use 1–6 integer digits and 0–4 decimal places.
Number updates and geometry morphs both write an element's geometry and cannot
run on that same element in one `play`; use separate instructions for those changes.

## 6. Interaction and 2D/3D scenes

### Controls are input values

```js
const factor = s.slider("factor", {
  label: "Stretch",
  default: 1,
  min: 0.5,
  max: 3,
  step: 0.1,
});
const showGrid = s.toggle("grid", { label: "Show grid", default: true });
const order = s.select("order", {
  label: "Order",
  default: "ascending",
  options: ["ascending", "descending"],
});
```

These methods return ordinary numbers, booleans, or strings during compilation.
Normal JavaScript arithmetic and conditionals work without a reactive expression
language. The builder is reevaluated when inputs change. The current scene is
redrawn at its current local time, including while paused; it does not restart
merely because a slider changed. If the new duration is shorter, the time clamps.
Playback continues if it was running and has not reached the new end.

Stable control IDs are scoped by scene ID. Successful source edits preserve values
for controls that still exist. Slider values clamp to changed bounds; an obsolete
select option falls back to its new default. Removed controls disappear.

For a custom host UI:

```ts
const unsubscribe = player.subscribe(state => {
  renderMyControls(state.controls);
  updateMyTransport(state);
});

await player.setControl({ scene: "intro", id: "factor", value: 2 });
// Later:
unsubscribe();
```

Do not recreate the host's controls on every frame if that would lose focus.
The built-in overlay maintains keyed native widgets and reconciles pending input
updates after they finish.

### Retained reactive bindings

Opt into retained JavaScript bindings for property changes:

```js
const size = s.slider('size', { reactive: true, default: 1, min: 0.5, max: 2 });
const ball = s.sphere('ball', { radius: 0.45 });
s.bind(ball, [size], value => ({ radius: 0.45 * value }));
```

The slider returns a handle, and the callback receives its numeric value.
Callbacks must be pure and synchronous, returning a fixed set of supported
properties: radius, position, rotation, scale, opacity, fill, vertices, normals,
material, texture, or scalarColors. Multiple bindings may target one element if
they own disjoint properties. A binding and
timeline cannot own the same property. The changed builder and earlier scenes
are reused; downstream scenes still rebuild transactionally. Callbacks remain
inside a retained QuickJS sandbox, with a fresh execution deadline per update;
compiled snapshots contain only their validated results. See the
[reactive contract, limitations, and measurements](reactive-controls.md).

Use this opt-in path only when every value driven by the slider can be expressed
with supported properties. Keep an ordinary numeric slider when a control changes
text, LaTeX numbers, path geometry, mesh topology, object counts, camera settings, animation
targets, or timing. For example, a vector-length slider that also updates a formula
should continue using the ordinary builder path so both remain consistent. Both
styles may coexist in one scene; retained bindings do not replace or restrict the
existing authoring API. Do not simplify a planned explanation to fit the fast path.
Reactive callbacks must use their supplied values and immutable captured data;
mutation of closure state or consuming random values breaks reproducibility.

### Fixed-topology deformation and scene time

```js
const amplitude = s.slider('amplitude', { reactive: true, default: 0.6, min: 0, max: 1.2 });
const roughness = s.slider('roughness', { reactive: true, default: 0.45, min: 0.05, max: 1 });
const wave = s.surface('wave', { fn: () => 0, xSegments: 24, ySegments: 24, fill: Color.TEAL });
s.deform(wave, [s.time, amplitude], ([x, y], index, t, a) =>
  [x, y, a * Math.sin(2 * x - t) * Math.cos(2 * y - t / 2)]);
s.bind(wave, [roughness], r => ({ material: { roughness: r } }));
s.wait(10);
```

`s.deform(mesh, dependencies, callback)` captures the mesh's local rest vertices
at declaration. Each invocation receives a fresh rest `Vec3`, its vertex index,
and dependency values in declared order. It must return a finite `Vec3` within
±1,000,000. It works on sampled surfaces, solids, tubes, and explicit meshes.
`s.time` is a handle for absolute scene-local seconds clamped to `[0, duration]`;
it is available inside views too. It can also drive ordinary `s.bind` properties,
including materials and textures. A time-only binding may use `[s.time]`.

For full array control, `s.bind` may return `vertices: Position[]` and optional
`normals: Vec3[] | null`. Vertex count must equal the original mesh's count;
triangle indices, order, and winding never change. New holes, sampling counts,
and connectivity require ordinary controls/source reconstruction. Nonfinite
updates are rejected, rather than turning into new holes. Existing holes and
omitted pole triangles stay as compiled, even if deformation uncovers them.
Collapsed triangles remain connected and use finite fallback normals.

Vertex updates discard old normals unless the same patch supplies new ones;
smooth/flat shading then derives normals from the deformed positions. Explicit
normals must be nonzero and match the vertex count. Vertices implicitly own
normals, so a separate binding cannot also own them. Geometry bindings cannot
coexist with a morph on the target. Independent transform animation, grouping,
isolated group opacity, and clipped views continue to work. Removed objects are
not resurrected. Other geometry fields, including clipping/outline settings,
are preserved; downstream geometry processing receives the deformed mesh.
`scalarColors` can replace the explanatory renderer's full `{values, domain,
colors}` ramp (or `null` to remove it), with one finite scalar per retained vertex,
an increasing domain, and 2–16 palette tokens; its rendering belongs to the
explanatory geometry feature.

Callbacks remain synchronous and sandboxed, with the existing per-invocation
execution/memory limits. They must be pure functions of arguments and immutable
captured data; purity is an authoring contract, not mechanically enforced. Same
time and controls therefore produce the same shape without integrating deltas.
The player awaits sampling on seeks and paused input changes, discards stale
worker results, and keeps at most one playback sample in flight. Slow callbacks
reduce displayed frame rate; they do not reset the audio clock. A failed time
sample keeps the last rendered frame, stops playback, and reports a blocked
player; a valid seek or input can recover. End-frame handoffs sample the outgoing
scene at its duration before compiling the next scene.

Headless callers use `await sequence.evaluate(index, time)` for an exact frame or
`await sequence.sample(index, time)` for a serializable `CompiledScene` snapshot.
The latter records `reactiveTime`. `evaluateScene(snapshot, time)` and synchronous
`sequence.frame` never execute callbacks: they evaluate tracks using the binding
outputs already in the snapshot (canonical scenes and `compileSource` hold
time-zero outputs by default). For a one-shot export use
`compileSource(source, input, { sampleTime: seconds })` or `{ sampleTime: 'end' }`;
it samples inside the sandbox and disposes the runtime. Snapshots cannot resample
callbacks after JSON export. Use these APIs before exporting a desired time. Open `?surfaces` for the
wave demo with independent material controls and two cameras.

### Control appearance

Controls sit directly over the scene with transparent backgrounds, fine slider
tracks, compact numeric readouts, and small switches. Labels and strokes adjust
for the scene's background color. Native inputs preserve keyboard interaction
and focus while their values change. The host can set `--animlib-control-accent`
on the overlay host to match its scene colors. Range inputs retain a generous
20-pixel hit area around the thin visible track.

### Overlay placement

All three control methods accept `position: [x, y]` and `width`. Position is the
widget's top-left corner in fractions of the canvas width and height, measured
from the canvas's top-left corner. Width is in CSS pixels (default 220). Omit
position to use the automatic panel at the top-right. Explicit positions remain
relative to the whole canvas, including controls declared inside a view. Authors
should leave room for each widget and the host's playback controls.

```js
const radius = s.slider("radius", {
  label: "Radius", default: 1, min: 0.2, max: 2,
  position: [0.04, 0.06], width: 200,
});
```

Widgets receive pointer and keyboard input without initiating a canvas drag.
They keep their DOM identity and focus when their value or placement changes.

### Round lines and arrows in 3D

`line3D` and `arrow3D` use cylindrical strokes with lit surfaces and capped ends.
Arrowheads are circular cones, so the shaft and head stay visible while orbiting
around an axis. `strokeWidth` is the tube's diameter in world units.

```js
v.line3D("bond", {
  points: [[0, 0, 0], [1.4, 0.5, 0.8]], stroke: Color.WHITE, strokeWidth: 0.08,
});
v.arrow3D("axis-z", {
  points: [[0, 0, -2], [0, 0, 2]], stroke: Color.RED, strokeWidth: 0.035,
});
```

Alternatively, set `strokeProfile: "round"` on world-space lines, arrows, or paths.
The profile stays fixed through geometric morphs. Ordinary strokes default to
`"flat"`; round strokes require world space and respect depth testing and group
transforms. Multi-segment round paths share rings at joins. Sharp bends and
self-intersections can overlap; a round stroke is not a solid-modeling operation.

### Independent view regions

`s.view(id, options, builder)` creates a rectangular region with its own camera
and objects. `rect` is `[left, top, width, height]` in fractions of the canvas size;
the region must fit inside the canvas. Its default camera is 3D and orbit is enabled.
Views share the scene's timeline, controls, and element ID namespace. View builders
are synchronous and cannot be nested. `v.play` advances the same scene clock as
`s.play`; create both views before scheduling simultaneous camera animations.

```js
export default scene({}, s => {
  let leftCamera, rightCamera;
  s.view("left", { rect: [0, 0.15, 0.5, 0.7] }, v => {
    v.sphere("left-ball", { position: [1, 0, 0], fill: Color.BLUE });
    leftCamera = v.camera;
  });
  s.view("right", {
    rect: [0.5, 0.15, 0.5, 0.7], camera: { yaw: -0.5, height: 5 },
  }, v => {
    v.sphere("right-ball", { position: [1, 0, 0], fill: Color.RED });
    rightCamera = v.camera;
  });
  s.wait(3);
  s.play([
    leftCamera.animate({ yaw: 1.2 }),
    rightCamera.animate({ yaw: -1.2 }),
  ], { duration: 2 });
  s.wait(3);
});
```

Left-button dragging rotates only the view where the drag started, even when the
pointer leaves it. Set `orbitHitTest: "geometry"` alongside `orbit: true` to require
a hit on a visible sphere, circle, rectangle, triangle mesh, or imported model before starting
orbit. Imported models use primitive bounding boxes, so gaps inside those boxes may
also start orbit. Standalone text, paths, lines and space outside pickable geometry do not start rotation;
billboard labels stay upright and may sit over pickable model surfaces. Keep
explanatory text outside the model view. Omit this option for legacy region-wide
orbit. Pan gestures remain available across the region. The setting is saved in
evaluated frames and inherited with a view. Scrolling does not zoom. Regions clip their geometry and use
independent depth buffers; overlapping regions render in declaration order, with
the last region receiving pointer input. Regions render transparently over the scene and
have no automatic border. Empty space outside them uses the main scene camera.
Screen-space geometry inside a view uses CSS pixels centered on that region;
main-scene screen labels render above all regions. Groups cannot span views.
The callback's `v` builder and its detached methods retain their view ownership
when called later in the synchronous scene builder, including from another view's
callback. Objects made with the outer `s` after a view callback remain in the main
scene. Keep related model parts and attached labels in the same view; use `v.attach`
for labels that must follow an object. Global screen headings may remain outside
views.
Kept objects retain their region and its outgoing authored camera in later scenes;
redeclaring the same view ID can change its rectangle, camera, and orbit setting.
`player.getState().views` reports each region's rectangle and whether orbit is enabled.

### Geometry and camera transitions

2D uses the same world coordinates as 3D, with planar geometry at `z = 0` and a
front-facing orthographic camera. The first scene's `mode` chooses its initial
camera preset. Later scenes inherit the previous authored camera state; declaring
`mode: "3d"` does not silently snap the incoming view.

```js
export default scene({ mode: "3d", orbit: true }, s => {
  const point = s.previous.get("main-shape");
  const old = s.previous.exiting();
  s.play(old.animate({ viewportOffset: [-1.5, 0] }), { duration: 0.5, ease: "smooth" });
  s.remove(old);

  s.play([
    point.moveTo([1, 0, 1.5]),
    s.camera.to3D({ yaw: 0.7, pitch: 0.4, distance: 12, height: 8 }),
  ], { duration: 1.5 });
  s.wait(2);
});
```

`to3D` animates perspective strength and camera angles. `to2D` returns to a
front-facing orthographic view. Both take optional camera properties; use
`camera.animate` for arbitrary moves involving `yaw`, `pitch`, `target`, `height`,
`distance`, and `perspective`. Camera geometry/motion is authored explicitly;
changing the camera never automatically invents molecular positions or extrudes
a 2D drawing.

`orbit: true` requests pointer-drag rotation when the evaluated camera is 3D.
Horizontal dragging rotates around world-up; vertical dragging tilts around the
camera's right axis, keeping the horizon upright. The front of the scene follows
the pointer. Dragging across a view's shorter dimension turns it 180 degrees;
both axes use that same scale, independent of canvas size or pixel density.
Viewer tilt stops just short of the poles to prevent flipping upside down.
The rotation input is disabled during camera-animation intervals, including when
paused within one. Between authored rotations, viewer rotation stays as an offset to the camera.
An authored yaw/pitch animation captures the viewer's current orientation as its
starting pose and blends to the authored destination using the track's duration
and easing. Both viewer yaw and tilt fade out, so the exact authored pose is
reached at the end. In a fully 3D view, user-adjusted yaw takes the shortest route
to that destination instead of unwinding accumulated viewer turns. Untouched
authored rotations retain their original path, including intentional full turns.
Pausing or scrubbing within the animation follows that same captured path.
Seeking backward to before it restores the authored starting pose and clears
the captured handoff; a subsequent drag supplies a new starting pose. Jumping
past an animation lands on its authored destination. Zero-duration rotations
remain immediate cuts.
Other views retain their rotations and remain interactive unless their own cameras
are being animated. Camera moves that only change framing do not clear rotation.
Viewer offsets and captured handoffs are scoped by scene and view ID. Control
updates that leave the camera tracks unchanged preserve an in-progress handoff.
Restarting before a rotation resets it. A full `load` clears viewer state. Viewer rotation is not baked into
the outgoing object state used for reconstruction.

The renderer handles 3D vertex positions, meshes, camera projection, depth testing,
and four-sample antialiasing on the GPU. `sphere` creates an actual tessellated
sphere with simple directional shading. Circles and text remain planar unless
`billboard: true` makes their plane face the current camera, including viewer
rotation. `billboardOffset: [x, y, z]` displaces a billboard along camera right,
up, and toward the viewer in scene units; this keeps an atom label beside or in
front of its sphere while orbiting. The molecule demo supplies tetrahedral spatial
layout and surface-to-surface bond meshes. Procedural textures and configurable
metalness, roughness, highlights, and emission work on spheres and meshes.
Host-prepared static models and image textures are supported through the asset
registry described below. GLB imports also support the material maps described
under [Imported static 3D models](#imported-static-3d-models); neither path is a
full physically based renderer.
Object interaction uses the behavior API above.

### Domain helpers and prepared assets

These are public `SceneContext` methods, available in the sandbox without imports:

| API | Contract |
| --- | --- |
| `s.plane(id,{xRange,yRange,...})` | `toWorld`, grid/axes/ticks, `path`, `vector`, `components`, sampled `curve`, upright `label`; one `map(dependencies,(point,...values)=>Vec2)` applies from original coordinates |
| `s.graph(id,data,options)` | Authored positions, connected edges, labels/weights/cost handles and state actions; IDs remain stable |
| `s.dijkstra(data,source)` | Immutable distances, predecessors and pop/relax/stale/frontier events; nonnegative weights, at most 256 nodes / 2,048 edges; no self-loops or parallel/opposite overlapping edges |
| `s.collection(id,items,options)` | Identity-indexed items and slots; optional custom `handle` content and vertical layout; `swap` and complete `reorder` schedules preserve identity through separated lanes |
| `s.compactQueue(id,items,options)` | Fixed record pool and visible ordered subsets; compact insertion, extraction and slot shifts preserve survivor order. Defaults vertical; 256 records/transitions; [API guide](compact-queue.md) |
| `s.validateGroup(children,newIds?)` | Read-only builder preflight: dense distinct unparented handles from the current scene/view; optional planned element IDs check syntax, duplicates, existing IDs and total scene budget. Reserves nothing. Used by collections before wrapping any custom content. |
| `s.sampledState({times,values,projection})` | Copied aligned samples; `at(time)` interpolates an explicit 3×N projection; fixed-topology `prefix` paths never bridge null gaps |
| `s.molecularBackbone(id,props)` | Batched explicit segments/bonds in sticks, beads or backbone form; no bond inference |
| `s.molecularBackboneGeometry(props)` | Pure meshes, anchors and residue ownership for fixed-topology retained motion |
| `s.articulatedChainPose(spec,time)` | Fixed link lengths with authored bend/twist interpolation; no physics/collision solver |
| `s.peptidePose(spec,phi,psi)` | Pure idealized atom/bond/anchor pose from explicit component templates, absolute torsions and trans omega; 2–96 residues; schematic, no folding physics |
| `s.nucleicDuplex(props,opening)` / `s.nucleicTranscript(props,time)` | Pure bounded parts and anchors for explicit antiparallel complementary DNA / sequential RNA; optional incoming rotation and fixed-link emergence |
| `s.nucleicTranscriptionCycle(props,time)` | Optional initial opening, repeated docking/incorporation, register advance and prescribed RNA exit; explicit identities and schedules; no final closure or termination |
| `s.nucleicSplice(props,progress)` / `s.nucleicThread(props,progress)` | Identity-preserving RNA excision/joining or fixed-link routing through an authored channel |
| `s.nucleicTranslationCycle(props,time)` | Explicit codons/carriers, assembly, docking, transfer, translocation, release and disassembly; stable residue ownership and phase events |
| `s.model(id,{asset,shading,...})` / `s.modelInfo(asset)` | Instantiate or inspect a host-catalog model; geometry references carry ID/hash/part |
| `s.image(id,{asset,width,height,...})` | Image card, preserved aspect ratio when only one size is supplied; unlit, untinted source colors by default |

```js
export default scene({},s=>{
  const p=s.plane('p',{xRange:[-3,3],yRange:[-2,2]});
  p.vector('v',[1,1],{stroke:Color.YELLOW});
  p.map([s.time],(point,t)=>[point[0]+Math.min(t/2,1)*point[1],point[1]]);
  s.wait(3);
});
```

Host-only `importPDBStructure` / `structureBackboneProps` preserve deposited
heavy-atom coordinates, stable residue IDs and TER/gap breaks. Bonds must have
CONECT, supplied template, or explicitly selected peptide-rule provenance.
`createMolecularEnvelope` / `createMolecularEnvelopeParts` prepare schematic
density meshes offline. Importing
PDB, glTF/GLB, PNG or native binary packages never happens inside scene source.

Hosts use `createAssetRegistry` with validated prepared inputs, or
`decodeModelPackage` / `decodeImagePackage` and bounded blob reads. Pass the
registry as `modelAssets` to `createPlayer` / `SceneSequence`; give generation
systems its descriptor-only `catalog`. For compile-only work, `assetCatalog`
belongs in `CompileInput`. A descriptor catalog is not a geometry resolver.
For native exports, `withOfflineScene(source,input,use,{modelAssets:registry})`
keeps retained callbacks and leases alive; prepare the renderer with
`sampler.scene` and `sampler.assetGeometry`, then render `sampler.sample(time)`
inside the callback. Sampling supports direct and reverse seeks.

Images require host `colorPolicy:'source'` when the registry is created. The
scene cannot authorize this exception to palette-only authoring. Images are
RGBA8 / encoded sRGB / top-left / straight-alpha. Source RGB is not palette
quantized; optional `tint` multiplies by a palette token. Supported sampling is
nearest/linear and clamp/repeat; alpha is opaque/blend. UV0 meshes preserve
source seams. Use `shading:'unlit'` to inspect source colors. Encoded-space
lighting and blending do not establish linear-light PBR fidelity.

The **prepared-package converter** accepts a bounded glTF/GLB triangle and
eight-bit PNG subset.
Skins, morphs, animations, compressed data, JPEG, multiple UV sets, mipmaps,
image clipping/outlines, image scalar/procedural combinations and full PBR are
unsupported on that path. The separate **GLB model-store path** supports JPEG,
UV0/UV1 and additional material maps; see [Imported static 3D models](#imported-static-3d-models)
before choosing an import route. Image pixels and prepared model arrays remain host-owned; repeated prepared model
instances still count logical vertices toward the 100,000-point scene budget.
Registry/individual model decoded caps are 256 MiB / 32 MiB. A renderer/device
owns its GPU resources; each player/sequence must be disposed. Shared registries
keep decoded memory while host references remain, even after leases reach zero.

See [sampled state](sampled-state.md) for interpolation/gap semantics,
[identity transport](identity-transport.md) for custom collection content and
reordering, and [helpers and assets](helpers-and-assets.md) for runnable graph, collection,
catalog and host examples, and [static import](assets-import.md) for precise
format rejection, provenance and derivative policies. Keep original/licensed
asset metadata separate from stylistic reference footage. Use the shared
3Blue1Brown-inspired explanation style across subjects: stable semantic colors,
visible construction, preserved identity and readable holds. Adapt motion from
other references within that style; palettes and choreography remain authored
scene contracts. Text
uses bundled MathJax glyphs/TeX variants; arbitrary font loading is unavailable.

### General animation recipes

Start from the operation the viewer needs to understand, then choose its
representation. Keep the same objects, coordinate origins, and color roles while
the operation unfolds. A complete scene normally needs a visible setup, a change
whose intermediate states mean something, and a reading hold at the result.
The examples marked `js scene` below are complete scene sources with no external
assets. They illustrate API composition; compilation does not certify their
layout at every aspect ratio or establish a reviewed reference-style match.

#### Coordinate maps, basis vectors, and algebra

For “show what this matrix does,” use `s.plane` with basis arrows, a test vector,
and a shape whose invariant matters. Supply data ranges, origin, world scale,
and the actual map. Keep an unchanged faint plane if the viewer must compare
before and after. `plane.components` supplies the x segment from the origin and
the y segment from its endpoint; it does not perform symbolic decomposition.

This shear preserves horizontal lengths and signed area. Its original square
and vector remain visible while the mapped copy moves. The label anchors move
with the coordinates, but the glyphs stay upright.

```js scene
export default scene({mode:'2d',end:'hold'}, s => {
  const opts={xRange:[-2,4],yRange:[-2,2],origin:[-1,0],ticks:false};
  const rest=s.plane('rest',{...opts,
    grid:{stroke:Color.GREY,opacity:.18}});
  rest.path('square',[[0,0],[1,0],[1,1],[0,1]],
    {closed:true,stroke:Color.GREY,opacity:.5});
  rest.vector('v',[2,1],{stroke:Color.GREY,opacity:.4});
  const p=s.plane('mapped',{...opts,axes:false,
    grid:{stroke:Color.BLUE,opacity:.2}});
  p.path('square',[[0,0],[1,0],[1,1],[0,1]],
    {closed:true,fill:{color:Color.BLUE,opacity:.12},stroke:Color.BLUE});
  p.vector('e1',[1,0],{stroke:Color.TEAL});
  p.vector('e2',[0,1],{stroke:Color.YELLOW});
  p.vector('v',[2,1],{stroke:Color.WHITE});
  p.components('v-parts',[2,1],{
    x:{stroke:Color.TEAL},y:{stroke:Color.YELLOW}});
  p.label('e1-label','e_1',[1,0],[0,-.3],{fill:Color.TEAL});
  p.label('e2-label','e_2',[0,1],[-.3,.2],{fill:Color.YELLOW});
  p.map([s.time],([x,y],t)=>{
    const u=Math.max(0,Math.min(1,(t-.7)/2));
    return [x+u*u*(3-2*u)*y,y];
  });
  s.wait(3.7);
});
```

`toWorld` converts the original data coordinates using origin and scale; it does
not apply a subsequently installed `map`. Use plane-owned members when they
must inherit the map. A manually positioned circle needs the same map in its
own binding. Install a map once; it always reads captured source points, so
seeking backward cannot accumulate shear. For nonlinear maps, sample paths
densely enough before mapping: a grid line with only two endpoints will remain
a straight segment between its transformed endpoints.

For “explain matrix multiplication,” stage column copies before row arithmetic:
show each colored column beside its basis vector, scale a copy, translate the
other copy tip-to-tail, then reveal the resultant. Copy the same column glyphs
into the sum and use named `\animpart` parts in an explicit `morphTo` map when
rearranging them into row calculations. Preserve the local source columns and
the unchanged equals sign. Named mappings express correspondence; the engine
does not infer algebra or support arbitrary split/merge mappings. Reserve
`\animnum` slots for genuine varying numbers instead of replacing an entire
formula each frame. Use a common font scale, including inside fractions.
The versioned `demo/expansion/shear.js` and `matrix-transport.js` show the longer
construction, with reviewed operation evidence linked from the proof index.

#### Function plots and a visible residual

For “show how a parameter changes a prediction,” use a quiet plane, a sampled
function, the selected observation, and a segment that measures the difference.
Supply the function, domain, units, sample count, and the parameter schedule.
Reveal the curve, select one x coordinate, connect prediction to observation,
then change the parameter while preserving both endpoints' meaning.

```js scene
export default scene({end:'hold'}, s => {
  const p=s.plane('plot',{xRange:[0,4],yRange:[0,1.2],
    origin:[-4,-2],scale:[2,3],ticks:false,
    grid:{stroke:Color.GREY,opacity:.16}});
  const weight=t=>.6+.8*Math.max(0,Math.min(1,(t-1)/2));
  const predict=(x,t)=>1/(1+Math.exp(-(weight(t)*x-2)));
  const points=t=>Array.from({length:65},(_,i)=>
    p.toWorld([4*i/64,predict(4*i/64,t)]));
  p.curve('initial',x=>[x,predict(x,0)],[0,4],65,
    {stroke:Color.GREY,opacity:.3});
  const curve=s.path('prediction-curve',{points:points(0),stroke:Color.BLUE});
  s.bind(curve,[s.time],t=>({points:points(t)}));
  s.circle('observed',{position:p.toWorld([2,1]),radius:.07,fill:Color.TEAL});
  const marker=s.circle('predicted',{radius:.07,fill:Color.YELLOW});
  const residual=s.line('residual',{points:[p.toWorld([2,predict(2,0)]),
    p.toWorld([2,1])],stroke:Color.WHITE});
  s.bind(marker,[s.time],t=>({position:p.toWorld([2,predict(2,t)])}));
  s.bind(residual,[s.time],t=>({points:[p.toWorld([2,predict(2,t)]),
    p.toWorld([2,1])]}));
  p.label('observed-label','y=1',[2,1],[.4,.2],{fill:Color.TEAL});
  const label=s.latex('weight',{tex:'w=\\animnum{w}',numbers:{w:.6},
    numberFormat:{digits:1,decimals:1},position:[-2,2],fill:Color.YELLOW});
  s.wait(1);
  s.play(label.countTo({w:1.4}),{duration:2,ease:'linear'});
  s.wait(1);
});
```

The line endpoints and marker use the same prediction function and clock.
The weight slot uses the same linear interval. Do not interpolate a displayed
squared error independently with the weight: that would generally disagree
with the nonlinear residual between endpoints. Use sampled matching values,
or reveal its exact value only at the held endpoint as the accepted
`logistic-residual-3b1b.js` does. State that an authored parameter sweep is an
illustration, unless actual optimization steps were supplied. This example
does not fit a classifier or establish that squared error is its training loss.
Split a curve at discontinuities; the plane curve helper requires finite
points and does not infer gaps or asymptotes. Keep retained point counts fixed.

#### Graph traversal and compact frontiers

For “explain Dijkstra's next choice,” use authored graph positions plus a queue
of candidate routes. Supply unique node/edge IDs and finite nonnegative weights.
`s.dijkstra` produces immutable events and frontier snapshots; `s.graph` makes
addressable nodes, edges, labels, weights, and numeric cost slots. Neither
chooses a layout or schedules the explanation. Trace order is algorithm time;
the author's plays and holds determine presentation time.

```js scene
export default scene({end:'hold'}, s => {
  const data={directed:true,nodes:[{id:'A',position:[-2,1]},
    {id:'B',position:[0,1]},{id:'C',position:[0,-1]}],edges:[
    {id:'AB',from:'A',to:'B',weight:1},
    {id:'AC',from:'A',to:'C',weight:5},
    {id:'BC',from:'B',to:'C',weight:1}]};
  const trace=s.dijkstra(data,'A');
  const graph=s.graph('search',data,{costFormat:{digits:1,decimals:0}});
  const queue=s.compactQueue('frontier',[
    {id:'via-A-B',value:'B: 1'},{id:'direct-C',value:'C: 5'},
    {id:'via-B-C',value:'C: '+trace.distances.C}],
    {origin:[3,1.5],initialOrder:['via-A-B','direct-C'],width:1.7});
  s.play(graph.state('A','settled',{fill:Color.TEAL}),{duration:.4});
  s.play(graph.state('B','active',{fill:Color.YELLOW}),{duration:.4});
  queue.remove('via-A-B',{start:.8,duration:.6});
  s.wait(.6);
  const accepted=trace.events.find(e=>e.type==='relax'&&e.edge==='BC'&&e.accepted);
  s.play(graph.edges.get('BC').animate({stroke:Color.YELLOW}),{duration:.4});
  s.play([graph.costs.get('C').fadeIn(),
    graph.costs.get('C').countTo({cost:accepted.cost})],{duration:0});
  queue.insert('via-B-C',0,{start:1.8,duration:.6});
  s.wait(.6);
  s.play(graph.state('C','frontier',{fill:Color.BLUE}),{duration:.4});
  s.wait(1);
});
```

This excerpt begins after A's two outgoing candidates have been inserted and
ends with both candidates for C visible. A complete search must later pop the
cheaper candidate and show the obsolete entry being discarded as stale. Do not
change `direct-C` into `via-B-C`: equal destinations can represent different
route identities. For a general graph, build the record pool from trace events
and preserve a stable ID per candidate. Inspect the `pop`, accepted/rejected
`relax`, `stale`, and `frontier` events rather than inferring decisions from color.

Set costs with zero-duration `countTo` at decision boundaries; a smooth count
would display costs the algorithm never held. `graph.state` records the authored
semantic state and returns the supplied style animation; it has no automatic
state palette. Use explicit styles. Its `states` map describes authored state,
not a query of the currently displayed frame. Edge weights remain immutable.

Compact queues preserve survivors' relative order while shifting contiguous
slots, fading arrivals in, and carrying departures out. Their fixed pool and
transition count are each bounded to 256. They do not sort or update values.
Schedules are absolute and nonoverlapping; queue methods do not advance the
scene cursor, so `wait` or plays must cover their ending times. The helper owns
wrapper position/opacity; animate custom child content for per-record emphasis.
Declare dimensions large enough for that content. For an arbitrary permutation,
use collections instead. Graph limits are 256 nodes and 2,048 edges; self-loops
and parallel/opposite overlapping edges are unsupported. See the current
`compact-frontier-3b1b.mjs` generator for the reviewed full operation.

#### Stable identity in collections

For sorting, row operations, inventory changes, or repeated equal values, make
identity separate from value. Supply an ID for each item, its value or custom
unparented handle, and dimensions that enclose its content. For a swap, expose
the chosen items, separate their paths into lanes, move, settle, and hold.
Moving the same wrappers preserves labels and other attached content.

```js scene
export default scene({end:'hold'}, s => {
  const left=s.group('red-content',[
    s.circle('red-dot',{radius:.18,fill:Color.RED}),
    s.text('red-value',{text:'7',position:[.45,0],fontSize:.3})]);
  const right=s.group('blue-content',[
    s.circle('blue-dot',{radius:.18,fill:Color.BLUE}),
    s.text('blue-value',{text:'7',position:[.45,0],fontSize:.3})]);
  const row=s.collection('row',[
    {id:'first-seven',value:7,handle:left},
    {id:'second-seven',value:7,handle:right}],
    {origin:[-1,0],width:1.3,height:.6,gap:.7});
  row.swap('first-seven','second-seven',{start:.7,duration:1.6,clearance:.3});
  s.wait(3.3);
});
```

`swap` and complete `reorder` use absolute schedules and do not advance the
timeline. Reorder must include every existing ID exactly once; it is not an
insertion API. Collections support horizontal and vertical orientation. Keep
custom content about its local origin and include its full size in width/height
for lane clearance. Handles must belong to the same scene/view and have no
existing parent. Preflight is read-only and covers ownership/IDs before wrapping;
it is not rollback for arbitrary author callbacks. `slots` describes the final
scheduled arrangement. Inspect evaluated frames for intermediate slot positions.
The accepted matrix transport and equal-value swap examples demonstrate this
identity rule beyond simple rectangles.

#### Scientific traces and projected state

For “turn measurements into a state trajectory,” begin with the actual aligned
traces and a shared time cursor. Supply sample times, the N-component vectors,
units, missing values, and an explicit 3×N projection. Establish which trace
value becomes which vector entry, then carry the same state into the projected
point and trail. Preserve component colors across traces, entries, and axes.

```js scene
export default scene({mode:'3d',end:'hold'}, s => {
  const data=s.sampledState({times:[0,1,2,3,4],
    values:[[0,0],[1,.4],null,[1,1],[2,.5]],
    projection:[[1,0],[0,1],[.4,-.3]]});
  data.segments.forEach((run,i)=>{
    const trail=s.path('run-'+i,{points:data.prefix(i,0),
      stroke:Color.BLUE,strokeWidth:.03});
    s.bind(trail,[s.time],t=>({points:data.prefix(i,t),
      opacity:t>=run.start?1:0}));
  });
  const marker=s.sphere('state',{radius:.09,fill:Color.YELLOW});
  s.bind(marker,[s.time],t=>{
    const value=data.at(t);
    return {position:value?value.position:[0,0,0],opacity:value?1:0};
  });
  s.play(s.camera.to3D({yaw:.35,pitch:.3,target:[1,.5,0],height:4}),
    {duration:.5});
  s.wait(3.5);
});
```

Samples are copied; times strictly increase and nonmissing vectors have the
same dimension. `at` interpolates those vectors linearly and applies the supplied
projection. It returns null outside the domain or across missing intervals.
`prefix` repeats its endpoint to preserve each run's vertex count and never
bridges a gap. Preserve the missing interval in both the trace and marker; do
not silently interpolate through it. The example's data are synthetic.

For event-to-rate explanations, supply event times and declare the smoothing
kernel, bandwidth, and units. First show each event's kernel, then their sum,
then sample all rates at one time to form the state vector. The accepted
`artem-state.js` uses Gaussian kernels normalized to one event over the real
line; its displayed finite window need not contain the entire integral.
Bandwidth changes the representation and should not be presented as a measured
physical property. Use `countTo` tracks with `ease:'linear'` at the same sample
knots for numeric entries, matching the sampled state's interpolation; retained
bindings cannot update numeric slots. Do not call a projection
a recovered manifold or infer neural dynamics from a synthetic trail. The
`neural-trajectory.js` example explicitly projects five supplied components into
three; different original states may coincide in the displayed point.

Keep these limits in the input plan: 1–64 components, at most 20,000 samples,
and at most 20,000 total component slots including gaps. Inputs and projected
coordinates must remain finite and within the documented magnitude bounds.
Large measurements should be selected/resampled on the host with provenance
before becoming scene literals. The current `science-3b1b.mjs` generator stages
the longer event/rate/state, logistic, and trajectory examples.

#### Surfaces, fields, and informative views

For “show a field on a shape,” choose whether height, scalar color, or arrows
carry the quantity. Supply a finite domain, sample resolution, units, and scalar
range. `s.surface` samples z=f(x,y); `s.parametricSurface` samples a two-parameter
map. A heat display can use a flat surface and a scalar callback for temperature.
For a vector field, build a bounded grid of ordinary `arrow3D` elements from
explicit sample positions/vectors; there is no automatic field integrator.
Normalize arrows only if the legend explains that length no longer means speed.

```js scene
export default scene({mode:'3d',end:'hold',lighting:'studio'}, s => {
  s.surface('height',{fn:(x,y)=>Math.sin(x)*Math.cos(y),
    xRange:[-2,2],yRange:[-2,2],xSegments:16,ySegments:16,
    fill:Color.WHITE,shading:'smooth',
    scalar:{fn:(x,y,z)=>z,domain:[-1,1],colors:[Color.BLUE,Color.WHITE,Color.RED]},
    clipPlanes:[{normal:[1,0,0],offset:.8,
      section:{color:Color.YELLOW,width:.03}}]});
  s.text('cut-label',{text:'Section',position:[.8,0,1.1],
    billboard:true,labelOcclusion:'overlay',fontSize:.28,fill:Color.YELLOW});
  s.play(s.camera.to3D({yaw:.35,pitch:.65,height:6,distance:10}),{duration:1});
  s.wait(1);
  s.play(s.camera.animate({yaw:1.05,pitch:.35}),{duration:1.5});
  s.wait(1);
});
```

Show the shape before moving the camera; move only far enough to answer an
occlusion or depth question, then hold. Camera `perspective`, height, target,
distance, yaw, and pitch support deliberate 2D/3D transitions. `s.view` creates
independent regions with their own camera and optional orbit; supply rect as
fractions `[left,top,width,height]` and author each view's objects in its callback.
A second view is another representation to synchronize, not an automatically
mirrored copy of the first. During authored camera motion the player owns the
camera; do not depend on viewer orbit to explain the essential operation.

Clipping retains `dot(normal,localPosition)<=offset`; planes move with their
object. Sections follow sampled triangle intersections, not analytic level sets.
Caps require closed, nonbranching loops; an open height surface has no guaranteed
cap. For a genuine solid cutaway, use a closed mesh/solid and explicitly request
a cap. Matching normals and equal plane-list lengths permit offset interpolation
in mesh/sphere morphs. Use ordinary control rebuilds for other plane edits.
An `outline` is selected feature edges; ordinary mesh `stroke` is the wireframe.

Scalar colors need an explicit fixed domain and 2–16 palette stops. Author a
legend when values matter; none is generated. Raw meshes need one value per
vertex. Colors interpolate across triangles, so refine the mesh where the field
changes quickly rather than expecting interior contour bands. `s.deform` moves
vertices but does not infer a new measured scalar array from the deformation.
Do not claim temperature evolution or fluid motion without supplied equations
or samples; these helpers display the authored field.

Choose label depth deliberately: `depth` tests glyph triangles, `overlay` stays
readable over geometry in its view, and `hide`/`fade` use the transformed anchor's
occlusion by opaque fills in that view. Billboard text faces the camera but can
still occlude other labels. There is no automatic collision placement. Keep
essential local annotations sharp and inspect both frontal and oblique frames.

Use a world-space directional light when object orientation relative to the
light is part of the explanation; camera-space lighting is useful for stable
shape readability. Planar shadows establish a relation to one receiver plane,
not general self-shadowing. Optical focus is optional: animate complete
`focus:{distance,aperture,samples}` values, with distance measured along camera
forward and samples fixed at 8, 16, or 32 during the change. Aperture zero
restores the pinhole path. A focus pull should expose a depth relation, never
hide the active construction. WebGL focus requires its float-color extension;
test the intended backend and export configuration before relying on it.

#### Reusable images, models, and parts

For an illustration, apparatus, repeated prop, or textured contextual object,
ask first whether editable procedural geometry is sufficient. Use host-prepared
assets when substantial immutable geometry/pixels would otherwise be repeated
in source. Supply asset inventory, bounds, units, named parts, source/license,
and any simplification or schematic changes. Scene code cannot download or
decode files. Keep contextual assets quieter than the moving explanatory object.

Prepared images use `s.image(id,{asset,width,...})`. The host must register their
RGBA8, encoded-sRGB, top-left, straight-alpha pixels and opt into
`colorPolicy:'source'`. Default image color is untinted; explicit palette tint
multiplies source color. Width alone preserves aspect ratio. Prepare an original
or licensed cutout outside the scene, then move/scale/fade the same image handle;
do not use a reference film frame as the scene background.

Both prepared models and GLB models use `s.model` and return handles with
`part` and `tintTo`, but their data and material contracts differ. Prepared assets
use descriptor part IDs, ordinary mesh style and children such as `rig.body`.
Their tint changes ordinary fill; an image texture retains its own explicit
tint. GLB parts use stable node IDs or unique names, children such as
`rig/node-2`, and imported material color multiplied by tint. GLB `WHITE` restores
untinted materials. Do not assume that whitening a prepared mesh recovers an
earlier palette fill. Explicit `source:'prepared'` or `'glb'` resolves an ID
present in both inventories.

To open an assembly, inspect its published bounds and part pivots, instantiate
once, hold the intact prop, move the chosen part relative to its parent, and
hold the exposed mechanism. GLB part rotations use model axes around the
imported pivot; they are not the original node's rotated local axes. Use
recorded initial positions to restore the assembly. Imported static models
do not acquire skinning, deformation, or animation-clip playback from `part`.
Use native geometry for an actual topology-changing explanation.

The prepared path supports a narrower image/material subset than the GLB path.
Do not copy prepared-image restrictions onto GLB: imported GLB supports its
documented normal/material maps, UV sets, and embedded PNG/JPEG subset. Conversely,
GLB capabilities do not grant image normal maps to ordinary procedural shapes.
`s.modelInfo` inspects prepared descriptor metadata; use host-published metadata
for GLB inventory. A descriptor/catalog alone lets code compile but cannot
supply renderable pixels or triangles. Keep the host registry/resources alive
for playback and backward seeking, and dispose players/sequences when finished.

#### Persistent objects, controls, and export

For a multi-step explanation, keep the result that the next step actually uses.
Use `s.keep(handle)` in the outgoing scene and `s.previous.get(id)` in the
incoming one. The incoming scene owns entry, movement, and removal; its local
clock starts at zero. Keep a group/model root when its whole construction must
survive. Use `s.previous.exiting()` for outgoing transient content. Stable IDs
are the contract; creating a new unrelated object with similar text is not an
identity handoff. A host can choose `handoffFrom` or an independent scene.

For interactive parameters, use ordinary sliders/toggles/selects when values
change topology, labels, branching, sample resolution, or asset selection.
Ordinary controls rebuild at the current scene time. Use a reactive slider and
`s.bind` for supported properties with stable identity; use `s.deform` only when
vertex count and triangle indices/order/winding stay fixed. A rigid part should
move with a transform, not regenerate all its vertices every frame.

```js scene
export default scene({end:'hold'}, s => {
  const height=s.slider('height',{reactive:true,default:1,min:.3,max:2});
  const dot=s.circle('moving-point',{radius:.09,fill:Color.YELLOW});
  const guide=s.line('guide',{points:[[-2,0],[2,0]],stroke:Color.GREY});
  s.bind(dot,[s.time,height],(t,h)=>({position:[-2+4*Math.min(t/2,1),h]}));
  s.bind(guide,[height],h=>({points:[[-2,h],[2,h]]}));
  s.keep(dot);
  s.wait(3);
});
```

Express callbacks as functions of current absolute time and inputs. Do not
increment a hidden counter, integrate from the last rendered frame, call wall
clocks, or create geometry inside a binding. Seeking may request times out of
order. Let one mechanism own a property in a given interval; do not bind a
queue wrapper position or animate the same property independently. Build a
timeline from meaningful stages and holds; never speed it up merely to reach
a render budget. Retained bindings optimize supported work, not every possible
scene operation. Unsupported changes belong in a rebuild or host preparation.

For offline frames, use the scoped sampler so retained time callbacks are alive
at each requested time. A plain evaluated snapshot does not run new retained
callbacks. This host example requires an existing complete `source` string;
it reports metadata and does not itself render or encode pixels.

```ts host
import { withOfflineScene } from 'animlib/core';
// Input required: source is a complete scene source string.
await withOfflineScene(source, {}, async sampler => {
  for (const time of [0, sampler.scene.duration / 2, sampler.scene.duration]) {
    const frame = sampler.sample(time);
    console.log(time, frame.elements.length);
  }
  // A renderer must prepare with sampler.scene AND sampler.assetGeometry.
  // Consume all required frames inside this callback.
});
```

The sampler clamps finite times; an omitted time samples the outgoing endpoint.
Pass prepared `modelAssets` in its fourth argument when needed. Consumption
after the callback closes is invalid because the scope releases its VM and
asset leases. Native `tools/render-frames.mjs` and `tools/render-video.mjs` use
the library's rendering path and require a working native WebGPU adapter;
video export also needs FFmpeg. `render-video.mjs` produces silent H.264 with
caption sidecars and rejects scenes declaring audio. For narrated films, use
a separate host audio-mux workflow and verify its alignment explicitly.
Generate a manifest/source first, render to a fresh output path, and preserve
the reviewed inputs. A generator that writes a manifest has not rendered a film.

Before delivery, sample setup, interior motion, event boundaries, final hold,
and a reverse seek. Inspect native frames at the delivery aspect ratio; check
labels and invariant geometry separately from source compilation. Decode the
final film and verify duration, frame rate, dimensions, and requested audio.
Compilation/default execution uses a 200 ms budget and 32 MiB VM; a separately
reported diagnostic limit can investigate load, but must not masquerade as a
default-budget pass. Current reviewed films demonstrate bounded operations,
not arbitrary-scale performance or acceptance of every derivative scene.

### Molecular and biological animation recipes

#### Choose the representation that carries the biological claim

Start with the operation the viewer must understand: identifying a chain,
exposing a binding pocket, bending a backbone, matching a codon, or severing
and replacing an edge. The molecule itself is the explanatory world. Use the
current 3Blue1Brown construction language: persistent identities, restrained
semantic colors, visible intermediate operations, local labels and reading holds.
Borrow biological references' approach/dock/transfer timing and spatial staging;
do not borrow their surface-heavy art by default or add arbitrary coordinate axes.

| Question to show | Representation and actual API | Input and scientific scope |
| --- | --- | --- |
| Where are a small set of sites? | `s.molecule(id,props)` | Packed XYZ, uniform display radius; batches, no per-site handles or bond inference |
| Which atoms/residues connect? | `s.molecularBackbone(...,{representation:'sticks'})` | Explicit stable IDs and bond pairs; cylinders do not encode bond order |
| How does a chain bend? | `representation:'backbone'` plus `s.articulatedChainPose` | Ordered uninterrupted segments; prescribed fixed-length serial links |
| What is the deposited multichain arrangement? | Host `importPDBStructure`, then scene beads/sticks/backbone or prepared models | Legacy PDB, retained experimental coordinates, explicit gaps; no inferred assembly |
| What is the overall organic shape? | Host `createMolecularEnvelope` / `createMolecularEnvelopeParts`, then `s.mesh` / `s.model` | Schematic Gaussian contour around supplied sites; static unless separately authored |
| How can local peptide torsions change a chain? | `s.peptidePose(spec,phi,psi)` | Original component templates, explicit link geometry and torsions; no folding prediction |
| How does paired DNA open? | `s.nucleicDuplex(props,opening)` | Explicit antiparallel complementary sites, frame and opening window |
| How does transcription advance? | `s.nucleicTranscriptionCycle(props,time)` | Mapped DNA/RNA IDs, absolute arrivals/docking, moving opening and authored exit |
| What changes at a splice or pore? | `s.nucleicSplice` / `s.nucleicThread` | Explicit graph edits or polyline transport, with their separate distance guarantees |
| How does a complete translation cycle progress? | `s.nucleicTranslationCycle(props,time)` | AUG, standard-code sense codons, one terminal stop, explicit carrier/cargo IDs |

`s.molecule` and `s.molecularBackbone` create scene handles. The `...Geometry`,
`...Pose`, and nucleic helpers return geometry/data; they do not create visible
elements for you. The host equivalents are exported from `animlib/core` through
the `createMolecularBackboneBuilders`, `createPeptideBuilders`,
`createNucleicBuilders`, `createNucleicProcessingBuilders`,
`createNucleicTranscriptionCycleBuilders`, and `createNucleicTranslationBuilders`
factories. Importing PDB, reading files, generating envelopes and decoding assets
happen on the host, never inside scene source or a retained callback.

The complete examples below are JavaScript scene sources with no external assets.
Their small geometries are deliberate teaching fixtures. Input-dependent host
recipes are marked separately; they require the stated files or selected catalog.

#### Small molecules: explicit sites, explicit bonds, one shared frame

For a few sites, separate spheres make individually highlighted atoms convenient.
For hundreds or thousands, use batched `s.molecule` calls by display color/radius.
Use a sticks batch for explicit connectivity; absence of a bond means no cylinder.
Keep molecule IDs separate from atom IDs, and retain atom IDs across representations.
Do not infer chemistry from nearest neighbors or draw all nearby points as bonds.

This original three-site diagram establishes two bonds, then turns the *entire*
construction coherently. The dimensions are illustrative world units, not a
measured water geometry; the colors carry explanatory roles, not an asserted
element-color convention.

```js scene
export default scene({mode:'3d',end:'hold'}, s => {
  const atoms = [
    {id:'center',position:[0,0,0],value:0},
    {id:'left',position:[-1.2,.8,0],value:1},
    {id:'right',position:[1.2,.8,0],value:1},
  ];
  const provenance = {kind:'schematic',source:'Original three-site diagram',units:'world'};
  const bonds = s.molecularBackbone('bonds', {
    segments:atoms.map(a=>({id:'site-'+a.id,chainId:'M',residues:[a]})),
    bonds:[['center','left'],['center','right']],representation:'sticks',
    radius:.055,initialNormal:[0,0,1],colors:['WHITE','WHITE'],provenance,
  });
  const center = s.molecule('center-bead', {
    positions:atoms[0].position,radius:.24,detail:2,fill:'YELLOW',
  });
  const ends = s.molecule('end-beads', {
    positions:atoms.slice(1).flatMap(a=>a.position),radius:.17,detail:2,fill:'BLUE',
  });
  const molecule = s.group('molecule',[bonds,center,ends]);
  s.play(s.camera.to3D({height:4,distance:15,yaw:0,pitch:0}),{duration:0});
  s.wait(1);
  s.play(molecule.rotateTo([.2,.65,0]),{duration:2,ease:'smooth'});
  s.wait(1);
});
```

To highlight one site in a batch, overlay a small separate marker at the same
anchor, or split that site into its own batch. A batch has no atom selection
handle. Use the same coordinate origin and world-units-per-coordinate-unit scale
for beads, sticks, labels and surfaces. For bonds with double/aromatic metadata,
author the appropriate visual convention explicitly: the sticks helper draws
single cylinders and does not chemically interpret bond-order metadata.

#### Deposited complex proteins: import, preserve gaps, select, then stage

For a complex protein, first decide whether the request is an existing conformer,
a comparison of conformers, a supplied biological assembly, or an illustrative
motion. A single deposited endpoint does not supply a folding trajectory.
Treat an unresolved loop as missing evidence, not an invitation to connect a tube.

Use `importPDB` for compact positions only. Its default residue selection keeps
protein CA and nucleic P sites; `selection:'heavy-atoms'` keeps ATOM heavy atoms.
Use `importPDBStructure` when atom/residue IDs, insertion codes, segment breaks,
bond provenance, or representation correspondence matter. Both are host imports
of legacy PDB, first model, with deterministic residue-wide alternate selection.
Both exclude HETATM, hydrogen/deuterium and zero occupancy. Consequently ligands,
water, modified HETATM residues, and many cofactors need a separate supplied input.
Neither parser is mmCIF, a secondary-structure assignment tool or an assembly builder.

The structure importer takes `source`, optional `accession`, `chains`, supplied
versioned `residueTemplates`, and optional `polymerLinks:'standard-peptide'`.
That last option explicitly permits a standard peptide edge only under its
continuity and C–N distance checks; it does not fill missing intraresidue bonds.
Without templates or CONECT, an atom-stick view can legitimately contain very
few edges. Retain `diagnostics`, `breaks`, `bonds[].sources` and provenance.

The following Node host recipe runs from repository root after building animlib.
Save it as an `.mjs` file in the root and run it with an existing PDB path and
output scene path. It deliberately renders a residue backbone, needing no bond
dictionary. Add supplied templates only when requesting an atom-stick view.

```ts host
import {readFile,writeFile} from 'node:fs/promises';
import {importPDBStructure,structureBackboneProps,compileSource} from 'animlib/core';
const [pdbPath,scenePath] = process.argv.slice(2);
if (!pdbPath || !scenePath) throw Error('Supply input.pdb and output-scene.js');
const structure = importPDBStructure(await readFile(pdbPath,'utf8'),{
  source:pdbPath,polymerLinks:'none',
});
const mapped = structureBackboneProps(structure,'residues',.3);
const chains = [...new Set(mapped.segments.map(segment=>segment.chainId))];
const extent = Math.max(...structure.atoms.map(a=>
  Math.hypot(...a.position.map((v,k)=>v-structure.center[k]))));
const scale = 3/Math.max(extent,1);
// Large structures: select the chains needed for the question before embedding.
const source = `export default scene({mode:'3d',end:'hold'},s=>{
  const mapped=${JSON.stringify(mapped)},chains=${JSON.stringify(chains)};
  const colors=['BLUE','TEAL','YELLOW','GREY'];
  for(let i=0;i<chains.length;i++){
    const segments=mapped.segments.filter(segment=>segment.chainId===chains[i]);
    s.molecularBackbone('chain-'+i,{...mapped,segments,
      representation:'backbone',radialSegments:6,samplesPerLink:2,
      colors:[colors[i%colors.length],colors[i%colors.length]],scale:${scale}});
  }
  s.play(s.camera.to3D({height:8,distance:20,yaw:.25,pitch:.1}),{duration:0});
  s.wait(1);s.play(s.camera.animate({yaw:.6}),{duration:2});s.wait(1);
});`;
await compileSource(source); // Uses normal production limits; may reject large selections.
await writeFile(scenePath,source);
await writeFile(scenePath+'.structure.json',JSON.stringify(structure,null,2));
console.log({chains,breaks:structure.breaks,diagnostics:structure.diagnostics});
```

The residue mapper initially returns `representation:'beads'` and `bonds:[]`;
the recipe explicitly requests `backbone`. Tubes follow each uninterrupted
segment separately. Singleton segments generate no tube; retain beads if those
sites matter. Atom mapping instead returns singleton atom segments and explicit
structure bonds with default `representation:'sticks'`. Do not turn singleton
atoms into one long backbone: atom ordering is not polymer adjacency.

The complete workflow for a new real multichain protein is:

1. Record source accession/path, original bytes/hash, model/conformer choice,
   units, selected chains and whether the input is an asymmetric unit or an
   already supplied assembly. Convert mmCIF offline with an appropriate parser.
2. Import once; inspect all break reasons and the retained residue/atom counts.
   Preserve author numbering and insertion codes in lookup tables. Never renumber
   across gaps to make a tube continuous. Keep unsupported polymers as beads or
   provide a separately validated adjacency source; do not assert peptide links.
3. Choose one shared origin, normally `structure.center`, and one display scale.
   Centering each chain independently would destroy the deposited complex.
   Filter a mapped model by chain or domain while preserving segment boundaries.
   If filtering atoms, remove bonds whose endpoints were filtered out.
4. Establish the whole complex with quiet chain colors. Highlight a selected
   chain/interface; hold the view before exposing its residues or contact model.
   Use deposited positions for all three representations of the same conformer.
5. Prepare a schematic envelope only when mass or an interior cavity helps.
   Preserve the original coordinate data beside the mesh. Keep separate chain
   envelopes if chains must move independently; a fused envelope cannot separate.
6. Cross-fade beads/sticks/envelope in the common frame while the molecule is
   stationary. Hold common landmark residues through the change. Do not morph
   unrelated mesh vertices and call it a representation correspondence.
7. Add interface labels and authored measurements from the selected coordinates;
   state the units and what sites were measured. A CA distance is not an atom
   contact or an affinity. Use a local ruler only when distance is the question.
8. If a second measured conformer is supplied, perform an explicit host alignment
   using the stated matched IDs. Disclose unmatched residues and the alignment.
   A linear coordinate interpolation can shrink bonds; use it only as a labeled
   illustrative interpolation, not as a physical transition path.

For heavy deposited complexes, prefer prepared static parts and only a sparse
dynamic region. Selecting an interface, lowering detail, or splitting the lesson
is usually clearer than drawing every atom. Never solve compile failures by
raising the production VM timeout or silently deleting inconvenient residues.

#### Reuse biological packages and prepare new surfaces on the host

The current biological fixture tree contains **44 native version-1 model/image
packages**; the entire fixture tree additionally contains Suzanne packages.
This count excludes rig, staging, source-lock, structure, and conversion-report
JSON. Discover manifests rather than guessing asset IDs from directory names.
The [biological fixture catalog](../fixtures/biological/README.md) records each
family, preparation command, scientific status and image dependencies.

Useful families include deposited `1crn`, original `illustrative-peptide`,
endpoint-derived `peptide-surface-revision4`, nucleotide anatomy, polymerase
context, transcription, RNA processing, and translation. Current accepted
mathematical proofs use sparse native geometry; optional historical surfaces
remain reusable geometry, not the default visual direction or a style preset.

This repository-root Node host discovery snippet prints only real package IDs
and paths. Select a small set, including referenced image packages, from its output.

```ts host
import {readdir,readFile} from 'node:fs/promises';
async function packages(root) {
  const found=[];
  for(const entry of await readdir(root,{withFileTypes:true})) {
    const path=root+'/'+entry.name;
    if(entry.isDirectory()) found.push(...await packages(path));
    else if(entry.name.endsWith('.json')) {
      const item=JSON.parse(await readFile(path,'utf8'));
      if(item.version===1 && ['model','image'].includes(item.kind) && item.hash)
        found.push({id:item.id,kind:item.kind,path});
    }
  }
  return found;
}
console.table(await packages('shared/animlib/fixtures/biological'));
```

Load selected manifest paths with the repository Node helper
`loadAssetRegistry(paths,{colorPolicy:'source'})` from `tools/load-assets.mjs`;
the color policy is required when images are included. Pass `registry.catalog`
to `compileSource(source,{assetCatalog:registry.catalog})` for compilation.
Pass the actual registry as `modelAssets` to `withOfflineScene`, `SceneSequence`
or `createPlayer` for evaluation/rendering. A catalog alone has no geometry bytes.
An offline renderer must prepare with both `sampler.scene` and
`sampler.assetGeometry`, and consume frames inside the `withOfflineScene` scope.

In scene source, `s.modelInfo(selectedId)` exposes bounds/counts/parts of the
selected prepared model. `s.model('complex',{asset:selectedId,source:'prepared'})`
creates the model. To style selected parts independently, use each descriptor's
real `part.id` in `s.mesh(...,{asset:{id:descriptor.id,hash:descriptor.hash,
part:part.id},...style})`; then group those handles if they move together.
Never invent semantic part names. In the 1CRN fixture, `residue-N` specifically
means index N in that fixture's `structure.json`, not author residue number N.

Native packages are immutable. Rigid translation/rotation, opacity, clipping and
supported material styles work; retained vertex edits, skinning, skeletal rigs,
asset morphs and arbitrary live surface deformation do not. A static compact
protein surface cannot follow a moving peptide just because both use one ID.
Show the endpoint envelope after the moving chain reaches its matched endpoint.

For a new envelope, host `createMolecularEnvelope({positions,origin,sigma,
isoLevel,resolution,smoothingIterations,maxTriangles})` returns mesh geometry.
Its coordinates are centered on `origin`; use the same origin as your backbone.
`sigma` is in input units (Å for PDB), `isoLevel` is a unitless threshold of
summed visual kernels, and `resolution` is cells on the longest padded axis.
These are display parameters, not electron density or solvent accessibility.
Include all intended sites and record any selection/subsampling policy.

Use `createMolecularEnvelopeParts` for larger static envelopes: extraction and
smoothing happen globally, then geometry is partitioned without dropped faces.
It returns an array of geometries; package each as a native `PreparedModelPart`
with a unique ID, then register it using `createAssetRegistry`. Record units,
source/source hash, creator/license, converter/options, selection, modifications
and fidelity in the required provenance. Use the existing preparation scripts
as package-writing examples; public core exports decode/register packages but
do not offer a scene-side surface preparation service.

#### Cutaways, sequence colors, and anchored molecular labels

Reveal an interior by first establishing its enclosing mass, holding the camera,
then showing the corresponding open cross-section. `clipPlanes` are object-local:
`{normal:[1,0,0],offset:0}` retains local x ≤ 0. A prepared model accepts clipping
and contours through normal mesh processing. Local planes rotate with their
object/group, so a camera orbit is not a moving anatomical slice.

Use `section:{color:'YELLOW',width:.025}` for the actual intersection contour;
add `cap:'GOLD'` only when a filled section explains the interior. Closed,
nonbranching manifold loops support caps; arbitrary open/nonmanifold geometry
does not. Partitioned envelope parts can have open section components at part
seams, so do not assume independently capped parts reproduce one closed solid.
Inspect the full cut; use an unpartitioned suitable mesh or open contour when needed.

`molecularBackboneGeometry` returns `vertexResidueIds` alongside each mesh.
This is the correct bridge from residue-indexed values to displayed vertices.
Its default scalar ramp encodes the input `value` in `[0,1]`; that value need not
be a physical measurement. For measured confidence/temperature/charge data,
join by verified IDs on the host and supply a raw mesh `scalarColors` array with
one value per retained vertex, an explicit domain and named palette colors.
Describe missing data and its display policy. Do not rescale each frame's domain
independently: the same color would then mean different values over time.

Prepared assets cannot receive arbitrary deformed per-vertex arrays. Prepare a
new appropriately colored asset, select semantic parts with explicit fills, or
use bounded inline geometry for a truly dynamic scalar field. Nearest-residue
surface ownership is a declared display mapping, not an electrostatic solver.
Add a small local legend only when the quantitative color interpretation needs it.

For a moving residue, bind a label's position to that residue's returned anchor
using the same origin/scale/rotation as its geometry. `s.attach` to a batched
molecule attaches to the group origin, not to an individual residue. World-space
billboard text can stay readable; `labelOcclusion:'overlay'` deliberately draws
through objects, while depth-sensitive labels can disappear behind the protein.
Choose that policy consciously and use a leader when an offset label could
refer to more than one site. Do not keep dozens of labels equally prominent.

#### Schematic backbone folding with fixed serial-link lengths

Use `s.articulatedChainPose(spec,time)` when the explanatory claim concerns
ordered chain bending and packing, rather than atomic internal coordinates.
`lengths` contains one positive length per link; `from` and `to` contain one
`[bend,twist]` pair per link in radians. The result contains one more anchor
than links. `start`/`duration` set absolute time and clamp endpoint holds.
`origin`, `direction` and `normal` define the initial frame. Each authored
segment retains its declared link lengths through interpolation.

```js scene
export default scene({mode:'3d',end:'hold'}, s => {
  const spec={lengths:[1,1,1,1,1],
    from:[[0,0],[0,0],[0,0],[0,0],[0,0]],
    to:[[0,0],[.8,0],[.8,.35],[.8,.35],[.8,.35]],
    start:1,duration:3,origin:[-2.5,0,0],direction:[1,0,0],normal:[0,1,0]};
  const geometry=t=>s.molecularBackboneGeometry({
    segments:[{id:'continuous',chainId:'A',residues:
      s.articulatedChainPose(spec,t).map((position,i)=>({id:'r'+i,position,value:i/5}))}],
    bonds:[],representation:'backbone',radius:.08,initialNormal:[0,0,1],
    radialSegments:6,samplesPerLink:3,colors:['BLUE','TEAL'],
    provenance:{kind:'schematic',source:'Authored serial-chain bend',units:'world'},
  });
  const initial=geometry(0);
  for(let i=0;i<initial.meshes.length;i++){
    const h=s.mesh('backbone-'+i,{...initial.meshes[i]});
    s.bind(h,[s.time],t=>{const g=geometry(t).meshes[i];
      return {vertices:g.vertices,normals:g.normals};});
  }
  s.play(s.camera.to3D({height:7,distance:20,yaw:0,pitch:.1}),{duration:0});
  s.wait(5);
});
```

The curve between anchors is a display backbone, not a chemically resolved
protein ribbon or a secondary-structure assignment. No collision avoidance,
energy, hydrophobic packing, disulfide closure or knot solver is supplied.
Keep the frame seed away from parallel bond/tangent directions throughout motion;
unsupported reversals should be authored away or split into explicit segments.
Do not translate the final folded chain to recenter it independently each frame
unless that camera/object tracking is a deliberate, disclosed display choice.

For a folding lesson: establish the extended chain and one persistent residue;
form a local coil; hold it side-on; form the next local region; preserve those
coils while introducing an authored packing motion; hold the compact result;
only then switch representation. An unbroken swirl compressing everything at
once hides the causal distinction between local structure and packing.

#### Atomic peptide poses: phi/psi changes with explicit component templates

`s.peptidePose` builds an original idealized peptide from supplied component
templates. Each template needs N/CA/C/O, its explicit backbone bonds, connected
side-chain atoms and nondegenerate coordinates. `peptideLength` uses the template
length units; `angleCA_C_N` and `angleC_N_CA` use radians. Supply dense absolute
phi/psi arrays with one entry per residue; omega is trans. This is more specific
than articulated residue links, but remains prescribed geometry, not dynamics.

The following four-residue fixture uses deliberately schematic template geometry.
It shows actual bond sticks following phi/psi changes and preserves atom IDs.

```js scene
export default scene({mode:'3d',end:'hold'},s=>{
  const spec={residues:Array.from({length:4},(_,i)=>({id:'r'+i,component:'X'})),
    components:{X:{atoms:[
      {name:'N',position:[-1,1,0]},{name:'CA',position:[0,0,0]},
      {name:'C',position:[1.4,0,0]},{name:'O',position:[2,1,0]},
      {name:'CB',position:[0,0,1.3]}],
      bonds:[['N','CA'],['CA','C'],['C','O'],['CA','CB']]}},
    peptideLength:1.33,angleCA_C_N:2.0246,angleC_N_CA:2.1118};
  const geometry=t=>{
    const u=Math.max(0,Math.min(1,(t-1)/3)),v=u*u*(3-2*u);
    const pose=s.peptidePose(spec,Array(4).fill(-2.1+v),Array(4).fill(2.2-3*v));
    return s.molecularBackboneGeometry({
      segments:pose.atoms.map(a=>({id:a.id,chainId:'A',residues:[a]})),
      bonds:pose.bonds,representation:'sticks',radius:.08,radialSegments:6,
      initialNormal:[.321,.456,.789],colors:['BLUE','TEAL'],
      provenance:{kind:'schematic',source:'Original component template and torsions',units:'illustrative'},
    });
  };
  for(const [i,g] of geometry(0).meshes.entries()){
    const h=s.mesh('atoms-'+i,{...g,position:[-4,-1,0],scale:.65});
    s.bind(h,[s.time],t=>{const next=geometry(t).meshes[i];
      return {vertices:next.vertices,normals:next.normals};});
  }
  s.play(s.camera.to3D({height:12,distance:25,yaw:.2,pitch:.1}),{duration:0});
  s.wait(5);
});
```

Bounds are 2–96 residues, 1–8 component types, 24 atoms/32 bonds per component,
and aggregate 1,536 atoms/2,048 edges. Templates with unsupported cyclic or
cross-linked backbone connectivity are rejected. There is no rotamer search,
force field, solvent, collision resolution or automatic sequence-to-fold model.
For a longer staged lesson, reuse the pinned illustrative rig and authored
torsion schedules rather than inventing a residue-name-to-atomic-template API.
Keep the original rig, schedule and endpoint hashes with derived surface assets.

#### Assemblies, docking, ligand binding and molecular motors

Use rigid groups when domains/subunits retain their internal conformation.
For a hinge, prepare local coordinates relative to the hinge pivot, group that
domain, rotate the group, then place the pivot in the shared complex frame.
Rotating an already centered whole protein is not a domain hinge. Show the
stationary domain and hinge contact through the operation; hold the open and
closed states before changing the camera.

A docking recipe is approach → orient → contact hold → optional authored domain
closure → consequence. Use one absolute-time progress function for ligand pose,
contact emphasis and labels. Retain the same ligand ID and receptor frame.
Supply licensed ligand coordinates/topology separately because the PDB importers
exclude HETATM. Label a prescribed trajectory schematic; no affinity, binding
energy, steric avoidance or reaction chemistry is calculated by animlib.

For an oligomer, use explicit externally supplied assembly transforms or authored
schematic copies. Record whether copies are experimentally deposited, assembly
operators, or illustrative. Do not interpret a PDB asymmetric unit as the full
biological assembly. A motor cycle can use grouped heads, a visible track, state
colors and staggered step phases; author pivot/contact points and explain the
held contact during each step. Do not claim ATP-driven kinetics from a timed
translation of meshes. Rigidity, contact timing and world position are separate
invariants that the scene author must check.

#### DNA opening and advancing transcription

`s.nucleicDuplex` requires explicit complementary `template`/`coding` arrays,
one-to-one ID `pairs`, antiparallel directions, an axis point per pair, radius,
backbone radius, twist per base in radians, and an opening window. Its opening
parameter is finite in `[0,1]`. The returned anchors retain site/base/strand/shape
identity, and the declared schematic backbone link lengths are preserved.

```js scene
export default scene({mode:'3d',end:'hold'},s=>{
  const props={axis:Array.from({length:12},(_,i)=>[(i-5.5)*.65,0,0]),
    template:Array.from('ACGTACGTACGT',(base,i)=>({id:'t'+i,base})),
    coding:Array.from('TGCATGCATGCA',(base,i)=>({id:'c'+i,base})),
    pairs:Array.from({length:12},(_,i)=>['t'+i,'c'+i]),
    templateDirection:'3to5',codingDirection:'5to3',initialNormal:[0,1,0],
    radius:.85,backboneRadius:.07,twistPerBase:.6,
    window:{start:2,end:9,separation:1.2}};
  const pose=t=>{const u=Math.max(0,Math.min(1,(t-1)/3));
    return s.nucleicDuplex(props,u*u*(3-2*u));};
  for(const [i,part] of pose(0).parts.entries()){
    const h=s.mesh('duplex-'+i,{...part.geometry,fill:i%2?'TEAL':'BLUE'});
    s.bind(h,[s.time],t=>{const next=pose(t).parts[i];
      return {vertices:next.geometry.vertices,opacity:next.opacity,
        ...(next.geometry.normals?{normals:next.geometry.normals}:{})};});
  }
  s.play(s.camera.to3D({height:8,distance:22,yaw:.1,pitch:.25}),{duration:0});
  s.wait(5);
});
```

Stage paired bases → local opening → exposed template → complementary arrival →
incorporation → emergent RNA. For a fixed fully open template snapshot use
`s.nucleicTranscript`: provide mapped complementary RNA IDs, `start`,
`secondsPerBase`, `approachFraction`, display `radius`, optional `incomingOffset`,
`incomingRotation`, and deliberate `emergence`. Bonds appear only after incorporation.
Emergence validates its whole schedule, including at time zero; a collinear fold
can be rejected. Adjust its direction/distance/duration instead of suppressing it.

Use `s.nucleicTranscriptionCycle` for an advancing machine and moving opening.
Its straight local axis is `{origin,direction,normal}`; it takes DNA pairs plus
a contiguous complementary `transcript` mapping, `radius`, `pitch`,
`twistPerBase`, `baseReach`, `window`, `start`, `cycleDuration`, `dockFraction`,
`exitDirection`, and `rnaLinkLength`. Up to 128 DNA pairs/RNA sites are supported.
The helper returns data, not prebuilt enzyme or nucleotide meshes.

Drive a machine marker from `activeSite.position`; draw incoming bases only from
`rna.visibleIds`; show edges only from `rna.bonds`. Site i arrives exactly at
`start+i*cycleDuration` and incorporates at `start+(i+dockFraction)*cycleDuration`.
The register holds during docking, then advances. Keep a reading hold on the
paired template/RNA bases before the first advance; subsequent cycles may be faster.
Use the same mapped helper clock for DNA, RNA, machine and labels if pausing it.

The moving-opening helper preserves both DNA strand links and formed RNA links.
It may translate exterior DNA while solving axial increments; it does not pin
every external site. `exitFrame:'axis'` supports a stable anatomical exit;
optional `exitBend` creates a bounded circular RNA rail with exact chord lengths.
`window.lockOrientation:true` deliberately rotates the whole DNA transverse phase.
It is a display choice, not world-fixed exterior DNA. Completion does not provide
final DNA closure or enzyme dissociation. Author those separately with stated scope.

#### RNA splicing and pore transport: display the returned graph

Splicing is a topology explanation. Keep every nucleotide identity; remove only
the two boundary edges at the cut, move the retained exons, introduce their new
edge at closure, and let the same intron depart. The helper's `retainedIds` and
`removedIds` are identity sets, not instructions to destroy scene objects.

```js scene
export default scene({mode:'3d',end:'hold'},s=>{
  const props={sites:Array.from({length:12},(_,i)=>({id:'r'+i,base:'A',position:[(i-5.5)*.5,0,0]})),
    intron:{start:4,end:7},initialNormal:[0,0,1],baseReach:.2,joinDistance:.5,
    departure:{translation:[0,2,0],axis:[0,0,1],angle:1.2},
    formation:{start:.03,end:.15,angle:Math.PI,bendDirection:[0,1,0]}};
  const pose=t=>s.nucleicSplice(props,Math.max(0,Math.min(1,(t-1)/7)));
  for(let i=0;i<12;i++){
    const h=s.sphere('site-'+i,{radius:.1,fill:i>=4&&i<=7?'YELLOW':'BLUE'});
    s.bind(h,[s.time],t=>({position:pose(t).anchors[i].backbone}));
  }
  const edges=Array.from({length:11},(_,i)=>[i,i+1]);edges.push([3,8]);
  for(const [a,b] of edges){
    const points=t=>[pose(t).anchors[a].backbone,pose(t).anchors[b].backbone];
    const h=s.line('edge-'+a+'-'+b,{points:points(0),stroke:'WHITE',strokeWidth:.035});
    s.bind(h,[s.time],t=>({points:points(t),opacity:pose(t).bonds.some(
      edge=>edge[0]==='r'+a&&edge[1]==='r'+b)?1:0}));
  }
  s.play(s.camera.to3D({height:7,distance:20,yaw:0,pitch:0}),{duration:0});
  s.wait(9);
});
```

The intron interval is inclusive and interior; each fragment needs at least two
sites. Defaults are `phases:{cut:.2,closeEnd:.7,departEnd:.95}`. Optional formation
requires an initially straight boundary bridge; it conserves analytic material
arc offsets while Euclidean chord lengths change. After formation freezes and
cutting occurs, each fragment is rigid internally. This is not a biochemical
lariat, spliceosome dynamics, or an atomic splice reaction.

For export through a pore, `s.nucleicThread` takes RNA `{id,base,offset}` sites,
an authored polyline `path`, `initialNormal`, `baseReach`, and
`aperture:{center,normal,radius,halfThickness,chainRadius}`. Offsets start at zero,
increase strictly, and the first site leads. The path must cross the complete
slab once and progress strictly along its normal; endpoints must accommodate the
whole chain on opposite sides. `chainRadius` must enclose the displayed base reach.

Use retained beads at returned `anchors[].backbone` and orient bases from returned
tangent/normal frames. The helper preserves arc offsets, not Euclidean link
lengths around corners. Its swept-radius clearance checks the authored polyline;
a straight rendered bond can shortcut a curved path and violate the visual pore.
Tessellate such links along the path or use a straight safe crossing. Draw the
actual aperture and membrane thickness quietly so the passage has visible meaning.
Do not claim transport through an arbitrary detailed pore mesh was collision-tested.

#### Complete translation: initiation, repeated transfer, stop and release

Supply RNA 5′→3′ in complete codons: AUG, zero or more additional sense codons,
then exactly one terminal UAA/UAG/UGA. Every sense codon needs a unique carrier,
unique residue ID, correct three-letter amino-acid name and complementary
anticodon written **3′→5′**. No carrier or residue corresponds to stop.
The standard-code mapping is validated; alternative codes/starts/wobble are absent.

This complete three-residue cycle shows assembled subunit outlines, individual
carriers, RNA, product edges, stop and release. Sparse geometry keeps the transfer
visible. The subunit outlines are original symbols, not deposited anatomy.

```js scene
export default scene({mode:'3d',end:'hold'},s=>{
  const props={sites:Array.from('AUGGGUGCUUAA',(base,i)=>({id:'r'+i,base})),
    direction:'5to3',anticodonDirection:'3to5',carriers:[
      {id:'t0',anticodon:'UAC',residueId:'p0',aminoAcid:'Met'},
      {id:'t1',anticodon:'CCA',residueId:'p1',aminoAcid:'Gly'},
      {id:'t2',anticodon:'CGA',residueId:'p2',aminoAcid:'Ala'}],
    origin:[0,0,0],axis:[1,0,0],normal:[0,1,0],pitch:.5,carrierHeight:1.8,
    peptideSpacing:.45,arrivalOffset:[-3,1,1],exitOffset:[-3,-1,1],
    subunitSeparation:1.5,assembly:{start:0,duration:2},start:3,
    cycleDuration:4,releaseDuration:2,disassemblyDuration:2};
  let last=-1,cached;
  const pose=t=>{if(t!==last){last=t;cached=s.nucleicTranslationCycle(props,t);}return cached;};
  const line=(id,points,color,show=()=>true)=>{
    const h=s.line(id,{points:points(0),stroke:color,strokeWidth:.045});
    s.bind(h,[s.time],t=>({points:points(t),opacity:show(t)?1:0}));return h;};
  for(let i=0;i<12;i++){
    const h=s.sphere('rna-'+i,{radius:.07,fill:'TEAL'});
    s.bind(h,[s.time],t=>({position:pose(t).rna.anchors[i].backbone}));
    if(i)line('rna-edge-'+i,t=>[pose(t).rna.anchors[i-1].backbone,
      pose(t).rna.anchors[i].backbone],'TEAL');
  }
  for(let i=0;i<3;i++){
    line('carrier-'+i,t=>[pose(t).carriers[i].anticodonPosition,
      pose(t).carriers[i].payloadPosition],'BLUE',t=>pose(t).carriers[i].visible);
    const label=s.text('anticodon-'+i,{text:props.carriers[i].anticodon,
      fontSize:.23,fill:'BLUE',billboard:true});
    s.bind(label,[s.time],t=>({position:pose(t).carriers[i].anticodonPosition,
      opacity:pose(t).carriers[i].visible?1:0}));
    const bead=s.sphere('product-'+i,{radius:.13,fill:i===1?'YELLOW':'WHITE'});
    s.bind(bead,[s.time],t=>({position:pose(t).product.residues[i].position,
      opacity:pose(t).product.residues[i].visible?1:0}));
    if(i)line('product-edge-'+i,t=>[pose(t).product.residues[i-1].position,
      pose(t).product.residues[i].position],'WHITE',t=>pose(t).product.bonds.some(
        edge=>edge[0]==='p'+(i-1)&&edge[1]==='p'+i));
  }
  for(let j=0;j<2;j++)line('subunit-'+j,t=>Array.from({length:25},(_,i)=>{
    const a=i*Math.PI/24,p=pose(t).subunits[j].position;
    return [p[0]+2.5*Math.cos(a),p[1]+(j?-.6-Math.sin(a):.4+2.3*Math.sin(a)),-.4];
  }),'GREY');
  for(const key of ['A','P','E'])s.text('site-'+key,{text:key,position:
    pose(0).sites[key].map((v,k)=>v+(k===1?-.8:0)),fontSize:.24,fill:'GREY',billboard:true});
  const stop=s.text('stop',{text:'Stop',fontSize:.3,fill:'YELLOW',billboard:true});
  s.bind(stop,[s.time],t=>({position:pose(t).rna.anchors[10].backbone.map(
    (v,k)=>v+(k===1?-.4:0)),opacity:pose(t).stopRecognized?1:0}));
  s.play(s.camera.to3D({height:12,distance:24,yaw:0,pitch:0,target:[1,1,0]}),{duration:0});
  s.wait(21);
});
```

`assembly.start/duration` finishes before `start`. In each sense cycle, arrival
occupies 0–25%, transfer 30–50%, A→P/P→E movement 50–70%, and prior-carrier exit
70–95%. Initial Met goes directly to P and incorporates at 25%; later carriers
arrive at A and receive the existing peptide at 50%. During transfer,
`product.transfer` names both carriers and progress; do not pretend attachment
remains fixed on one carrier. Product bonds exist only when the helper returns them.

After N sense cycles, the terminal stop interval starts at `start+N*cycleDuration`;
`stopRecognized` becomes true at `start+N*cycleDuration+.2*cycleDuration`. The product
stays on its P-site carrier until release at `start+(N+.25)*cycleDuration`.
Release lasts `releaseDuration`, then separation lasts `disassemblyDuration`.
For the example, recognition is at 15.8s, release starts at 16s, and completion is at 20s;
the final second is a reading hold. Keep the same RNA, carrier and residue
objects; use returned `visible`, `incorporated`, `loaded`, `phase`, `released`
and `complete` state rather than deleting and recreating identities.

Every formed product edge retains `peptideSpacing`. Optional
`productCoil:{radius,twist}` creates an original prescribed helix with exact
adjacent chord lengths; require `2*radius*sin(twist/2)<peptideSpacing`.
RNA follows a prescribed shallow bend and does not promise fixed RNA bond lengths.
The cycle is not a tunnel-collision solver, chemical reaction simulation or
co-translational folding model. Prepared subunits/adaptors can consume its poses,
but their geometry must fit the intended docking frame and remain visually clear.

For a full explanation, add one close reading hold on an actual complementary
codon/anticodon, then widen to the repeated transfer/advance. Drive all elements
from the same helper clock, including any deliberate presentation pause. Show
terminal stop, released peptide and separated subunits before ending; elongation
alone is not a complete translation explanation. The current reviewed longer
recipe is [translation revision 4](../demo/expansion/translation-3b1b-revision4-proof.mjs).

#### Molecular budgets, seek checks and proof scope

Use the lowest geometry detail that preserves the explanatory silhouette.
`s.molecule` accepts at most 10,000 sites per call, detail 0–3, uniform positive
radius, and finite coordinates. `molecularBackbone` accepts up to 10,000 anchors,
20,000 explicit bonds, 3–64 radial segments and 1–32 samples per link. These
helper maxima do not override the stricter scene aggregate or reactive payload.

| Boundary | Relevant limit / authoring consequence |
| --- | --- |
| Individual native mesh | 20,000 vertices and triangles; helpers batch larger output |
| Scene aggregate | 100,000 geometry points and 2,000 element IDs, including repeated asset instances |
| Scene VM | 200 ms default execution, 32 MiB memory, 256,000 source string units |
| Serialization | 8 MiB compiled / 1 MiB reactive string-length ceilings |
| Single envelope preparation | 1–100,000 input sites, resolution 4–64, 0–20 smoothing cycles, 20,000 vertices/triangles |
| Multipart envelope preparation | At most 128 parts, 160,000 triangles, 100,000 global and emitted vertices; 25 million density updates |
| Processing helpers | 2–128 sites; threading path 2–512 points |
| Translation | 6–192 RNA bases, complete standard-code schedule within 86,400 seconds |

Cache a pure pose result by *exact requested time* when many bindings read it,
as in the translation example. This avoids recomputing a full helper per label
without depending on previous frames. Keep mesh count, triangle indices and
vertex ownership fixed through retained deformation. Supply new normals with
changed vertices; a stale normal field can make correct geometry look broken.
Changing bond topology should toggle a fixed pool of edge elements, as in splicing,
instead of returning a different triangle layout in a retained vertex binding.

Before rendering a long biological lesson, compile and sample initial, interior,
event-boundary and final poses with `withOfflineScene`; seek backward to the same
times and compare. Check stable IDs, declared links, graph events, matching
representation origins and source limits. For new authored motions, measure the
invariants relevant to their claim rather than assuming a smooth interpolation
preserves them. Check the close-up and full assembly at both intended aspect ratios.

Then render a short representative transformation: actual docking, transfer,
cut/join or coil formation plus its hold. Inspect occlusion, surface cuts, labels,
color continuity, bond visibility and camera stability. CPU correctness tests do
not establish style or scientific fidelity. The [coverage/evidence index](expansion-index.md)
links accepted proof-specific motion; those acceptances do not certify an arbitrary
new protein, measured folding, atomistic chemistry or channel-wide visual parity.

## 7. Live source submissions

`submit` is the common mutation entry point for the surrounding app, whether the
code comes from an LLM, a file, or an editor. Source IDs and sequence placement
are host-owned metadata; a source still describes exactly one scene.

The submission pipeline:

1. Check source format and parse JavaScript.
2. Run each candidate scene builder in an isolated QuickJS VM.
3. Validate bounded, plain compiled animation data.
4. Reconstruct later scene dependencies using current inputs.
5. Prepare formula geometry, audio assets, and the GPU renderer.
6. Commit the complete candidate sequence atomically and update playback.

In browsers, compilation runs in a module worker so JavaScript building does not
occupy the playback thread. QuickJS remains the isolation boundary inside that
worker. Rendering/geometry preparation still involves the main thread.

Invalid syntax, a missing inherited object, invalid LaTeX mappings, an unknown
audio asset, execution limits, or an unavailable GPU reject the submission.
`SubmitResult` contains diagnostics and the unchanged revision. The previous
valid sequence and its playback remain available. Each successful source
submission increments the revision; control changes do not create source revisions.

Submissions and control changes are serialized. The host can send new code while
the current sequence plays. Browser audio permission is distinct from code
validity: a committed scene may be valid while its attempt to resume audio is
blocked. That is reported in player state rather than undoing valid code.

### Playback after successful changes

- Replacing the active scene restarts it at zero, retaining its controls and
  viewer rotation unless the restart crosses an authored rotation. Its
  playing/paused state is retained where playback is allowed.
- Replacing a preceding scene or inserting before the active scene also restarts
  the active scene, since its reconstructed input state changed.
- Changes strictly after the active scene keep its position.
- A full `load` resets the sequence and its control values and opens paused.
- If an upstream edit breaks a downstream dependency, the whole edit is rejected.
- Manual seeking and navigation pause at the requested position. Normal forward
  playback alone triggers `end: "advance"`.

Use diagnostic `code`, `scene`, and source `line`/`column` where available to feed
errors back to the generating LLM. Parse errors have precise locations. Builder
and asset preparation diagnostics may have less precise locations.

### Execution environment

Submitted source is JavaScript, while the library and its declarations are
TypeScript. A host wanting TypeScript source should transpile it before submission.

QuickJS exposes ordinary JavaScript language features, `scene`, and `math`/`Math`.
It receives no browser DOM, fetch, XMLHttpRequest, WebSocket, Node process, or host
function bindings. Constructing a JavaScript `Function` does not escape that VM.
Imports are unavailable. `Date` and the exposed `Promise` global are disabled;
builders must be synchronous. Randomness is seeded and repeatable.

Each compilation has a default 200 ms VM execution budget, 32 MiB VM memory
budget, and bounded stack. The host can change `executionLimitMs`. Browser-worker
startup has a separate timeout; a failed worker can be recreated on a later
submission. These limits protect the scene-building step; they are not a complete
budget for subsequent TeX layout, tessellation, or GPU allocation.

Current data limits include 256,000 JavaScript string units per source (the
implementation uses `source.length`), 8 MiB compiled JSON string length, 1 MiB
per reactive-update JSON string length, 100 scenes, 2,000 object IDs per
builder, 100 controls, 32 view regions, 10,000 animation tracks, and a 24-hour visual timeline.
SVG path data is limited to 20,000 characters and 20,000 normalized control
points per path. Point arrays are limited to 20,000 entries; added scene geometry
has a 100,000-point budget, including mesh vertices and SVG path control points.
The VM boundary validates finite numbers, geometry sizes, mesh indices, object
lifetimes, and group references. The library intentionally does not expose
arbitrary browser callbacks in the animation data.

The host must serve the worker and WebAssembly assets produced by its bundler.
If using a content security policy, configure it to allow the library's module
worker and WebAssembly runtime. See the [QuickJS embedding documentation](https://github.com/justjake/quickjs-emscripten)
for the VM and memory/interrupt mechanisms.

## 8. One audio track per scene

The host registers audio URLs as assets. Scene code selects an asset ID and has
no network access or URL-loading responsibility:

```ts
const player = createPlayer({
  canvas,
  assets: { narration: { kind: "audio", url: "/audio/intro.wav" } },
});
```

```js
export default scene({ mode: "2d", end: "hold", audio: "narration" }, s => {
  const title = s.text("title", { text: "An introduction" });
  s.play(title.fadeIn(), { duration: 1 });
  s.wait(3);
});
```

Audio is prepared and decoded before sampling a candidate's outgoing frame or
compiling its successor. A scene's duration is the greater of its visual timeline
and audio duration. Shorter audio ends while visual playback continues; longer
audio holds completed timeline animations while `s.time` bindings continue sampling
until the track ends. Retained workers use this prepared duration, including for
seeks and handoffs. The track starts at local scene time zero. There is no
cross-scene audio carry, mixing, or separate audio timeline.

Playback with audio uses the Web Audio clock as its local time source. Pause stops
the source; resume creates a source at the stored offset. Seeking pauses both
audio and visuals and displays the selected frame silently until Play. Restarting
an edited scene restarts its track. Reconstructing preceding scenes never plays
their tracks. Muting preserves synchronization.
If the browser interrupts a running audio context, playback becomes `blocked` at
the synchronized offset; pressing Play resumes the track and visuals there.

Web Audio provides the clock and offset scheduling mechanisms; see the
[Web Audio specification](https://www.w3.org/TR/webaudio/).
Browsers may require a user gesture to start audio. `play()` can reject and player
state becomes `blocked`; pressing Play can retry. The host should handle that
state alongside its transport. See the [browser autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).

## Object bounds

These synchronous host APIs are exported from both `animlib` and `animlib/core`.
They inspect an evaluated `Frame` without a browser or GPU. Pass an element ID or
a group ID; groups include all descendant paint, with nested transforms applied.

```js
import { evaluateScene, getLocalBounds, getWorldBounds, getCameraBounds, getScreenBounds } from 'animlib/core';

const frame = evaluateScene(compiled, 1.25);
const local = getLocalBounds(frame, 'object');
const world = getWorldBounds(frame, 'object');
const camera = getCameraBounds(frame, 'object');
const pixels = getScreenBounds(frame, 'object', { width: 1280, height: 720 });
```

- `getLocalBounds(frame, id, options?)` returns `Bounds3D` with `min` and `max`
  XYZ tuples in the object's own axes. Its position, rotation, scale, and ancestor
  transforms are excluded; descendants retain their relative transforms. For
  screen objects the units are CSS pixels. Local bounds exclude billboard
  orientation and billboard offsets, as well as viewport offsets.
- `getWorldBounds(frame, id, options?)` returns `Bounds3D` after all object and
  ancestor transforms. Billboards use the selected camera. Viewport offsets
  are excluded because they apply after projection.
- `getCameraBounds(frame, id, options?)` returns `Bounds3D` in camera coordinates:
  X increases rightwards, Y upwards, and Z is positive depth from the camera eye.
  World and camera bounds are not clipped by the camera or viewport.
- `getScreenBounds(frame, id, { width, height, ...options })` returns `Bounds2D`
  (`left`, `top`, `right`, `bottom`) in full-canvas CSS pixels, with origin at the
  top left. An object's view is selected automatically. View rectangles,
  billboard offsets, and summed ancestor viewport offsets are included.

Screen bounds clip triangles to camera near/far planes **before** perspective
division, then to the object's view rectangle and the canvas. `clip: false`
preserves offscreen extents while still applying camera near/far clipping.
`width` and `height` must be positive finite canvas CSS dimensions. Other queries
accept optional dimensions for curve tessellation (defaults: 800 × 450).

All four functions accept these `BoundsOptions`:

- `camera`: override the object's authored view camera, including billboard
  orientation. It must be finite, with positive `height` and `distance`.
- `palette`: the host color palette, otherwise the default palette.
- `includeStroke`: defaults to `true`; `false` excludes strokes and arrowheads.
  Text/LaTeX glyphs remain included even when their ink uses the stroke color.
- `includeInvisible`: defaults to `false`; `true` ignores object/group opacity
  and paint alpha for layout. It does not add paint declared as `Color.NONE`,
  resurrect removed elements, or include an absent morph endpoint.

Bounds enclose the renderer's tessellated paint, including current compatible
morph geometry, both painted sides of crossfades, glyph holes, LaTeX anchors and
numeric slots, round strokes, and mesh triangles. Unreferenced mesh vertices are
excluded. Curves and spheres are sampled, and packed geometry uses float32, so
these are rendering bounds rather than exact analytic extrema. Raster
antialiasing can extend slightly beyond them. Queries do not test depth
occlusion or subtract paint hidden by compositing; a box also includes empty
space between glyphs or group children.

Missing IDs, empty/no-paint elements, and invisible or collapsed paint return
`undefined`. Fully clipped or edge-on objects have no screen bounds. An object's
own zero scale does not remove its local bounds. Screen objects have no world or
camera bounds and return `undefined` for those queries. Groups mixing world and
screen paint support screen bounds; other queries throw because the units differ.
Results are detached values and queries do not modify the frame.

The browser player provides `player.getBounds(id, options?)`, with
`space: 'screen' | 'local' | 'world' | 'camera'` (default: `'screen'`). It uses the
displayed frame, live behavior/binding state, active display palette, actual view
dimensions, and effective camera including viewer orbit and pan. The object's
view is selected automatically. Screen results use **view-local CSS pixels**,
matching `player.project(point, view?)` and `player.ray(x, y, view?)`, rather than
full-canvas coordinates. It accepts `includeInvisible`, `includeStroke`, and
`clip`, and returns `undefined` before rendering. Queries after disposal throw.

```js
const pixels = player.getBounds('object');
const world = player.getBounds('object', { space: 'world' });
const local = player.getBounds('object', { space: 'local', includeInvisible: true });
```

These APIs operate on frames or the player; they are not methods on sandboxed
scene-builder handles. Authors supply geometry and transforms through those
handles, and hosts can measure any evaluated scene time using the core APIs.

## Overlap inspection

`detectOverlaps(frame, options)` and `detectSceneOverlaps(compiled, options)` are
host inspection APIs exported from both `animlib` and `animlib/core`. They work in
Node/Bun and browsers without initializing a canvas, DOM, or GPU. They report
**only intersections between glyphs belonging to distinct text or LaTeX
elements**. Shapes may overlap other shapes or text without producing reports.
These APIs do not change scene data, reposition objects, or run automatically
during playback.

```js
import { evaluateScene, detectOverlaps, detectSceneOverlaps } from 'animlib/core';

const frame = evaluateScene(compiled, 1.25);
const overlaps = detectOverlaps(frame, {
  width: 1280,
  height: 720,
  minOpacity: 0.01,
  ignorePairs: [['outgoing-title', 'incoming-title']],
});
const samples = detectSceneOverlaps(compiled, {
  width: 1280,
  height: 720,
  sampleRate: 10,
});
// Or inspect specific local times:
const selected = detectSceneOverlaps(compiled, {
  width: 1280, height: 720, times: [0, 1.25, compiled.duration],
});
```

`width` and `height` must be positive finite **CSS pixel** dimensions of the
intended canvas. Projection depends on these dimensions and aspect ratio.
`minOpacity` defaults to `0.01` and must lie in `[0, 1]`; it includes paint alpha,
ancestor/group opacity, and morph fades. Zero-alpha and degenerate geometry are
always excluded. `palette` optionally supplies the host palette; scene inspection
otherwise uses the compiled scene's palette.

Each `OverlapDiagnostic` contains:

- `elements`: two distinct text/LaTeX element IDs in lexical order. Groups apply
  transforms and opacity; separate text elements within the same group are still
  checked against each other.
- `severity` and `kind`: always `unacceptable` / `text-overlap`.
- `bounds`: `{ left, top, right, bottom }`, the bounding box of actual
  intersections in canvas pixels, with origin at the top left. Multiple disjoint
  intersections can share this bounding box.
- `elementBounds`: the clipped glyph bounds for the two text elements.
- `witness`: a point inside an actual glyph intersection.

Reports are JSON-serializable and pair ordering is stable. One report aggregates
all glyph intersections for a pair of distinct elements. Glyphs and named parts
inside one formula or text element are never compared with each other, including
old/new glyphs overlapping during a morph of that element. Only the text portion
of a shape/text morph participates in detection.

`ignorePairs` optionally excludes intentional text pairs in either order. A group ID matches
all its descendants; `['labels', 'labels']` excludes internal text pairs in that
group while preserving checks against other text. Group membership by itself
does not imply an exclusion.

The detector reuses the renderer's text tessellation, including MathJax glyph
holes, LaTeX anchors/numeric slots, current morph geometry, nested transforms,
billboards, and viewport offsets. Broad bounding-box checks are followed by
positive-area glyph intersections. Overlapping text bounding boxes, empty glyph
holes, and edge-only contact therefore do not by themselves trigger a report.
Geometry is clipped at the camera's near/far planes, each view rectangle, and the
canvas. View-local results are translated to common canvas coordinates, including
collisions with screen labels. Non-text shapes are skipped during tessellation.

This measures **projected text overlap**, including text at different depths.
It does not remove glyphs hidden by another object's depth or by compositing.
Text crossing a border and intersecting shapes are outside the detection scope.
Bounds use logical viewport dimensions; device-pixel rounding and raster
antialiasing can differ slightly at edges. No minimum-clearance/near-miss check
or continuous collision solver is included.

Scene inspection returns `{ time, overlaps }[]` for **only samples with
collisions between settled text**. By default it samples at 10 Hz and includes scene endpoints,
lifecycle events, and track start/end times. `times` replaces that schedule and
must contain finite values within `[0, compiled.duration]`; values are sorted and
deduplicated. Empty `times` inspects nothing. Each call supports up to 100,000
samples; reduce `sampleRate` or split explicit times for larger jobs. Sampling
can miss collisions between inspected frames. Reports use authored cameras and
current compiled controls/bindings.

`detectSceneOverlaps` excludes text affected by an active animation at each sample.
That includes move/style, fade, morph, and numeric-value tracks on the text itself,
tracks on its ancestors, and animations of binding sources (including chained
attachments). This dependency rule is conservative: any active track on a binding
source makes its dependent text ineligible until the track ends. Active camera
tracks exclude world-space text only in the affected view; screen-space labels
remain eligible. Other stationary text is still checked, even while unrelated
elements animate.

A track is active on `[start, start + duration)`. Its exact endpoint is eligible
unless another animation affecting that text starts there. Zero-duration tracks
apply immediately and do not suppress a check. Consequently, transient crossings
and text crossfades are ignored by default, while an overlapping final placement
is reported when the text settles. Explicit `times` use the same policy. Set
`includeAnimating: true` to include text during its animations for debugging.

`detectOverlaps(frame, options)` remains a pure geometry check: a single `Frame`
has no per-element track history, so this lower-level API does not infer whether
text is animating. This also applies to presentation frames supplied by a host
during live interaction. Use the scene API for authored-animation filtering.

## 9. Engine structure and verification

The public player composes three concerns:

- `SceneSequence` owns sources, current inputs, atomic submissions, and
  reconstruction. It is also usable headlessly.
- `evaluateScene` calculates a frame from compiled data and local time, without
  accumulating mutations from earlier frames.
- The renderer, control overlay, and audio clock consume that data in the browser.

The main implementation files are:

- [src/types.ts](../src/types.ts): public data and scene-authoring types.
- [src/runtime.ts](../src/runtime.ts): sequential builder installed inside the VM.
- [src/compiler.ts](../src/compiler.ts), [src/compiler-client.ts](../src/compiler-client.ts),
  and [src/compiler-worker.ts](../src/compiler-worker.ts): source parsing, isolated
  execution, validation, and off-thread browser compilation.
- [src/sequence.ts](../src/sequence.ts) and [src/timeline.ts](../src/timeline.ts):
  reconstruction, transactions, and deterministic time evaluation.
- [src/renderer.ts](../src/renderer.ts), [src/render-geometry.ts](../src/render-geometry.ts), [src/geometry.ts](../src/geometry.ts), and
  [src/latex.ts](../src/latex.ts): GPU drawing, outline matching, and vector formula layout.
- [src/surfaces.ts](../src/surfaces.ts), [src/solids.ts](../src/solids.ts), and
  [src/mesh-shading.ts](../src/mesh-shading.ts): sampled geometry and mesh normals.
- [src/texture-shader.ts](../src/texture-shader.ts) and
  [src/material-shader.ts](../src/material-shader.ts): shared vertex layout and
  equivalent WGSL/GLSL procedural textures and material lighting.
- [src/path.ts](../src/path.ts): shared SVG parsing and bounded curve tessellation
  (also used by glyph layout), smooth-point curves, and path control-point morphing.
- [src/overlap.ts](../src/overlap.ts): projected geometry intersections and sampled
  animation diagnostics.
- [src/player.ts](../src/player.ts), [src/audio.ts](../src/audio.ts), and
  [src/controls.ts](../src/controls.ts): transport, audio, and optional native widgets.
- [demo/scenes.ts](../demo/scenes.ts): application-level demo helpers and scene sources.
- [demo/spatial.ts](../demo/spatial.ts): function graphs, a spatial flower, solids,
  swept tubes, and interactive textures/materials.
- [demo/plant.ts](../demo/plant.ts): curved leaf shapes, smooth roots, grouped
  growth, and coordinated blade/vein bending.

Portable tests cover deterministic seeks, parallel property animation, persistence
and group lifetimes, current-control reconstruction, code replacement/insertion,
failure isolation, sandbox capabilities/limits, LaTeX mappings, shape matching,
curved-path validation, compound fills, curve accuracy, control-point morphs,
playback ownership, audio clocks, and control races.

The separate `test:gpu` suite uses Dawn's native WebGPU API through Vulkan. It
compiles the actual shader/pipeline, renders the demo scenes off-screen, reads
back pixels, and checks intermediate morphs, per-pixel mesh depth, and screen-space
placement. It requires a native Vulkan WebGPU adapter and is not a runtime backend
or rendering fallback. Set `ANIMLIB_GPU_ARTIFACTS` to a directory to save PNG frames:

```sh
ANIMLIB_GPU_ARTIFACTS=/tmp/animlib-frames npm --workspace animlib run test:gpu
```

Run `npm --workspace animlib run bench:render` to measure CPU geometry preparation
on the four library demonstrations. It evaluates fresh frames and reports median
and p95 times after warmup. GPU calls are stubbed, so these measurements exclude
GPU work and timeline evaluation and are not browser frame rates.

## 10. Current boundaries and next steps

This implementation targets modest explanatory scenes. It does not establish a
large-scene performance guarantee. TeX layout is cached, and bounded caches reuse
parsed paths, curve tessellations, contour triangulations, and morph correspondence
across evaluated frames. Object transforms are prepared once per element, and
vertex data is assembled directly in typed arrays. Stable opaque geometry retains
indexed GPU buffers; camera/object transforms update uniforms and compatible draws
can share geometry. Transparent geometry, morphs, adaptive curves, changing
geometry, and other ineligible draws still use CPU preparation. Timeline evaluation
continues each frame. Ordinary controls rebuild the sequence; retained controls
reuse the changed builder and earlier scenes but reconstruct dependent later
scenes. Appending sources reuses the existing prefix. See [performance](performance.md)
for historical measurements and [retained geometry](#element-animation-and-coordinates)
for current eligibility and invalidation rules.

Opaque meshes have depth testing. Translucent world geometry is sorted back to front
per triangle, including sphere surfaces and round strokes, using the current camera
for each view. This preserves front/back blending and lets other translucent surfaces
sort between an object's faces. Intersecting triangles still use approximate sorting
and can render incorrectly; isolated groups remain atomic compositing units.
Default strokes are tessellated ribbons; opt-in round strokes use lit tubes
and cones. Materials provide stylized metallic reflection, roughness, highlights,
and emission; procedural textures mix two palette colors. This is not a
comprehensive physically based material system. Shape matching cannot infer semantic
part correspondence or arbitrary mesh topology.

Not yet included: custom fonts and general text shaping, video textures,
environment maps, image bump/normal maps on procedural primitives, displacement, bloom, arbitrary mesh receivers or self-shadowing, general path/text hit shapes, LaTeX split/merge mappings, a full physics solver,
infinite scenes, branching navigation, playback-rate controls,
in-player video recording, or mobile-browser support guarantees. Native Node
frame/video export is provided by `tools/render-frames.mjs` and
`tools/render-video.mjs`; use `withOfflineScene` to sample retained time bindings.
Available interaction includes object/group dragging with world bounds or ordered open/closed paths, spring return, live
attachments/connections, host-registered custom behaviors, sliders, toggles, selects,
and camera orbit/pan. Application prompts define which interactions to prefer.

Useful follow-up work should be driven by the three application demos: reusable
additional domain helpers, accessible descriptions of visual objects, measured
performance improvements, richer text support, and only then additional interaction
or rendering features. The core contract remains plain scene code, local clocks,
explicit persistence, and reproducible frames.

## Sections, feature edges, scalar fields, and label depth

These opt-in tools share the same CPU triangle processing on WebGPU and WebGL2.
Existing geometry and labels keep their default appearance. They operate on the
current evaluated mesh (including corresponding-vertex morphs), before world
transforms and before per-view rendering. Keep resolutions modest: clipping and
edge extraction add CPU work, and thick contours add triangles.

### Clipping planes and actual cross-sections

Meshes, sampled surfaces, solids, and spheres accept `clipPlanes`, an array of at
most four `{ normal: [nx, ny, nz], offset, section? }` objects. The retained side
is **dot(normal, localPosition) <= offset**. Normals must be finite and nonzero;
normalizing is optional. For example, `[2, 0, 0]` with offset `1` keeps `x <= 0.5`.
Planes are object-local and follow the object's scale, rotation, position, and
parent groups. They are not view scissor rectangles or world-space planes.

```js
s.box('cutaway', {
  width: 3, height: 2, depth: 2, fill: 'BLUE',
  clipPlanes: [{
    normal: [1, 0, 0], offset: 0.4,
    section: { color: 'YELLOW', width: 0.03, cap: 'GOLD' },
  }],
});
```

Clipping alone removes triangles outside the half-space. `section` draws the
actual mesh/plane intersection as round, unlit contour strokes. `width` is the
full local stroke diameter, default `0.025`, and must be positive. Omit `section`
for clipping only; omit `cap` for an open cut with visible contour. A scalar
surface's contour is the intersection of its sampled triangles with the plane,
not an analytically exact level set. Strokes straddle the intersection by their
radius, so their thickness can extend slightly beyond the mathematical cut.

`cap` is a palette color (with optional alpha). Caps fill closed, nonbranching
section loops, including nested holes and disconnected islands, on consistently
constructed closed meshes. They use flat two-sided lighting and the explicit cap
color, without the object's scalar ramp or procedural texture. Caps are omitted
for open/branching intersection components. Self-intersecting, coincident, or
nonmanifold meshes are outside the cap guarantee. Coplanar triangles create no
new section; a tangent cut creates no artificial disk. Geometrically coincident
endpoints are welded with a tolerance of `1e-8 * max(1, maxAbsLocalCoordinate)`;
the same tolerance classifies plane distances for fills, caps, and contours.
Coplanar vertices are retained, so repeating a plane (including a positive
rescaling of its normal and offset) preserves earlier caps and contours.
Avoid details smaller than that tolerance. A cut that removes the entire shape
produces no cap. Cap/contour display does not change the source mesh topology.

Planes run in array order. Requested caps participate in later cuts; enable caps
on earlier planes when later caps need a closed solid. Earlier section strokes
are clipped against later planes. To move a cut while paused, rebuild it with an
ordinary slider. In a mesh/sphere `morphTo`, equal-length plane lists with exactly
matching normals interpolate offsets; other plane configurations switch to the
target configuration after progress zero. Specify the plane fields at both
endpoints. Object/group animation carries the local plane with the object.

### Silhouette and crease outlines

```js
s.box('edges', {
  fill: 'TEAL',
  outline: { color: 'WHITE', width: 0.025, creaseAngle: Math.PI / 6,
             silhouette: true },
});
```

`outline` is available on meshes and spheres (including sampled surfaces and
solids). It draws boundary edges, creases where adjacent face normals differ by
more than `creaseAngle`, and camera-facing/back-facing transitions when
`silhouette` is true. The defaults are `width: 0.025`, `creaseAngle: Math.PI/6`,
and `silhouette: true`. Angles are radians in `[0, PI]`; `PI` disables creases.
Set `silhouette: false` for boundaries and creases only. Positional welding joins
hard-normal seams, suppressing face triangulation diagonals. Consistent triangle
winding is required for meaningful silhouettes. A sphere's outline follows its
finite tessellation, not an analytic curve. These are depth-tested round strokes,
not screen-space postprocessing; width scales with object/group scale.

Outlines use the clipped, morphed geometry, including requested caps, and are
recomputed for each camera/view/orbit change. They retain group isolation and
object opacity. Translucent fills and strokes use the normal triangle sorting;
intersecting transparent surfaces retain the renderer's existing ordering limits.
Ordinary `stroke` still means the full mesh wireframe and can be used separately.

### Per-vertex scalar palette colors

Raw meshes accept `scalarColors: { values, domain, colors }`. `values` must have
exactly one finite number per vertex (magnitude at most `1e6`); `domain` is two
finite increasing numbers. `colors` contains 2–16 named opaque palette tokens,
not CSS colors, `none`, or alpha objects. All stops are resolved through the
host's palette, including its availability checks.

```js
s.surface('temperature', {
  fn: (x, y) => Math.sin(x) * Math.cos(y),
  scalar: {
    fn: (x, y, z) => z,
    domain: [-1, 1],
    colors: ['BLUE', 'WHITE', 'RED'],
  },
});
// Raw mesh equivalent:
s.mesh('triangle', {
  vertices: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]],
  triangles: [[0, 1, 2]],
  scalarColors: { values: [0, 1, 0.5], domain: [0, 1], colors: ['BLUE', 'RED'] },
});
```

`surface` and `parametricSurface` accept `scalar: { fn(x,y,z), domain, colors }`.
The callback receives each valid sampled **local position**, not UV parameters,
and is sampled with geometry during compilation/control rebuilds. Invalid
geometry samples leave holes and have no scalar entry. Invalid scalar samples
fail compilation instead of silently misaligning the values. Changing geometry
with a surface callback resamples the scalar field too; array-based raw mesh
edits must supply corresponding scalar values explicitly.

Values clamp to the domain, then map linearly between uniformly spaced palette
stops in sRGB channel space. The GPU interpolates the resulting vertex colors
perspectively across each triangle; clipping interpolates those same attributes.
A triangle spanning several ramp stops therefore does not insert interior stop
bands: increase sampling where the field varies rapidly. Scalar colors replace
fill RGB while retaining fill alpha, object/group opacity, lighting, materials,
and optional procedural texture blending. `fill: 'none'` still hides the fill.
Matching scalar ramps/domains and equal-length values interpolate during mesh
morphs; unmatched configurations use the target ramp after progress zero. No
automatic scalar legend is generated; author one with palette-colored shapes.

### Configurable label occlusion

Text and LaTeX accept `labelOcclusion`:

- `'depth'` (default/omitted): preserve existing per-glyph triangle depth testing.
- `'overlay'`: show the whole label over world geometry in its view.
- `'hide'`: hide the whole label when its anchor is behind an opaque filled triangle.
- `'fade'`: show an occluded label at 20% of its ordinary opacity; otherwise show it fully.

```js
s.text('inside-label', { text: 'Core', position: [0, 0, -1],
  billboard: true, labelOcclusion: 'fade', fill: 'YELLOW' });
```

The anchor is the transformed local origin, including billboard and viewport
offsets. Billboard labels face the current camera as before. Anchor modes use
whole-label visibility, so a partially occluded label can remain fully visible
if its anchor is visible. Only opaque fill triangles in the **same view** occlude
anchors; translucent surfaces, partially transparent isolated groups, strokes,
and other text do not. Caps count as fill geometry. Screen-space labels retain
their existing semantics and ignore this option. Anchors outside camera near/far
visibility are hidden. Overlay/hide/fade retain the label's perspective size and
position and its isolated group membership; scene-wide screen labels still render
above them. Visibility updates during playback, seeking, and camera orbit. There
is no label collision avoidance or automatic placement.

The [explanatory studies](../demo/explanatory.html) demonstrate annular caps,
independent cutaway/top views, a scalar height field, and orbit-sensitive labels.

## Imported static 3D models

`model(id, props)` accepts both prepared descriptor assets and imported GLB assets.
The host supplies prepared assets through `assetCatalog` / `modelAssets` and GLB
assets through `models` / the player's `assets` inventory. Unique asset IDs resolve
automatically. If both inventories contain the same ID, set `source: 'prepared'`
or `source: 'glb'`; omitting it is an error. The exported `ModelProps` union contains
`PreparedModelProps` and `GLBModelProps`.

Both formats return a `ModelHandle` with ordinary element animations, `part()`
and `tintTo()`. Prepared parts use descriptor IDs and retain child IDs such as
`assembly.body`; their tint changes ordinary mesh fill. Prepared image colors
remain controlled by their explicit image texture tint. GLB parts use node IDs
or unambiguous names and retain child IDs such as `assembly/node-2`; their tint
multiplies imported material colors. The formats keep their existing styling
rules; see [prepared assets](helpers-and-assets.md) for descriptor preparation.

For the GLB format specifically,
`model(id, props)` instantiates a registered GLB asset, including its named parts,
UV coordinates, vertex colors and embedded image materials. Geometry and image
bytes stay in host-owned resources, outside QuickJS and serialized scene frames.
The scene builder remains synchronous and has no network access.

```js
export default scene({ mode: '3d', orbit: true }, s => {
  const assembly = s.model('assembly', {
    asset: 'published-model-id', position: [0, 0, 0], scale: 2,
  });
  s.play(assembly.fadeIn(), { duration: 0.5 });
  const panel = assembly.part('Panel');
  s.play(panel.moveTo([1, 0, 0]), { duration: 1 });
  s.play(panel.tintTo(Color.BLUE), { duration: 0.5 });
  s.play(assembly.tintTo(Color.WHITE), { duration: 0.5 }); // Original materials.
  s.keep(assembly);
});
```

Props: `asset`, optional `source: 'glb'`, `position`, `rotation`, uniform `scale`, `opacity`, `castShadow`,
and optional palette `tint`. Handles support ordinary element animations,
`part(idOrName)`, and `tintTo(color)`. Part lookup requires a unique name or its
stable `node-N` ID. Root IDs produce stable child IDs such as
`assembly/node-2` and `assembly/primitive-0`; later scenes can retrieve kept
parts with `s.previous.get('assembly/node-2')`. There is no arbitrary topology
morph, deformation callback, skeletal animation, or animation-clip playback for
imported models in this release.

Imported node transforms, including nonuniform and negative scales, are baked
into host geometry while node translations/pivots and the hierarchy remain
addressable. Part rotations therefore use model axes around the imported pivot,
not the original node's rotated local axes. `moveTo` sets a position relative to
the part's parent; the published metadata includes each initial position.
Units and overall model size are preserved. Use the published bounds to choose
scale and camera framing.

A compiled scene may reference at most 500,000 imported triangles across all
instances; model roots, parts, and primitives consume the ordinary object-ID budget.
Use much smaller assets for interactive/mobile scenes. Per-asset and resident
budgets are described in the host registration section below.

Materials retain imported colors independently of the host palette. Explicit
tints multiply imported colors in linear space; `WHITE` clears the tint. The
renderer supports base color, tangent-space normal, metallic/roughness,
occlusion and emissive maps, unlit materials, vertex colors, OPAQUE/MASK/BLEND,
and double-sided faces. Maps use TEXCOORD_0 or TEXCOORD_1, wrapping, nearest/linear
filtering, and KHR_texture_transform. Normal-map tangent frames are reconstructed
from UV derivatives. Lighting uses animlib's studio material approximation;
it is not an exact glTF reference PBR renderer. Mipmap filtering currently uses
its nearest/linear base-level equivalent. No environment maps or compressed
textures are included yet. Alpha-masked surfaces do not cast planar shadows;
blended surfaces retain the existing triangle-sorting limitations.

### Registering and delivering models

The host validates a self-contained GLB and registers the resulting metadata
with its URL. `parseModelGLB` works in Bun, Node, and browsers. `createModelGLB`
exports host-generated named triangle parts, UVs, colors/material factors and
optional PNG/JPEG textures. Neither function is available inside scene code.

```ts
import { parseModelGLB, createPlayer } from 'animlib';
const { metadata } = await parseModelGLB(bytes);
const player = createPlayer({ canvas, assets: {
  heart: { kind: 'model', url: '/api/models/<sha256>.glb', sha256, metadata },
} });
// Or player.registerAssets({ heart: { kind: 'model', url, sha256, metadata } });
```

URLs belong to the host manifest, not scene source. A supplied SHA-256 is checked
before decoding. IDs are immutable; a renewed signed URL is accepted for the
same hash and metadata. Identical hashes share downloads, decoded images, and
GPU resources. Assets required by each candidate scene are fully prepared
before submission commits. Failed loading leaves the last valid sequence in
place. All sequence assets remain cached for backward seeking, within resident
budgets, until the player is disposed. Disposal aborts pending downloads and
releases textures/buffers. GPU recovery reuploads the cached decoded resources.

For headless authoring, pass inventories to `compileSource(source, { models:
{ heart: metadata } })` or `new SceneSequence({ models: { heart: metadata } })`.
Frames carry only asset/primitive references and local bounds. Bounds and model
picking use conservative primitive boxes when image/geometry bytes are absent;
these are not exact painted-pixel bounds. This supports layout, attachment
origins, and drag behaviors without importing full geometry into the compiler.

The accepted profile is static, triangle-based glTF 2.0 in a GLB with all buffer
and image data embedded. PNG/JPEG images, normalized attributes, sparse and
interleaved accessors, and KHR_mesh_quantization are supported by the importer.
Unsupported extensions, skins, morph targets, animation clips, external URIs,
missing UVs, invalid attributes and corrupt image dimensions produce errors.
Convert FBX/OBJ/Blender files to this profile before publication; bake Blender
procedural materials to image maps. The importer does not run Blender itself.

Per GLB limits: 32 MB file; 200,000 vertices and triangles; 256 nodes/primitives;
64 images, each at most 4096×4096, totaling 16 megapixels. One compiled scene may
reference at most 500,000 imported triangles across its instances. A player
retains at most 1,000,000 imported vertices and 32 megapixels of decoded model
images. These are rejection ceilings, not performance targets; use much smaller
assets for mobile scenes.

### Scene-agent publication

The backend supplies the scene agent with `publish_model`. It accepts either a
public HTTPS GLB URL or a `generated` JSON string describing named mesh parts.
The tool validates and stores immutable bytes, records source/license/attribution,
and returns the model ID and inventory for `s.model`. Existing assets are provided
to later scene agents and restored when generation resumes. Each lesson supports
up to 16 published models. Downloading does not grant reuse rights: supply the
source's applicable license and attribution.

The lesson's `VideoScene.assets` manifest reaches the client alongside its source
and audio. The client registers these assets before submitting the scene.
`POST /api/models` accepts a raw GLB body and returns `{ id, asset }` for external
model-generation workflows. `GET`/`HEAD /api/models/<sha256>.glb` serve immutable
binary assets with an ETag and cache headers. Storage defaults to `data/models`;
set `MODEL_ASSET_DIR` to persistent storage in deployment. Model bytes are cached
independently of video jobs; deleting a video does not garbage-collect shared
models. Automatic cross-format conversion, mesh optimization, LODs and asset thumbnails
are future additions. Agent inspection, browser previews, and native visual review
receive the same published model assets; isolated renderers decode verified bytes
without fetching external URLs.

Open `/model-viewer.html` in the demo to import a local GLB, orbit, highlight named
parts, and replay rotation. `/models.html` runs focused WebGL2/WebGPU browser
checks; `npm --workspace animlib run test:gpu` includes native Vulkan model pixel
checks when the browser has no WebGPU adapter.
