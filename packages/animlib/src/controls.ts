import colorString from "color-string";
import type { ControlDefinition, ControlValue } from "./types.js";

const controlStyles = `
.animlib-controls { color:rgb(var(--animlib-control-ink,244,244,242)); font:12px/1.4 system-ui,sans-serif; }
.animlib-controls .animlib-control { display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px 16px;padding:4px 0;box-sizing:border-box;background:none;border:0;border-radius:0;pointer-events:auto;max-width:100%;flex-shrink:0; }
.animlib-controls .animlib-control-caption { color:rgba(var(--animlib-control-ink,244,244,242),.58);font-size:11px;font-weight:500;letter-spacing:.02em; }
.animlib-controls output { grid-column:2;grid-row:1;min-width:28px;text-align:right;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;color:rgba(var(--animlib-control-ink,244,244,242),.88);font-variant-numeric:tabular-nums; }
.animlib-controls input[type=range] { appearance:none;-webkit-appearance:none;grid-column:1 / -1;grid-row:2;display:block;width:100%;height:20px;padding:0;margin:0;background:transparent;cursor:pointer;outline:0;border:0;flex:none; }
.animlib-controls input[type=range]::-webkit-slider-runnable-track { height:2px;border-radius:2px;background:linear-gradient(to right,var(--animlib-control-accent,rgb(var(--animlib-control-ink,244,244,242))) 0 var(--animlib-progress,0%),rgba(var(--animlib-control-ink,244,244,242),.16) var(--animlib-progress,0%) 100%); }
.animlib-controls input[type=range]::-webkit-slider-thumb { appearance:none;-webkit-appearance:none;width:10px;height:10px;margin-top:-4px;border:0;border-radius:50%;background:var(--animlib-control-accent,rgb(var(--animlib-control-ink,244,244,242)));box-shadow:0 0 0 4px rgba(var(--animlib-control-ink,244,244,242),0);transition:box-shadow .15s,transform .15s; }
.animlib-controls input[type=range]::-moz-range-track { height:2px;border:0;border-radius:2px;background:rgba(var(--animlib-control-ink,244,244,242),.16); }
.animlib-controls input[type=range]::-moz-range-progress { height:2px;border-radius:2px;background:var(--animlib-control-accent,rgb(var(--animlib-control-ink,244,244,242))); }
.animlib-controls input[type=range]::-moz-range-thumb { width:10px;height:10px;border:0;border-radius:50%;background:var(--animlib-control-accent,rgb(var(--animlib-control-ink,244,244,242))); }
.animlib-controls input[type=range]:hover::-webkit-slider-thumb,.animlib-controls input[type=range]:focus-visible::-webkit-slider-thumb { box-shadow:0 0 0 4px rgba(var(--animlib-control-ink,244,244,242),.1); }
.animlib-controls input[type=range]:active::-webkit-slider-thumb { transform:scale(1.15); }
.animlib-controls input[type=range]:focus-visible::-moz-range-thumb { box-shadow:0 0 0 4px rgba(var(--animlib-control-ink,244,244,242),.12); }
.animlib-controls .animlib-control-toggle { grid-template-columns:1fr auto;gap:16px;min-height:32px; }
.animlib-controls .animlib-control-toggle input { appearance:none;-webkit-appearance:none;grid-row:1;grid-column:2;position:relative;width:28px;height:16px;margin:0;border:1px solid rgba(var(--animlib-control-ink,244,244,242),.22);border-radius:20px;background:rgba(var(--animlib-control-ink,244,244,242),.04);cursor:pointer;transition:background .15s,border-color .15s; }
.animlib-controls .animlib-control-toggle input::after { content:"";position:absolute;top:3px;left:3px;width:8px;height:8px;border-radius:50%;background:rgba(var(--animlib-control-ink,244,244,242),.45);transition:transform .15s,background .15s; }
.animlib-controls .animlib-control-toggle input:checked { border-color:rgba(var(--animlib-control-ink,244,244,242),.4);background:rgba(var(--animlib-control-ink,244,244,242),.1); }
.animlib-controls .animlib-control-toggle input:checked::after { transform:translateX(12px);background:var(--animlib-control-accent,rgb(var(--animlib-control-ink,244,244,242))); }
.animlib-controls .animlib-control-toggle output,.animlib-controls .animlib-control-select output { display:none; }
.animlib-controls select { appearance:none;grid-column:1 / -1;grid-row:2;width:100%;padding:4px 18px 7px 0;background:transparent;color:inherit;border:0;border-bottom:1px solid rgba(var(--animlib-control-ink,244,244,242),.2);border-radius:0;font:inherit;cursor:pointer; }
.animlib-controls select option { color:#eee;background:#161616; }
.animlib-controls .animlib-control-select { position:relative; }
.animlib-controls .animlib-control-select::after { content:"";position:absolute;right:2px;bottom:16px;width:5px;height:5px;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(45deg);opacity:.5;pointer-events:none; }
.animlib-controls input[type=checkbox]:focus-visible,.animlib-controls select:focus-visible { outline:1px solid var(--animlib-control-accent,rgb(var(--animlib-control-ink,244,244,242)));outline-offset:4px; }
@media(prefers-reduced-motion:reduce) { .animlib-controls input,.animlib-controls input::after { transition:none; } }
`;

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const displayValue = (value: ControlValue): string => typeof value === "number"
  ? numberFormat.format(value) : String(value);

