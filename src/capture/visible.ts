/*
  Resolve "the element under the cursor" to "the element the reviewer can see".

  Stacked, scroll-faded siblings (Nutrition Nest 2026-08-27, reports #89/#90,
  "the wrong picture is showing"): a rail keeps five photographs in one grid
  cell and fades them by scroll position, so elementFromPoint returns whichever
  is on top of the DOM stack — not the one that is visible. The visible one is
  the LAST lit sibling, not the most opaque: earlier photographs stay at
  opacity 1 underneath and each new one is cut in on top. Later in DOM order
  paints on top, so walk the stack and keep the last one that is not
  transparent.

  Nutrition Nest keyed this on its own class name. Here the site opts in with
  `data-imredline-stack` on the container, so the package never knows a site's
  CSS.
*/

export const STACK_ATTR = "data-imredline-stack";

export function resolveVisible(el: Element | null): Element | null {
  if (!el) return null;
  const stack = el.closest<HTMLElement>(`[${STACK_ATTR}]`);
  if (!stack) return el;
  let best: Element | null = null;
  for (const child of Array.from(stack.children)) {
    if (parseFloat(getComputedStyle(child).opacity) > 0.05) best = child;
  }
  if (!best) return el;
  return best.querySelector("img") ?? best;
}

/**
 * elementFromPoint with the review overlay made transparent to hits for the
 * duration of the call. `overlay` is whatever the widget puts over the page
 * while picking.
 */
export function elementUnder(x: number, y: number, overlay: HTMLElement | null): Element | null {
  const prev = overlay?.style.pointerEvents;
  if (overlay) overlay.style.pointerEvents = "none";
  try {
    return resolveVisible(document.elementFromPoint(x, y));
  } finally {
    if (overlay && prev !== undefined) overlay.style.pointerEvents = prev;
  }
}
