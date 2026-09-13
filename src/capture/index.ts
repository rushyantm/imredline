/*
  imredline/capture — photograph the part of a page a reviewer pointed at,
  with a red box on the thing they pinned.

  One call: capture(pinnedElement, options) → { dataUrl, frame, pin, ... }.
  Framework-free. html2canvas-pro is imported only when capture runs, so a
  visitor who never files anything never downloads it.

  Lineage: Nutrition Nest's engine (subtree capture, size climb, area budget,
  JPEG loop, animation bake) merged with Aradea's (canvas-stroked marker,
  fractional pin, frame ceiling, background capture, clone fallback). Every
  non-obvious line carries the measurement that earned it.
*/

import { prepareClone, type CloneOptions } from "./clone.js";
import { backgroundFor, pickFrame, scaleFor, type FrameOptions } from "./frame.js";
import { selectorFor } from "./selector.js";

export { selectorFor } from "./selector.js";
export { resolveVisible, elementUnder, STACK_ATTR } from "./visible.js";
export { pickFrame, FRAME_ATTR, LANDMARKS } from "./frame.js";
export { PRIVATE_ATTR, ANIMATED_ATTR } from "./clone.js";

type Html2Canvas = (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;

export type CaptureOptions = CloneOptions &
  FrameOptions & {
    /** Elements to leave out of the picture — the widget's own chrome. */
    ignore?: (el: Element) => boolean;
    /** Cap on the data-URL length. Default 1,500,000 (~1.1 MB of JPEG,
     *  what a GitHub issue body can carry with room to spare). */
    maxLength?: number;
    /** Target canvas area in pixels. Default 1,260,000. */
    areaBudget?: number;
    /** Give up after this long. Default 12,000 ms. */
    timeoutMs?: number;
    /** Draw the red box. Default true. */
    marker?: boolean;
    /** Supply html2canvas yourself (a vendored UMD, say). Default: dynamic
     *  import of html2canvas-pro. */
    loadLibrary?: () => Promise<Html2Canvas>;
  };

export type CaptureResult = {
  /** JPEG data URL, or null when capture failed — `error` says why. */
  dataUrl: string | null;
  error?: string;
  /** What was photographed. */
  frame: { tag: string; selector: string; width: number; height: number };
  /** The pinned element, as fractions of the frame (0–1), so it survives
   *  re-rendering at any size. Null when the frame IS the element. */
  pin: { x: number; y: number; width: number; height: number } | null;
  /** Breadcrumb for the pinned element. */
  selector: string;
  /** Explains the framing when the picture is wider than the pin. */
  note?: string;
  scale: number;
  quality?: number;
  viewport: { width: number; height: number; scrollX: number; scrollY: number; dpr: number };
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

async function defaultLoad(): Promise<Html2Canvas> {
  const mod = await import("html2canvas-pro");
  return (mod.default ?? mod) as unknown as Html2Canvas;
}

export async function capture(pinned: Element | null, options: CaptureOptions = {}): Promise<CaptureResult> {
  const el = pinned instanceof HTMLElement && pinned.isConnected ? pinned : null;
  const frame = pickFrame(el, options);
  const fr = frame.getBoundingClientRect();
  const er = el?.getBoundingClientRect() ?? null;
  const scale = scaleFor(frame, options.areaBudget, 0.12, 0.75);
  const viewport = { width: innerWidth, height: innerHeight, scrollX, scrollY, dpr: devicePixelRatio };

  const pin =
    el && er && frame !== el && fr.width && fr.height
      ? {
          x: clamp01((er.left - fr.left) / fr.width),
          y: clamp01((er.top - fr.top) / fr.height),
          width: clamp01(er.width / fr.width),
          height: clamp01(er.height / fr.height),
        }
      : null;

  const base: Omit<CaptureResult, "dataUrl"> = {
    frame: { tag: frame.tagName.toLowerCase(), selector: selectorFor(frame), width: fr.width, height: fr.height },
    pin,
    selector: selectorFor(el),
    scale,
    viewport,
  };
  if (el && frame !== el) {
    base.note = `the shot is the surrounding <${frame.tagName.toLowerCase()}>, not the pinned element alone; the red box marks what was pinned`;
  }
  if (fr.width < 1 || fr.height < 1) return { ...base, dataUrl: null, error: "this area could not be captured" };

  const maxLength = options.maxLength ?? 1_500_000;
  const timeoutMs = options.timeoutMs ?? 12_000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const html2canvas = await (options.loadLibrary ?? defaultLoad)();
    const work = html2canvas(frame, {
      scale,
      logging: false,
      useCORS: true,
      imageTimeout: 8000,
      backgroundColor: backgroundFor(frame),
      /* No x/y/width/height and no scrollX/scrollY. Passing any of them
         re-introduces a crop, and a crop is the bug — see frame.ts. */
      ignoreElements: (n: Element) =>
        n.hasAttribute("data-imredline-ui") || Boolean(options.ignore?.(n)),
      onclone: (doc: Document, cloneFrame: HTMLElement) => prepareClone(frame, doc, cloneFrame, options),
    });
    const canvas = await Promise.race<HTMLCanvasElement>([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("the screenshot took too long")), timeoutMs);
      }),
    ]);

    /* The marker: stroke it on the canvas AFTER capture, never a DOM node
       before it. A node drifts when the page reflows under it during the
       capture (measured 105px on Nutrition Nest); `outline` and `inset
       box-shadow` both photograph as nothing at all. White halo first so the
       red reads on any background. */
    if ((options.marker ?? true) && pin) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.resetTransform();
        const x = Math.max(3, pin.x * canvas.width);
        const y = Math.max(3, pin.y * canvas.height);
        const w = Math.max(1, Math.min(pin.width * canvas.width, canvas.width - x - 3));
        const h = Math.max(1, Math.min(pin.height * canvas.height, canvas.height - y - 3));
        ctx.lineWidth = 7;
        ctx.strokeStyle = "#fff";
        ctx.strokeRect(x, y, w, h);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#e2483d";
        ctx.strokeRect(x, y, w, h);
      }
    }

    /* JPEG, re-encoded downward until it fits. PNG is lossless, so a
       photographic hero does not compress and files with no picture at all.
       Photographs are what people pin. Better a softer picture than none. */
    let quality = 0.85;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > maxLength && quality > 0.35) {
      quality = Math.round((quality - 0.15) * 100) / 100;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > maxLength) {
      return { ...base, dataUrl: null, error: `capture too large even at lowest quality (<${base.frame.tag}>)` };
    }
    return { ...base, dataUrl, quality };
  } catch (e) {
    return { ...base, dataUrl: null, error: (e instanceof Error && e.message) || "capture failed" };
  } finally {
    clearTimeout(timer);
  }
}