type Input = HTMLInputElement | HTMLSelectElement;
interface Widget {
  row: HTMLLabelElement;
  input: Input;
  output: HTMLOutputElement;
  label: HTMLSpanElement;
  schema: string;
  kind: ControlDefinition["kind"];
  value: ControlValue;
  generation: number;
  pending: boolean;
}

/** Reconciles native widgets, retaining focus during playback and value changes. */
export class ControlOverlay {
  private readonly container: HTMLDivElement;
  private readonly stylesheet: HTMLStyleElement;
  private widgets = new Map<string, Widget>();
  private scene = "";
  private observer?: ResizeObserver;
  private restorePosition?: string;
  private root: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly onChange: (id: string, value: ControlValue) => Promise<void> | void,
    private canvas?: HTMLCanvasElement,
  ) {
    this.root = root;
    this.stylesheet = root.ownerDocument.createElement("style");
    this.stylesheet.textContent = controlStyles;
    root.ownerDocument.head?.append(this.stylesheet);
    if (canvas && getComputedStyle(root).position === "static") {
      this.restorePosition = root.style.position;
      root.style.position = "relative";
    }
    this.container = root.ownerDocument.createElement("div");
    this.container.className = "animlib-controls";
    this.container.setAttribute("aria-label", "Scene controls");
    this.container.style.cssText = "position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:flex-end;gap:18px;padding:28px;box-sizing:border-box;pointer-events:none;";
    root.append(this.container);
    if (canvas) {
      this.observer = new ResizeObserver(this.align);
      this.observer.observe(canvas); this.observer.observe(root);
      root.ownerDocument.defaultView?.addEventListener("resize", this.align);
      root.ownerDocument.defaultView?.addEventListener("scroll", this.align, true);
      this.align();
    }
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    if (this.canvas) this.observer?.unobserve(this.canvas);
    this.canvas = canvas;
    this.observer?.observe(canvas);
    this.align();
  }

  private align = (): void => {
    if (!this.canvas) return;
    const bounds = this.canvas.getBoundingClientRect(), root = this.root.getBoundingClientRect();
    Object.assign(this.container.style, {
      inset: "auto", left: `${bounds.left-root.left-this.root.clientLeft+this.root.scrollLeft}px`,
      top: `${bounds.top-root.top-this.root.clientTop+this.root.scrollTop}px`,
      width: `${bounds.width}px`, height: `${bounds.height}px`,
    });
  };

  update(scene: string, controls: ControlDefinition[], background?: string): void {
    if (background) {
      const rgb = colorString.get.rgb(background);
      if (rgb) this.container.style.setProperty("--animlib-control-ink", rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722 > 150 ? "32,35,41" : "244,244,242");
    }
    if (scene !== this.scene) {
      this.scene = scene;
      this.widgets.clear();
      this.container.replaceChildren();
    }
    const ids = new Set(controls.map(control => control.id));
    for (const [id, widget] of this.widgets) {
      if (!ids.has(id)) {
        widget.input.closest("label")?.remove();
        this.widgets.delete(id);
      }
    }
    for (const control of controls) {
      const schema = JSON.stringify([control.kind, control.min, control.max, control.step, control.options]);
      let widget = this.widgets.get(control.id);
      if (widget && widget.schema !== schema) {
        widget.input.closest("label")?.remove();
        this.widgets.delete(control.id);
        widget = undefined;
      }
      if (!widget) {
        const document = this.container.ownerDocument;
        const label = document.createElement("label");
        label.className = `animlib-control animlib-control-${control.kind}`;

        const caption = document.createElement("span");
        caption.className = "animlib-control-caption";
        const output = document.createElement("output");
        const input = control.kind === "select" ? document.createElement("select") : document.createElement("input");
        input.dataset.controlId = control.id;

        input.addEventListener("pointerdown", event => event.stopPropagation());
        if (input.tagName === "INPUT") {
          const field = input as HTMLInputElement;
          field.type = control.kind === "slider" ? "range" : "checkbox";
          if (control.kind === "slider") {
            field.min = String(control.min);
            field.max = String(control.max);
            field.step = String(control.step ?? "any");
          }
        } else {
          for (const value of control.options ?? []) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            input.append(option);
          }
        }
        const created: Widget = {
          row: label, input, output, label: caption, schema, kind: control.kind,
          value: control.value, generation: 0, pending: false,
        };
        const event = control.kind === "slider" ? "input" : "change";
        input.addEventListener(event, () => {
          const value = control.kind === "slider" ? Number(input.value)
            : control.kind === "toggle" ? (input as HTMLInputElement).checked : input.value;
          const generation = ++created.generation;
          created.pending = true;
          output.textContent = control.kind === "toggle" ? "" : displayValue(value);
          this.updateProgress(created, value);
          const settle = () => {
            if (generation !== created.generation) return;
            created.pending = false;
            this.applyValue(created);
          };
          try { void Promise.resolve(this.onChange(control.id, value)).then(settle, settle); }
          catch { settle(); }
        });
        label.append(caption, input, output);
        this.container.append(label);
        widget = created;
        this.widgets.set(control.id, widget);
      }
      Object.assign(widget.row.style, {
        position: control.position ? "absolute" : "relative",
        left: control.position ? `${control.position[0]*100}%` : "",
        top: control.position ? `${control.position[1]*100}%` : "",
        width: `${control.width ?? 220}px`,
      });
      widget.label.textContent = control.label;
      widget.value = control.value;
      if (!widget.pending) this.applyValue(widget);
    }
  }

  private updateProgress(widget: Widget, value: ControlValue): void {
    if (widget.kind !== "slider") return;
    const input = widget.input as HTMLInputElement;
    const min = Number(input.min), max = Number(input.max);
    const percentage = max > min ? Math.max(0, Math.min(100, (Number(value)-min)/(max-min)*100)) : 0;
    input.style.setProperty("--animlib-progress", `${percentage}%`);
  }

  private applyValue(widget: Widget): void {
    if (widget.kind === "toggle") (widget.input as HTMLInputElement).checked = Boolean(widget.value);
    else widget.input.value = String(widget.value);
    widget.output.textContent = widget.kind === "toggle" ? "" : displayValue(widget.value);
    this.updateProgress(widget, widget.value);
  }

  dispose(): void {
    this.widgets.clear();
    this.observer?.disconnect();
    this.root.ownerDocument.defaultView?.removeEventListener("resize", this.align);
    this.root.ownerDocument.defaultView?.removeEventListener("scroll", this.align, true);
    this.container.remove();
    this.stylesheet.remove();
    if (this.restorePosition !== undefined) this.root.style.position = this.restorePosition;
  }
}
