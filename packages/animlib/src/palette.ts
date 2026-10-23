import colorString from "color-string";
import type { ColorPalette, ColorValue, CompiledScene, ElementState, Geometry } from "./types.js";

// Source: https://github.com/3b1b/manim/blob/master/manimlib/default_config.yml
// Median aliases follow manimlib/constants.py. Black background follows
// https://github.com/3b1b/videos/blob/master/custom_config.yml.
const manimColors = {
  BLUE_E: "#1C758A", BLUE_D: "#29ABCA", BLUE_C: "#58C4DD", BLUE_B: "#9CDCEB", BLUE_A: "#C7E9F1",
  TEAL_E: "#49A88F", TEAL_D: "#55C1A7", TEAL_C: "#5CD0B3", TEAL_B: "#76DDC0", TEAL_A: "#ACEAD7",
  GREEN_E: "#699C52", GREEN_D: "#77B05D", GREEN_C: "#83C167", GREEN_B: "#A6CF8C", GREEN_A: "#C9E2AE",
  YELLOW_E: "#E8C11C", YELLOW_D: "#F4D345", YELLOW_C: "#FFFF00", YELLOW_B: "#FFEA94", YELLOW_A: "#FFF1B6",
  GOLD_E: "#C78D46", GOLD_D: "#E1A158", GOLD_C: "#F0AC5F", GOLD_B: "#F9B775", GOLD_A: "#F7C797",
  RED_E: "#CF5044", RED_D: "#E65A4C", RED_C: "#FC6255", RED_B: "#FF8080", RED_A: "#F7A1A3",
  MAROON_E: "#94424F", MAROON_D: "#A24D61", MAROON_C: "#C55F73", MAROON_B: "#EC92AB", MAROON_A: "#ECABC1",
  PURPLE_E: "#644172", PURPLE_D: "#715582", PURPLE_C: "#9A72AC", PURPLE_B: "#B189C6", PURPLE_A: "#CAA3E8",
  GREY_E: "#222222", GREY_D: "#444444", GREY_C: "#888888", GREY_B: "#BBBBBB", GREY_A: "#DDDDDD",
  WHITE: "#FFFFFF", BLACK: "#000000", GREY_BROWN: "#736357", DARK_BROWN: "#8B4513", LIGHT_BROWN: "#CD853F",
  PINK: "#D147BD", LIGHT_PINK: "#DC75CD", GREEN_SCREEN: "#00FF00", ORANGE: "#FF862F",
  PURE_RED: "#FF0000", PURE_GREEN: "#00FF00", PURE_BLUE: "#0000FF",
  BLUE: "#58C4DD", TEAL: "#5CD0B3", GREEN: "#83C167", YELLOW: "#FFFF00", GOLD: "#F0AC5F",
  RED: "#FC6255", MAROON: "#C55F73", PURPLE: "#9A72AC", GREY: "#888888",
} as const;

/** Enum-like palette slots shared by TypeScript and sandboxed scene code. */
export type PaletteColor = keyof typeof manimColors;
export const Color = Object.freeze({
  ...Object.fromEntries(Object.keys(manimColors).map(name => [name, name])) as { readonly [K in PaletteColor]: K },
  NONE: "none",
} as const);
export type Color = typeof Color[keyof typeof Color];

export const THREE_BLUE_ONE_BROWN_PALETTE = Object.freeze({
  colors: Object.freeze(manimColors), background: Color.BLACK, foreground: Color.WHITE,
});

const parsedColors = new Map<string, [number, number, number, number]>();
/** sRGB channels in [0, 1], followed by alpha. Does not apply a palette. */
export function parseColor(source: string): [number, number, number, number] {
  const cached = parsedColors.get(source);
  if (cached) return cached;
  const result = parseCssColor(source);
  if (!result.every(Number.isFinite)) throw new Error(`Unsupported CSS color: ${source}`);
  if (parsedColors.size >= 4096) parsedColors.clear();
  parsedColors.set(source, result);
  return result;
}

