/*
  What happens to the CLONE before html2canvas paints it. The live page the
  reviewer is looking at is never touched.

  Two jobs, in this order:

  1. Masking. Off by default (owner ruling 2026-09-13: testers report form
     bugs, and blanking the field hides the very thing they are reporting).
     `[data-imredline-private]` is blanked regardless — that is a site saying
     "never photograph this".

  2. Scroll-driven animations do not run in the clone (Nutrition Nest
     2026-08-27, #89/#90): `animation-timeline` is inactive there, so the
     capture showed a stack's resting state, not what the reviewer had
     scrolled to. Bake the live computed opacity and transform of every
     animated element into the clone as inline style and switch the animation
     off. Both trees are the same shape, so a walk in document order pairs
     them — and when they are NOT the same shape, fall back to Aradea's
     blunter rule: kill every animation and transition in the clone.

  Masking must run FIRST. The animation walk has an early return on tree
  mismatch; put the mask after it and it silently stops running on exactly
  the odd trees where it matters most.
*/

export const PRIVATE_ATTR = "data-imredline-private";
export const ANIMATED_ATTR = "data-imredline-animated";

const FORM_FIELDS = "input, textarea, select, [contenteditable]";

export type CloneOptions = {
  /** Blank every form field in the picture. Default false. */
  maskForms?: boolean;
};

function blank(node: HTMLElement): void {
  const field = node as HTMLInputElement;
  if ("value" in field) field.value = "";
  if ("checked" in field) field.checked = false;
  node.removeAttribute("value");
  node.removeAttribute("placeholder");
  if (node.tagName === "SELECT") node.innerHTML = "<option>Hidden</option>";
  else if (node.tagName !== "INPUT") node.textContent = "";
  node.style.setProperty("color", "transparent", "important");
  node.style.setProperty("background", "#d7dedb", "important");
  node.style.setProperty("text-shadow", "none", "important");
}

export function prepareClone(
  liveFrame: HTMLElement,
  cloneDoc: Document,
  cloneFrame: HTMLElement,
  options: CloneOptions = {},
): void {
  const selector = options.maskForms ? `${FORM_FIELDS}, [${PRIVATE_ATTR}]` : `[${PRIVATE_ATTR}]`;
  for (const node of Array.from(cloneDoc.querySelectorAll<HTMLElement>(selector))) blank(node);

  const live = Array.from(liveFrame.querySelectorAll<HTMLElement>("*"));
  const copy = Array.from(cloneFrame.querySelectorAll<HTMLElement>("*"));
  if (live.length !== copy.length) {
    const style = cloneDoc.createElement("style");
    style.textContent =
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
    cloneDoc.head.append(style);
    return;
  }
  live.forEach((o, i) => {
    const cs = getComputedStyle(o);
    if (cs.animationName === "none" && !o.hasAttribute(ANIMATED_ATTR)) return;
    const c = copy[i]!;
    c.style.animation = "none";
    c.style.opacity = cs.opacity;
    c.style.transform = cs.transform;
    c.style.visibility = cs.visibility;
  });
}
