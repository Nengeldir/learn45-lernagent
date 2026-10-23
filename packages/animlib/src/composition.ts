import type { ModelMaterial } from './models.js';
import { MAX_INSTANCES } from './retained-geometry.js';
import type { RetainedMesh } from './retained-geometry.js';
import { VERTEX_FLOATS } from './texture-shader.js';
import type { ImageTexture, ResolvedImage } from './asset-types.js';
export interface ImageBinding { texture: ImageTexture; image: ResolvedImage }
export function imageBindingKey(binding?:ImageBinding):string { return binding?JSON.stringify([binding.image.hash,binding.texture.filter,binding.texture.wrap]):''; }
/** Internal layer operations shared by both compositors. */
export interface LayerEffect {
  /** Opaque receiver: apply lighting to accumulated coverage, before saturation. */
  receiverLight?: number;
  /** Linear palette albedo, applied only after accumulating coverage. */
  receiverColor?: [number, number, number];
  /** Direct-light reduction per unit of encoded coverage (includes normalization). */
  receiverShadow?: number;
  /** Add a silhouette's coverage without attenuating earlier samples. */
  additive?: boolean;
}
/** Shared draw order for the two native graphics backends. */
export type RenderCommand =
  | { first: number; count: number; opaque: boolean; modelMaterial?: ModelMaterial; mesh?: RetainedMesh; instances?: Float32Array[]; imageBinding?: ImageBinding }
  | ({ children: RenderCommand[]; opacity: number; opaque: boolean } & LayerEffect);
export interface DrawItem {
  modelMaterial?: ModelMaterial;
  depth: number; vertices: Float32Array; transparent: boolean; screen: boolean;
  /** Requires world-space packing after the effective camera is known. */
  cameraDependentGeometry?: boolean;
  mesh?: RetainedMesh; instance?: Float32Array;
  imageBinding?:ImageBinding;
  groups?: ({ id: string; opacity: number } & LayerEffect)[];
}

/** Isolated groups form atomic compositing units; ordinary groups remain flattened. */
export function composeItems(items: DrawItem[], first: number): { commands: RenderCommand[]; items: DrawItem[] } {
  interface Unit extends LayerEffect { depth: number; transparent: boolean; item?: DrawItem; children?: Unit[]; opacity: number; }
  const root: Unit[] = [], groups = new Map<string, Unit>();
  for (const item of items) {
    let children = root;
    for (const group of item.groups ?? []) {
      let unit = groups.get(group.id);
      if (!unit) { unit = { depth: item.depth, transparent: group.opacity < 0.999999, children: [], opacity: group.opacity, receiverLight: group.receiverLight, receiverColor: group.receiverColor, receiverShadow: group.receiverShadow, additive: group.additive }; groups.set(group.id, unit); children.push(unit); }
      unit.depth = Math.min(unit.depth, item.depth);
      unit.transparent ||= item.transparent;
      children = unit.children!;
    }
    children.push({ depth: item.depth, transparent: item.transparent, item, opacity: 1 });
  }
  const ordered: DrawItem[] = [];
  const build = (units: Unit[]): RenderCommand[] => {
    // A nested translucent layer makes its enclosing layer translucent as well.
    // A receiver layer contains an opaque finite plane beneath all of its masks.
    // Resolve it before unrelated transparency; its projected masks are not scene glass.
    const transparent = (unit: Unit): boolean => unit.receiverLight === undefined
      && (unit.transparent || Boolean(unit.children?.some(transparent)));
    for (const unit of units) unit.transparent = transparent(unit);
    units.sort((a,b) => Number(a.transparent)-Number(b.transparent) || b.depth-a.depth);
    const commands: RenderCommand[] = units.map(unit => {
      if (unit.children) return { children: build(unit.children), opacity: unit.opacity, opaque: !unit.transparent, ...(unit.receiverLight !== undefined ? { receiverLight: unit.receiverLight, receiverColor: unit.receiverColor, receiverShadow: unit.receiverShadow } : {}), ...(unit.additive ? { additive: true } : {}) };
      const item = unit.item!, count = item.vertices.length/VERTEX_FLOATS, command: RenderCommand = { first, count, opaque: !item.transparent, ...(item.imageBinding ? { imageBinding: item.imageBinding } : {}), ...(item.modelMaterial ? { modelMaterial: item.modelMaterial } : {}), ...(item.mesh ? { mesh: item.mesh, instances: [item.instance!] } : {}) };
      ordered.push(item); first += count; return command;
    });
    const merged: RenderCommand[] = [];
    for (const command of commands) {
      const previous = merged.at(-1);
      const compatible = previous && 'first' in previous && 'first' in command
        && previous.opaque === command.opaque && previous.modelMaterial === command.modelMaterial
        && imageBindingKey(previous.imageBinding) === imageBindingKey(command.imageBinding);
      if (compatible && 'first' in previous && 'first' in command && previous.mesh && previous.mesh === command.mesh && previous.instances!.length < MAX_INSTANCES) previous.instances!.push(...command.instances!);
      else if (compatible && 'first' in previous && 'first' in command && !previous.mesh && !command.mesh && previous.first+previous.count === command.first) previous.count += command.count;
      else merged.push(command);
    }
    return merged;
  };
  return { commands: build(root), items: ordered };
}