function parseCssColor(source: string): [number, number, number, number] {
  if (source === "none") return [0, 0, 0, 0];
  let rgb = colorString.get.rgb(source);
  if (!rgb) {
    // color-string rejects signed exponents in RGB alpha, which JS emits for tiny fades.
    const exponent = /^(rgba?\([^,]+,[^,]+,[^,]+,)\s*([+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+)\s*\)$/i.exec(source);
    if (exponent) {
      rgb = colorString.get.rgb(`${exponent[1]}1)`);
      if (rgb) rgb[3] = Math.max(0, Math.min(1, Number(exponent[2])));
    }
  }
  if (rgb) return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, rgb[3]];
  const hsl = colorString.get.hsl(source), hwb = colorString.get.hwb(source);
  if (!hsl && !hwb) throw new Error(`Unsupported CSS color: ${source}`);
  const hue = ((hsl ?? hwb)![0] % 360 + 360) % 360;
  const s = hsl ? hsl[1] / 100 : 1, l = hsl ? hsl[2] / 100 : 0.5, a = s * Math.min(l, 1 - l);
  const component = (n: number) => { const k = (n + hue / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  let result: [number, number, number, number] = [component(0), component(8), component(4), (hsl ?? hwb)![3]];
  if (hwb) {
    let w = hwb[1] / 100, b = hwb[2] / 100;
    if (w + b > 1) { const sum = w + b; w /= sum; b /= sum; }
    result = [result[0] * (1 - w - b) + w, result[1] * (1 - w - b) + w, result[2] * (1 - w - b) + w, result[3]];
  }
  return result;
}

// Euclidean distance in Oklab approximates perceived color difference.
function oklab(rgb: readonly number[]): number[] {
  const [r, g, b] = rgb.slice(0, 3).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function hex(rgb: readonly number[]): string {
  return "#" + rgb.slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

/** Validate the serialized token type independently of the active palette. */
export function validateColor(value: unknown): asserts value is ColorValue {
  const name = typeof value === "string" ? value : value && typeof value === "object" && !Array.isArray(value) ? (value as { color?: unknown }).color : undefined;
  const validName = name === "none" || typeof name === "string" && Object.hasOwn(manimColors, name);
  if (!validName) throw new Error(`Invalid palette color ${JSON.stringify(value)}; use Color.BLUE or another Color token, not a CSS color`);
  if (typeof value !== "string") {
    const alpha = value as { color: unknown; opacity: unknown };
    if (name === "none" || Object.keys(value!).some(key => key !== "color" && key !== "opacity") || typeof alpha.opacity !== "number" || !Number.isFinite(alpha.opacity) || alpha.opacity < 0 || alpha.opacity > 1) {
      throw new Error("A translucent color requires { color: Color token, opacity: number between 0 and 1 }");
    }
  }
}

export class PaletteResolver {
  readonly palette: ColorPalette;
  private entries: { name: PaletteColor; rgba: number[]; lab: number[] }[];

  constructor(palette: ColorPalette = THREE_BLUE_ONE_BROWN_PALETTE) {
    if (!palette || typeof palette !== "object" || !palette.colors || typeof palette.colors !== "object" || Array.isArray(palette.colors)) throw new Error("Invalid color palette");
    const entries = Object.entries(palette.colors);
    if (!entries.length || entries.length > Object.keys(manimColors).length) throw new Error("Palette requires at least one Color slot");
    const colors: Partial<Record<PaletteColor, string>> = {};
    for (const [name, value] of entries) {
      if (!Object.hasOwn(manimColors, name)) throw new Error(`Invalid palette slot ${name}; use a Color token`);
      if (typeof value !== "string" || value.length > 128) throw new Error(`Invalid palette color ${name}`);
      const rgba = parseColor(value);
      if (rgba[3] !== 1) throw new Error(`Palette color ${name} must be opaque`);
      colors[name as PaletteColor] = hex(rgba);
    }
    this.entries = Object.entries(colors).map(([name, color]) => { const rgba = parseColor(color); return { name: name as PaletteColor, rgba, lab: oklab(rgba) }; });
    const role = (value: PaletteColor, label: string) => {
      if (typeof value !== "string" || !Object.hasOwn(colors, value)) throw new Error(`Palette ${label} must be an active Color token`);
      return value;
    };
    this.palette = Object.freeze({ colors: Object.freeze(colors), background: role(palette.background, "background"), foreground: role(palette.foreground, "foreground") });
  }

  validate(value: unknown): void {
    validateColor(value);
    const name = typeof value === "string" ? value : value.color;
    if (name !== "none" && !Object.hasOwn(this.palette.colors, name)) throw new Error(`Color.${name} is not defined in the active palette`);
  }

  /** Resolve validated tokens to CSS only at the drawing boundary. */
  resolve(value: ColorValue): string {
    this.validate(value);
    if (value === "none") return "none";
    const name = typeof value === "string" ? value : value.color;
    const color = this.palette.colors[name]!;
    if (typeof value === "string" || value.opacity === 1) return color;
    return `rgba(${parseColor(color).slice(0, 3).map(v => Math.round(v * 255)).join(",")},${value.opacity})`;
  }

  /** Interpolate only validated tokens; intermediate base colors stay in the palette. */
  interpolate(from: ColorValue, to: ColorValue, t: number): ColorValue {
    this.validate(from); this.validate(to);
    if (t === 0 || from === "none" && to === "none") return structuredClone(from);
    if (t === 1) return structuredClone(to);
    const a = parseColor(this.resolve(from)), b = parseColor(this.resolve(to));
    const start = from === "none" ? [...b.slice(0, 3), 0] : a;
    const end = to === "none" ? [...a.slice(0, 3), 0] : b;
    const rgba = start.map((v, i) => v + (end[i] - v) * t);
    const fromName = typeof from === "string" ? from : from.color;
    const toName = typeof to === "string" ? to : to.color;
    const name = fromName === "none" ? toName : toName === "none" || fromName === toName ? fromName : undefined;
    // Fades retain the authored slot, including median aliases such as BLUE.
    if (name && name !== "none") return rgba[3] === 1 ? name : { color: name, opacity: rgba[3] };
    const lab = oklab(rgba);
    let nearest = this.entries[0], distance = Infinity;
    for (const entry of this.entries) {
      const d = entry.lab.reduce((sum, v, i) => sum + (v - lab[i]) ** 2, 0);
      if (d < distance) { nearest = entry; distance = d; }
    }
    return rgba[3] === 1 ? nearest.name : { color: nearest.name, opacity: rgba[3] };
  }
}

const resolvers = new WeakMap<ColorPalette, PaletteResolver>();
/** Palette inputs are immutable; each resolver owns a validated, frozen copy. */
export function paletteResolver(palette: ColorPalette = THREE_BLUE_ONE_BROWN_PALETTE): PaletteResolver {
  let resolver = resolvers.get(palette);
  if (!resolver) { resolver = new PaletteResolver(palette); resolvers.set(palette, resolver); resolvers.set(resolver.palette, resolver); }
  return resolver;
}

/** Validate every authored color, including inherited states and track snapshots. */
export function enforceScenePalette(scene: CompiledScene, resolver: PaletteResolver): void {
  const validate = (value: ColorValue, label: string) => {
    try { resolver.validate(value); } catch (error) { throw new Error(`${label}: ${(error as Error).message}`); }
  };
  const explanatory = (g: Geometry) => {
    for (const color of g.scalarColors?.colors ?? []) validate(color, "Scalar ramp");
    if (g.outline) validate(g.outline.color, "Outline");
    for (const p of g.clipPlanes ?? []) if (p.section) {
      validate(p.section.color, "Section");
      if (p.section.cap !== undefined) validate(p.section.cap, "Section cap");
    }
  };
  const element = (e: ElementState) => {
    explanatory(e.geometry);
    validate(e.fill, `${e.id} fill`); validate(e.stroke, `${e.id} stroke`);
    if (e.geometry.material?.emissive !== undefined) validate(e.geometry.material.emissive, `${e.id} emissive color`);
    if (e.geometry.texture) validate(e.geometry.texture.color, `${e.id} texture color`);
  };
  scene.options.palette = resolver.palette;
  validate(scene.options.background, "Scene background");
  if (scene.options.lighting && scene.options.lighting !== "studio" && scene.options.lighting.receiver) validate(scene.options.lighting.receiver.fill ?? "GREY_D", "Shadow receiver fill");
  if (typeof scene.options.background !== "string" || (scene.options.background as string) === "none") throw new Error("Scene background requires an opaque Color token");
  scene.initial.forEach(element);
  for (const binding of scene.reactiveBindings ?? []) {
    const p = binding.properties;
    if (p.fill !== undefined) validate(p.fill, `${binding.target} reactive fill`);
    if (p.material?.emissive !== undefined) validate(p.material.emissive, `${binding.target} reactive emissive`);
    if (p.texture) validate(p.texture.color, `${binding.target} reactive texture`);
    for (const color of p.scalarColors?.colors ?? []) validate(color, `${binding.target} reactive scalar ramp`);
  }
  for (const event of scene.lifecycle) event.elements?.forEach(element);
  for (const track of scene.tracks) {
    Object.values(track.from).forEach(element);
    if (track.action.type === "morph" && track.action.geometry) explanatory(track.action.geometry);
    if (track.action.type === "morph" && track.action.geometry?.material?.emissive !== undefined) validate(track.action.geometry.material.emissive, "Morph emissive color");
    if (track.action.type === "morph" && track.action.geometry?.texture) validate(track.action.geometry.texture.color, "Morph texture color");
    if (track.action.type === "animate") {
      const props = track.action.properties as Partial<ElementState>;
      for (const key of ["fill", "stroke"] as const) if (props?.[key] !== undefined) validate(props[key]!, `Animation ${key}`);
    }
  }
}
