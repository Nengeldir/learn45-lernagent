import type { ElementHandle, ElementProps, ReactiveDependency, Vec2 } from '../types.js';
export type DiagramStyle = Pick<ElementProps,'fill'|'stroke'|'strokeWidth'|'opacity'>;
export interface PlaneOptions {
  xRange: Vec2; yRange: Vec2; origin?: Vec2; scale?: number | Vec2; step?: number;
  grid?: false | DiagramStyle; axes?: false | DiagramStyle; ticks?: false | DiagramStyle;
}
export type CoordinateMap = (point: Vec2, ...values: number[]) => Vec2;
export interface CoordinatePlane {
  toWorld(point: Vec2): Vec2;
  readonly grid: readonly ElementHandle[]; readonly axes: readonly ElementHandle[]; readonly ticks: readonly ElementHandle[];
  path(id: string, points: Vec2[], style?: DiagramStyle & {closed?: boolean}): ElementHandle;
  vector(id: string, endpoint: Vec2, style?: DiagramStyle): ElementHandle;
  components(id: string, endpoint: Vec2, styles?: {x?: DiagramStyle;y?: DiagramStyle}): {x:ElementHandle;y:ElementHandle};
  curve(id: string, fn: (t:number)=>Vec2, range: Vec2, samples?: number, style?: DiagramStyle): ElementHandle;
  label(id:string,tex:string,point:Vec2,offset?:Vec2,style?:DiagramStyle & {fontSize?:number}):ElementHandle;
  /** Apply once. Captures source coordinates; labels remain upright. New members inherit the map. */
  map(dependencies: ReactiveDependency[], fn: CoordinateMap): void;
}
