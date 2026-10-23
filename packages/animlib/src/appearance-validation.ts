import { validateColor } from './palette.js';
import type { Geometry } from './types.js';
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function number(value: unknown, label: string) { check(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6, `Invalid ${label}`); }
function vec(value: unknown, label: string) { check(Array.isArray(value) && value.length === 3, `Invalid ${label}`); value.forEach(n => number(n, label)); }
/** Shared compile/update validation; palette membership is checked by the caller. */
export function validateSurfaceAppearance(g: Geometry): void {
  if (g.material !== undefined) {
    const m = g.material;
    check((g.kind === "mesh" || g.kind === "sphere") && m && typeof m === "object" && !Array.isArray(m), "Materials require mesh or sphere geometry");
    check(Object.keys(m).every(key => ["metalness", "roughness", "specular", "emissive", "emissiveIntensity"].includes(key)), "Unknown material option");
    for (const key of ["metalness", "roughness", "specular", "emissiveIntensity"] as const) if (m[key] !== undefined) {
      number(m[key], `material ${key}`);
      check(m[key]! >= (key === "roughness" ? 0.05 : 0) && m[key]! <= (key === "emissiveIntensity" ? 4 : 1), `Invalid material ${key} range`);
    }
    if (m.emissive !== undefined) validateColor(m.emissive);
  }
  if (g.texture !== undefined) {
    const t = g.texture;
    check((g.kind === "mesh" || g.kind === "sphere") && t && typeof t === "object" && !Array.isArray(t), "Textures require mesh or sphere geometry");
    check(Object.keys(t).every(key => ["pattern", "color", "scale", "offset", "seed", "bumpStrength"].includes(key)), "Unknown texture option");
    check(["checker", "stripes", "noise", "marble", "wood"].includes(t.pattern), "Invalid texture pattern");
    validateColor(t.color);
    if (t.scale !== undefined) {
      const scales = typeof t.scale === "number" ? [t.scale] : t.scale;
      if (typeof t.scale !== "number") vec(t.scale, "texture scale");
      for (const value of scales) { number(value, "texture scale"); check(value > 0 && value <= 1000, "Texture scale must be in (0, 1000]"); }
    }
    if (t.offset !== undefined) vec(t.offset, "texture offset");
    if (t.bumpStrength !== undefined) {
      number(t.bumpStrength, "texture bumpStrength");
      check(Math.abs(t.bumpStrength) <= 1, "Texture bumpStrength must be between -1 and 1");
    }
    if (t.seed !== undefined) check(Number.isInteger(t.seed) && t.seed >= 0 && t.seed <= 65535, "Texture seed must be an integer 0–65535");
  }
}
