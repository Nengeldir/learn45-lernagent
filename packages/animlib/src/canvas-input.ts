import { BehaviorRuntime } from './behaviors.js';
import { cameraRay, pick, SpatialFrame } from './spatial.js';
import { rotate } from './geometry.js';
import type { InteractionSnapshot, Ray } from './types.js';
import type { AssetGeometryResolver } from './asset-types.js';

/** Canvas-only behavior input. Native camera gestures receive every unclaimed event. */
export class CanvasInput {
  private held?: { pointer: number; target: string; element: string; view: string; screen: boolean };
  private focused?: string;
  private touchAction = '';
  private tabIndex: string | null = null;
  constructor(private canvas: HTMLCanvasElement, private runtime: BehaviorRuntime,
    private snapshot: (view?: string) => InteractionSnapshot | undefined,
    private invalidate: () => void,
    private assetGeometry?: AssetGeometryResolver,
  ) { this.listen(true); }
  private listen(add: boolean): void {
    if (!this.canvas.addEventListener) return;
    if (add) {
      this.touchAction = this.canvas.style.touchAction; this.canvas.style.touchAction = 'none';
      this.tabIndex = this.canvas.getAttribute('tabindex');
      if (this.tabIndex === null) this.canvas.setAttribute('tabindex', '0');
    } else {
      this.canvas.style.touchAction = this.touchAction;
      if (this.tabIndex === null) this.canvas.removeAttribute('tabindex'); else this.canvas.setAttribute('tabindex', this.tabIndex);
    }
    const events = { pointerdown: this.down, pointermove: this.move, pointerup: this.up, pointercancel: this.cancelEvent, lostpointercapture: this.cancelEvent, keydown: this.key };
    for (const [name, listener] of Object.entries(events)) {
      if (add) this.canvas.addEventListener(name, listener as EventListener, true);
      else this.canvas.removeEventListener(name, listener as EventListener, true);
    }
  }
  setCanvas(canvas: HTMLCanvasElement): void { this.cancel(); this.listen(false); this.canvas = canvas; this.listen(true); }
  private coordinates(event: PointerEvent, view: string): { snapshot: InteractionSnapshot; x: number; y: number } | undefined {
    const snapshot = this.snapshot(view); if (!snapshot) return;
    const bounds = this.canvas.getBoundingClientRect();
    const [left, top, width, height] = snapshot.rect;
    return { snapshot, x: ((event.clientX-bounds.left)/bounds.width-left)/width*snapshot.width, y: ((event.clientY-bounds.top)/bounds.height-top)/height*snapshot.height };
  }
  private ray(event: PointerEvent): Ray | undefined {
    if (!this.held) return;
    const p = this.coordinates(event, this.held.view); if (!p) return;
    const offset = new SpatialFrame(p.snapshot.frame).chain(this.held.element).reduce((a, e) => [a[0]+(e.viewportOffset?.[0] ?? 0), a[1]+(e.viewportOffset?.[1] ?? 0)], [0,0]);
    const x = p.x-offset[0]*p.snapshot.width, y = p.y+offset[1]*p.snapshot.height;
    return this.held.screen ? { origin: [x-p.snapshot.width/2, p.snapshot.height/2-y, 1e6], direction: [0,0,-1] }
      : cameraRay(x, y, p.snapshot.camera, p.snapshot.width, p.snapshot.height);
  }
  private down = (event: PointerEvent): void => {
    if (this.held || event.button !== 0 || event.shiftKey) return;
    const snapshot = this.snapshot(); if (!snapshot) return;
    const bounds = this.canvas.getBoundingClientRect(), x = (event.clientX-bounds.left)/bounds.width, y = (event.clientY-bounds.top)/bounds.height;
    let view = [...(snapshot.frame.views ?? [])].reverse().find(v => x >= v.rect[0] && y >= v.rect[1] && x < v.rect[0]+v.rect[2] && y < v.rect[1]+v.rect[3])?.id ?? '';
    let p = this.coordinates(event, view); if (!p) return;
    const hitAt = (p: NonNullable<ReturnType<CanvasInput['coordinates']>>, targets: Set<string>, view: string) =>
      pick(p.snapshot.frame, cameraRay(p.x, p.y, p.snapshot.camera, p.snapshot.width, p.snapshot.height), targets, p.snapshot.camera, p.snapshot.width, p.snapshot.height, view || undefined, [p.x, p.y], this.assetGeometry);
    let hit;
    if (view) {
      // Global screen content is rendered after regional views and wins input too.
      const global = this.coordinates(event, '')!;
      const targets = new Set(snapshot.frame.elements.filter(e => e.view === undefined && e.space === 'screen' && this.runtime.inputTargets.has(e.id)).map(e => e.id));
      hit = hitAt(global, targets, '');
      if (hit) { view = ''; p = global; }
    }
    hit ??= hitAt(p, this.runtime.inputTargets, view);
    if (!hit) return;
    const element = p.snapshot.frame.elements.find(e => e.id === hit.element)!;
    this.held = { pointer: event.pointerId, target: hit.id, element: hit.element, view, screen: element.space === 'screen' };
    const normal = this.held.screen ? [0,0,1] as [number,number,number] : rotate([0,0,1], [p.snapshot.camera.pitch, p.snapshot.camera.yaw, 0]);
    if (!this.runtime.input(hit.id, { type: 'start', ray: this.ray(event), normal })) { this.held = undefined; return; }
    this.focused = hit.id;
    event.preventDefault(); event.stopImmediatePropagation();
    this.canvas.focus({ preventScroll: true }); this.canvas.setPointerCapture(event.pointerId); this.invalidate();
  };
  private move = (event: PointerEvent): void => {
    if (this.held?.pointer !== event.pointerId) return;
    this.runtime.input(this.held.target, { type: 'move', ray: this.ray(event) });
    event.preventDefault(); event.stopImmediatePropagation(); this.invalidate();
  };
  private up = (event: PointerEvent): void => {
    if (this.held?.pointer !== event.pointerId) return;
    // Incorporate the release coordinate even when the browser coalesced its final move.
    this.runtime.input(this.held.target, { type: 'move', ray: this.ray(event) });
    this.finish('end'); event.preventDefault(); event.stopImmediatePropagation(); this.invalidate();
  };
  private finish(type: 'end' | 'cancel'): void {
    const held = this.held; if (!held) return; this.held = undefined;
    this.runtime.input(held.target, { type });
    if (this.canvas.hasPointerCapture?.(held.pointer)) this.canvas.releasePointerCapture(held.pointer);
  }
  private cancelEvent = (event: PointerEvent): void => {
    if (this.held?.pointer !== event.pointerId) return;
    this.finish('cancel'); this.invalidate();
  };
  private key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.held) { this.cancel(); this.invalidate(); event.preventDefault(); return; }
    if (this.focused && this.runtime.input(this.focused, { type: 'key', key: event.key })) { event.preventDefault(); this.invalidate(); }
  };
  cancel(): void { this.finish('cancel'); }
  sync(): void {
    if (this.held && !this.runtime.inputTargets.has(this.held.target)) this.cancel();
    if (this.focused && !this.runtime.inputTargets.has(this.focused)) this.focused = undefined;
  }
  dispose(): void { this.cancel(); this.listen(false); }
}
