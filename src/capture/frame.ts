/*
  Which part of the page to photograph.

  Capture the pinned element's SUBTREE, never the page plus a crop. Two
  crop-based fixes on Nutrition Nest both photographed the wrong section,
  because the clone html2canvas lays out is a different height from the live
  page, so identical document coordinates address different content in the
  two. A crop cannot survive that however it is anchored (measured 2026-08-18,
  reports #9 and #10). So there is no crop: the frame is a real element, the
  library lays that subtree out itself, and the picture is the right thing by
  construction rather than by arithmetic.

  The frame is the pinned element's nearest landmark — and then, if that is
  still too small to read, whatever ancestor is. A tag allow-list on its own
  is NOT enough; it bit twice (page heroes were <header>, then a nav link
  inside a <div> photographed the 89×12 logo on its own). The list is a
  preference; the size climb is the guarantee.

  Aradea adds the ceiling: a frame taller than `ceiling` px is a scroll
  runway, not a frame, and the element itself is a better picture.
*/

export const FRAME_ATTR = "data-imredline-frame";
export const LANDMARKS = "section, header, footer, main, nav, article, aside";

export type FrameOptions = {
  /** Frame must be at least this wide. Default 240. */
  minWidth?: number;
  /** …and at least this tall. Low on purpose: a site's own nav bar (measured
   *  2099×72) must qualify as its own frame instead of escalating to a
   *  whole-page shot. Default 44. */
  minHeight?: number;
  /** …and cover at least this many px². Default 120,000. */
  minArea?: number;
  /** A frame taller than this is a runway; use the element. Default 6000. */
  ceiling?: number;
};

export function bigEnough(el: Element, o: Required<FrameOptions>): boolean {
  const r = el.getBoundingClientRect();
  return r.width >= o.minWidth && r.height >= o.minHeight && r.width * r.height >= o.minArea;
}

/** The element itself if it is HTML, else its nearest HTML ancestor. An
 *  <svg> or <path> is a legitimate pin (icons are clicked constantly) but not
 *  something html2canvas can be handed as a root. Nutrition Nest's old engine
 *  checked `instanceof HTMLElement` and silently dropped the pin — a footer
 *  icon photographed the whole page (found 2026-09-13). */
function htmlHost(el: Element): HTMLElement {
  let n: Element | null = el;
  while (n && !(n instanceof HTMLElement)) n = n.parentElement;
  return n ?? document.body;
}

export function pickFrame(el: Element | null, options: FrameOptions = {}): HTMLElement {
  const o: Required<FrameOptions> = {
    minWidth: options.minWidth ?? 240,
    minHeight: options.minHeight ?? 44,
    minArea: options.minArea ?? 120_000,
    ceiling: options.ceiling ?? 6000,
  };
  if (!(el instanceof Element) || !el.isConnected) return document.body;

  /* A site's sticky scroll-stage is a <div>, not a landmark, and its nearest
     landmark is <main> — so without the opt-in attribute the shot became the
     whole page and the panel the reviewer was looking at was lost in it. */
  const candidate: HTMLElement =
    el.closest<HTMLElement>(`[${FRAME_ATTR}]`) ?? el.closest<HTMLElement>(LANDMARKS) ?? htmlHost(el);
  const under = (n: Element) => n.getBoundingClientRect().height <= o.ceiling;
  let target = candidate;
  /* The largest ancestor seen so far that is NOT a runway. */
  let lastUnder: HTMLElement | null = under(candidate) ? candidate : null;

  while (target !== document.body && !bigEnough(target, o)) {
    const up = target.parentElement;
    if (!up || up === document.documentElement) break;
    target = up;
    if (under(target)) lastUnder = target;
  }

  /* The climb ran into a runway (a 7000px page, a scroll stage). Measured
     2026-09-13 in the fixture: a 40px site header fails the size rule, the
     climb reaches <body>, body is taller than the ceiling — and falling back
     to the ELEMENT re-creates the 89×12 logo shot this whole rule exists to
     prevent. So return the largest ancestor that is still under the ceiling
     (an icon inside <nav> inside <header> gets the header, not an 18px nav
     strip); only when nothing under the ceiling was seen does the element
     itself win (Aradea's rule for a pinned runway). */
  if (!under(target)) return lastUnder ?? htmlHost(el);
  return target;
}

/**
 * Scale so the canvas lands near `areaBudget` pixels. Budget the AREA, not
 * the long edge: long-edge scaling ignores the other dimension, and a wide
 * monitor (measured 2315×1199) produced several times the pixels of the same
 * section on a laptop.
 */
export function scaleFor(frame: Element, areaBudget = 1_260_000, min = 0.12, max = 0.75): number {
  const r = frame.getBoundingClientRect();
  const px = (r.width || innerWidth) * (r.height || innerHeight);
  return Math.min(max, Math.max(min, Math.sqrt(areaBudget / (px || areaBudget))));
}

/** The first real background above `frame`, so a subtree that renders on
 *  transparent does not flatten to black. */
export function backgroundFor(frame: Element): string {
  for (let n: Element | null = frame; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && c !== "transparent" && !c.startsWith("rgba(0, 0, 0, 0)")) return c;
  }
  return "#ffffff";
}
