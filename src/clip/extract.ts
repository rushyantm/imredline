/*
  imredline/clip — turn one element on a live page into a folder a person
  or a coding agent can rebuild from: clean markup, real CSS folded into a
  few classes, a token sheet, the asset addresses, and honest labels for
  what could not be read.

  Everything runs in the page. Nothing is fetched. The source page is never
  mutated — the only DOM this touches is a hidden about:blank iframe used to
  read the browser's own defaults, removed before the call returns.

  What "real CSS" means here: getComputedStyle on every element (and its
  ::before/::after) for a curated property list, minus whatever the browser
  would have done anyway (UA default for non-inherited properties, the
  parent's value for inherited ones). Identical declaration sets become one
  class. The result is 40–150 lines instead of a site's whole framework, and
  it renders the resting look exactly. Hover/focus/active rules and
  keyframes come from document.styleSheets where the browser lets us read
  them; a cross-origin sheet throws, and the clip says so (`states: partial`).
*/

import type { ClipAsset, ClipTokens } from "../core/types.js";
import { selectorFor } from "../capture/selector.js";

export type ExtractOptions = {
  /** Refuse above this many elements. Default 400. */
  maxElements?: number;
  /** Refuse above this many characters of markup. Default 200,000. */
  maxHtml?: number;
};

export type ExtractResult = {
  html: string;
  css: string;
  tokens: ClipTokens;
  assets: ClipAsset[];
  states: "full" | "partial";
  unreadable: string[];
  counts: { elements: number; images: number; fonts: number; stateRules: number; keyframes: number };
  bounds: { width: number; height: number };
  selector: string;
};

const SKIP_TAGS = new Set(["script", "noscript", "iframe", "object", "embed", "template", "style", "link", "meta", "base", "head", "title"]);
const VOID = new Set(["area", "br", "col", "hr", "img", "input", "source", "track", "wbr"]);
const KEEP_ATTR = new Set(["class", "id", "href", "src", "srcset", "sizes", "alt", "title", "type", "role", "for", "name", "placeholder", "width", "height", "poster", "loading", "lang", "dir", "colspan", "rowspan", "datetime", "start", "reversed", "value", "selected", "disabled", "readonly", "multiple", "open", "controls", "muted", "loop", "autoplay", "playsinline", "target", "rel", "download", "tabindex", "hidden", "action", "method", "min", "max", "step", "pattern", "required", "inputmode", "autocomplete", "label", "cite", "abbr", "scope", "headers"]);
const URL_ATTR = new Set(["href", "src", "poster", "action", "xlink:href", "cite"]);
const MEDIA = new Set(["img", "video", "canvas", "svg", "picture", "source"]);

/* Curated computed properties. Order = output order inside a rule. */
const PROPS = [
  "display", "position", "top", "right", "bottom", "left", "z-index", "float", "clear", "box-sizing",
  "width", "height", "min-width", "max-width", "min-height", "max-height", "aspect-ratio",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "justify-content", "align-items", "align-content", "align-self", "justify-self", "order", "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-auto-flow", "grid-auto-columns", "grid-auto-rows", "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end", "justify-items",
  "overflow-x", "overflow-y", "visibility", "opacity", "isolation",
  "color", "background-color", "background-image", "background-size", "background-position", "background-repeat", "background-clip", "background-attachment", "background-origin",
  "border-top-width", "border-top-style", "border-top-color", "border-right-width", "border-right-style", "border-right-color", "border-bottom-width", "border-bottom-style", "border-bottom-color", "border-left-width", "border-left-style", "border-left-color",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "outline-width", "outline-style", "outline-color", "outline-offset", "box-shadow",
  "font-family", "font-size", "font-weight", "font-style", "font-variant", "font-stretch", "line-height", "letter-spacing", "word-spacing", "text-transform", "text-decoration-line", "text-decoration-color", "text-decoration-style", "text-decoration-thickness", "text-underline-offset", "text-align", "text-indent", "text-shadow", "text-overflow", "white-space", "word-break", "overflow-wrap", "hyphens", "vertical-align", "list-style-type", "list-style-position", "font-feature-settings", "font-variation-settings", "-webkit-font-smoothing", "-webkit-text-fill-color", "-webkit-line-clamp", "-webkit-box-orient",
  "transform", "transform-origin", "transition", "animation", "filter", "backdrop-filter", "mix-blend-mode", "cursor", "pointer-events", "user-select",
  "object-fit", "object-position", "fill", "stroke", "stroke-width", "column-count", "column-gap", "appearance", "resize", "clip-path",
] as const;
const INHERITED = new Set([
  "color", "font-family", "font-size", "font-weight", "font-style", "font-variant", "font-stretch", "line-height", "letter-spacing", "word-spacing", "text-transform", "text-align", "text-indent", "text-shadow", "white-space", "word-break", "overflow-wrap", "hyphens", "list-style-type", "list-style-position", "font-feature-settings", "font-variation-settings", "-webkit-font-smoothing", "-webkit-text-fill-color", "visibility", "cursor", "fill", "stroke", "stroke-width", "user-select",
]);
const STATE_RE = /:(hover|focus-visible|focus-within|focus|active|checked|disabled|target)\b|\[aria-(?:expanded|selected|pressed|current|checked)(?:=(?:"[^"]*"|'[^']*'|[^\]]*))?\]/g;
/** Same pattern without the g flag: `.test()` on a global regex is stateful. */
const STATE_TEST = new RegExp(STATE_RE.source);

type Decls = Map<string, string>;

/* ── colour helpers ── */
function parseRgb(v: string): [number, number, number, number] | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (!m) return null;
  let a = m[4] == null ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith("%")) a /= 100;
  return [+m[1]!, +m[2]!, +m[3]!, a];
}
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");
export function toHex(v: string): string {
  const c = parseRgb(v);
  if (!c) return v;
  const [r, g, b, a] = c;
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ""}`;
}
function toHsl(v: string): string | undefined {
  const c = parseRgb(v);
  if (!c) return undefined;
  const r = c[0] / 255;
  const g = c[1] / 255;
  const b = c[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}
function luminance(v: string): number | null {
  const c = parseRgb(v);
  if (!c || c[3] < 1) return null;
  const f = (n: number) => {
    const x = n / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
const isTransparent = (v: string) => v === "transparent" || /^rgba\(\s*\d+[,\s]+\d+[,\s]+\d+[,\s/]+0\s*\)$/.test(v);
/** Every rgb()/rgba() inside a value (a shadow, a gradient) → hex. */
const hexify = (v: string) => v.replace(/rgba?\([^)]*\)/g, (m) => toHex(m));

/* ── the UA-defaults oracle ── */
class Defaults {
  private frame: HTMLIFrameElement | null = null;
  private doc: Document | null = null;
  private cache = new Map<string, Record<string, string>>();
  constructor() {
    try {
      const f = document.createElement("iframe");
      f.setAttribute("aria-hidden", "true");
      f.setAttribute("data-imredline-ui", "");
      f.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
      document.documentElement.appendChild(f);
      const d = f.contentDocument;
      if (d && d.body) {
        this.frame = f;
        this.doc = d;
      } else f.remove();
    } catch {
      this.frame = null;
    }
  }
  /** Computed values of a pristine element of this tag, or null when the
   *  oracle could not be built (a CSP that forbids frames). */
  get(tag: string): Record<string, string> | null {
    if (!this.doc) return null;
    const hit = this.cache.get(tag);
    if (hit) return hit;
    const el = this.doc.createElement(tag);
    this.doc.body.appendChild(el);
    const cs = this.doc.defaultView!.getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const p of PROPS) out[p] = cs.getPropertyValue(p);
    el.remove();
    this.cache.set(tag, out);
    return out;
  }
  dispose() {
    this.frame?.remove();
  }
}

/* A few initial values, for when the oracle is unavailable. */
const INITIAL: Record<string, string> = {
  position: "static", float: "none", clear: "none", "box-sizing": "content-box", width: "auto", height: "auto", "min-width": "0px", "max-width": "none", "min-height": "0px", "max-height": "none",
  "aspect-ratio": "auto", "flex-direction": "row", "flex-wrap": "nowrap", "flex-grow": "0", "flex-shrink": "1", "flex-basis": "auto", "justify-content": "normal", "align-items": "normal", "align-content": "normal", "align-self": "auto", "justify-self": "auto", order: "0", "row-gap": "normal", "column-gap": "normal",
  "grid-template-columns": "none", "grid-template-rows": "none", "grid-template-areas": "none", "grid-auto-flow": "row", "grid-auto-columns": "auto", "grid-auto-rows": "auto", "grid-column-start": "auto", "grid-column-end": "auto", "grid-row-start": "auto", "grid-row-end": "auto", "justify-items": "normal",
  "overflow-x": "visible", "overflow-y": "visible", opacity: "1", isolation: "auto", "background-color": "rgba(0, 0, 0, 0)", "background-image": "none", "background-size": "auto", "background-position": "0% 0%", "background-repeat": "repeat", "background-clip": "border-box", "background-attachment": "scroll", "background-origin": "padding-box",
  "outline-width": "0px", "outline-style": "none", "outline-offset": "0px", "box-shadow": "none", "text-decoration-line": "none", "text-decoration-style": "solid", "text-decoration-thickness": "auto", "text-underline-offset": "auto", "text-overflow": "clip", "vertical-align": "baseline", "-webkit-line-clamp": "none", "-webkit-box-orient": "horizontal",
  transform: "none", "transform-origin": "50% 50%", transition: "all", animation: "none", filter: "none", "backdrop-filter": "none", "mix-blend-mode": "normal", "pointer-events": "auto", "object-fit": "fill", "object-position": "50% 50%", "column-count": "auto", appearance: "none", resize: "none", "clip-path": "none",
  top: "auto", right: "auto", bottom: "auto", left: "auto", "z-index": "auto",
};
const ZERO = new Set(["margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius", "text-indent"]);

const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : NaN);
const isDefaultTransition = (v: string) => /^(all\s+)?0s(\s+ease)?(\s+0s)?$/.test(v) || v === "all" || v === "none";
const isDefaultAnimation = (v: string) => /^none\b/.test(v) || v === "none";

/* ── the walk ── */
type Node = { el: Element; parent: Node | null; cls: string; tag: string; svg: boolean; display: string; inline: boolean; hasText: boolean };

export function extractClip(root: Element, options: ExtractOptions = {}): ExtractResult | { error: string } {
  const maxElements = options.maxElements ?? 400;
  const maxHtml = options.maxHtml ?? 200_000;
  if (!(root instanceof Element) || !root.isConnected) return { error: "pick something on the page first" };
  /* An <svg> child is a fine pin for Review; for a clip, the host is the thing. */
  while (root && !(root instanceof HTMLElement) && root.parentElement) root = root.parentElement;
  if (root === document.body || root === document.documentElement) return { error: "that is the whole page — pick a component (Narrow)" };

  const usable = (el: Element) => !SKIP_TAGS.has(el.tagName.toLowerCase()) && !el.hasAttribute("data-imredline-ui") && !el.hasAttribute("data-imredline-private");
  const nodes: Node[] = [];
  const byEl = new Map<Element, Node>();
  (function walk(el: Element, parent: Node | null) {
    if (!usable(el) || nodes.length > maxElements) return;
    const cs = getComputedStyle(el);
    const display = cs.display;
    const n: Node = {
      el,
      parent,
      cls: "",
      tag: el.tagName.toLowerCase(),
      svg: el.namespaceURI === "http://www.w3.org/2000/svg",
      display,
      inline: display.startsWith("inline") || display === "contents",
      hasText: Array.from(el.childNodes).some((c) => c.nodeType === 3 && /\S/.test(c.textContent || "")),
    };
    nodes.push(n);
    byEl.set(el, n);
    for (const c of Array.from(el.children)) walk(c, n);
  })(root, null);
  if (nodes.length > maxElements) return { error: `more than ${maxElements} elements — pick something smaller (Narrow)` };
  if (!nodes.length) return { error: "nothing clippable here" };

  const defaults = new Defaults();
  const warnings: string[] = [];
  try {
    /* ── 0. the cascade, for the properties whose COMPUTED value lies.
       `width: 90%` computes to 289px, `grid-template-columns: repeat(3,
       minmax(0,1fr))` to three used track sizes, `margin: auto` to a
       number. Read the author's value for those from readable stylesheets
       (last matching rule wins — specificity is ignored, which is right
       far more often than it is wrong on utility-class sites) and from the
       style attribute. Unreadable sheets → the heuristics below. ── */
    const SPECIFIED = ["width", "height", "min-width", "max-width", "min-height", "max-height", "margin-left", "margin-right", "top", "right", "bottom", "left", "grid-template-columns", "grid-template-rows", "flex-basis"];
    const specified = new Map<Element, Map<string, string>>();
    const setSpec = (el: Element, prop: string, value: string) => {
      let m = specified.get(el);
      if (!m) specified.set(el, (m = new Map()));
      m.set(prop, value);
    };
    let cascadeReadable = true;
    function harvest(rules: CSSRuleList, depth: number) {
      if (depth > 6) return;
      for (const rule of Array.from(rules)) {
        try {
          if (rule instanceof CSSStyleRule) {
            const st = rule.style;
            const hits: [string, string][] = [];
            for (const p of SPECIFIED) {
              const v = st.getPropertyValue(p);
              if (v) hits.push([p, v]);
            }
            if (!hits.length) continue;
            const sel = rule.selectorText.replace(STATE_RE, "");
            if (!sel.trim() || STATE_TEST.test(rule.selectorText)) continue;
            let found: Element[] = [];
            try {
              found = Array.from(root.querySelectorAll(sel));
              if (root.matches(sel)) found.push(root);
            } catch {
              continue;
            }
            for (const el of found) if (byEl.has(el)) for (const [p, v] of hits) setSpec(el, p, v);
          } else if (rule instanceof CSSMediaRule) {
            const cond = rule.conditionText || rule.media.mediaText;
            if (!cond || matchMedia(cond).matches) harvest(rule.cssRules, depth + 1);
          } else if (rule instanceof CSSSupportsRule) {
            if (CSS.supports(rule.conditionText)) harvest(rule.cssRules, depth + 1);
          } else if (rule instanceof CSSImportRule) {
            const sh = rule.styleSheet;
            if (sh) {
              try { harvest(sh.cssRules, depth + 1); } catch { cascadeReadable = false; }
            }
          } else if (!(rule instanceof CSSKeyframesRule) && "cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
            harvest((rule as CSSGroupingRule).cssRules, depth + 1);
          }
        } catch {}
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.disabled) continue;
      try {
        harvest(sheet.cssRules, 0);
      } catch {
        cascadeReadable = false;
      }
    }
    for (const n of nodes) {
      const st = (n.el as HTMLElement).style;
      if (!st) continue;
      for (const p of SPECIFIED) {
        const v = st.getPropertyValue(p);
        if (v) setSpec(n.el, p, v);
      }
    }
    const spec = (el: Element, prop: string): string | undefined => {
      const v = specified.get(el)?.get(prop);
      if (!v || /var\(|calc\(.*var\(/.test(v)) return undefined;
      return v.trim();
    };

    /* ── 1. styles → declaration sets ── */
    const declsOf = new Map<Node, { base: Decls; before: Decls | null; after: Decls | null }>();
    const rootRect = root.getBoundingClientRect();
    for (const n of nodes) {
      const cs = getComputedStyle(n.el);
      const ua = defaults.get(n.tag) ?? (n.svg ? {} : INITIAL);
      const parentCs = n.parent ? getComputedStyle(n.parent.el) : null;
      const base: Decls = new Map();
      for (const p of PROPS) {
        const v = cs.getPropertyValue(p);
        if (!v) continue;
        if (INHERITED.has(p)) {
          if (parentCs && parentCs.getPropertyValue(p) === v) continue; // inherits in the rebuild too
          if (!parentCs && ua[p] === v) continue;
        } else {
          if (ua[p] === v) continue;
          if (ua[p] === undefined && (INITIAL[p] === v || (ZERO.has(p) && v === "0px"))) continue;
        }
        if (p === "transition" && isDefaultTransition(v)) continue;
        if (p === "animation" && isDefaultAnimation(v)) continue;
        if (p === "background-color" && isTransparent(v)) continue;
        if ((p === "outline-color" || p === "outline-offset" || p === "outline-width") && cs.getPropertyValue("outline-style") === "none") continue;
        if (p.endsWith("-color") && /^border-/.test(p)) {
          const side = p.replace("-color", "-width");
          if (px(cs.getPropertyValue(side)) === 0 || cs.getPropertyValue(p.replace("-color", "-style")) === "none") continue;
        }
        /* Tailwind's preflight puts `border: 0 solid` on everything; a style
           with no width paints nothing. */
        if (p.endsWith("-style") && /^border-/.test(p) && px(cs.getPropertyValue(p.replace("-style", "-width"))) === 0) continue;
        if ((p === "min-width" || p === "min-height") && (v === "auto" || v === "0px")) continue;
        if ((p === "top" || p === "right" || p === "bottom" || p === "left") && (cs.position === "static" || (cs.position === "relative" && v === "0px"))) continue;
        if (p === "transition" && v.includes("--")) {
          /* Tailwind lists its own custom properties in transition-colors; nobody rebuilding wants those. */
          const kept = v.split(/,\s*(?![^(]*\))/).filter((part) => !part.trim().startsWith("--")).join(", ");
          if (!kept || isDefaultTransition(kept)) continue;
          base.set(p, kept);
          continue;
        }
        if (p === "text-decoration-color" || p === "text-decoration-style" || p === "text-decoration-thickness" || p === "text-underline-offset") {
          if (cs.getPropertyValue("text-decoration-line") === "none") continue;
        }
        if (p === "-webkit-text-fill-color" && v === cs.color) continue;
        /* transform-origin computes to px on every element; it only means
           something once there is a transform. */
        if (p === "transform-origin" && cs.transform === "none") continue;
        base.set(p, v);
      }
      /* A running animation drives opacity/transform/visibility; the
         keyframes carry them, the mid-flight value must not be baked. */
      if (cs.animationName && cs.animationName !== "none") {
        base.delete("opacity");
        base.delete("transform");
        base.delete("visibility");
      }
      /* Sizes: a block that simply fills its parent had `width: auto`; baking
         the used px would freeze every layout. Keep width when the element
         is the root, replaced, inline-level, or narrower than its parent's
         content box. Keep height only for the root, replaced elements and
         clipped boxes. */
      const r = n.el.getBoundingClientRect();
      const replaced = MEDIA.has(n.tag) || n.tag === "input" || n.tag === "select" || n.tag === "textarea";
      const grid = Boolean(parentCs && (parentCs.display.includes("grid") || parentCs.display.includes("flex")));
      const sizing = (prop: "width" | "height", fallback: () => void) => {
        if (!base.has(prop) || n.svg) return;
        const sv = spec(n.el, prop);
        if (sv) {
          if (sv === "auto" && !(!n.parent && prop === "width")) base.delete(prop);
          else base.set(prop, sv);
          return;
        }
        if (cascadeReadable && !replaced) {
          /* Every sheet was readable and none set it: it is auto. */
          if (!n.parent && prop === "width") base.set(prop, `${Math.round(r.width)}px`);
          else base.delete(prop);
          return;
        }
        fallback();
      };
      sizing("width", () => {
        const pr = n.parent ? n.parent.el.getBoundingClientRect() : null;
        const inner = pr && parentCs ? pr.width - (px(parentCs.paddingLeft) || 0) - (px(parentCs.paddingRight) || 0) : null;
        const fills = inner != null && Math.abs(inner - r.width - (px(cs.marginLeft) || 0) - (px(cs.marginRight) || 0)) < 1.5;
        if (!n.parent) base.set("width", `${Math.round(r.width)}px`);
        else if (fills || (grid && !replaced) || (n.inline && !replaced)) base.delete("width");
        else if (!replaced && !grid) base.set("width", `${Math.round(r.width)}px`);
      });
      sizing("height", () => {
        const clipped = /hidden|clip|auto|scroll/.test(cs.overflowY);
        if (!(replaced || clipped)) base.delete("height");
        else base.set("height", `${Math.round(r.height)}px`);
      });
      for (const p of ["min-width", "max-width", "min-height", "max-height", "flex-basis", "top", "right", "bottom", "left"]) {
        const sv = spec(n.el, p);
        if (sv && base.has(p)) base.set(p, sv);
      }
      for (const p of ["grid-template-columns", "grid-template-rows"]) {
        if (!base.has(p)) continue;
        const sv = spec(n.el, p);
        if (sv) base.set(p, sv);
        else if (cascadeReadable) base.delete(p); // implicit tracks, computed to px
        else if (p === "grid-template-columns") {
          /* Unreadable sheets: equal px tracks were almost surely `repeat(n, 1fr)`. */
          const tracks = base.get(p)!.split(/\s+/).map(px);
          if (tracks.length > 1 && tracks.every((t) => Math.abs(t - tracks[0]!) < 1)) base.set(p, `repeat(${tracks.length}, minmax(0, 1fr))`);
        } else base.delete(p);
      }
      for (const p of ["margin-left", "margin-right"]) {
        const sv = spec(n.el, p);
        if (sv === "auto" && n.parent) base.set(p, "auto");
      }
      if (!n.parent) {
        base.set("max-width", "100%");
        if (base.get("position") === "fixed" || base.get("position") === "sticky") base.set("position", "relative");
        base.delete("top"); base.delete("left"); base.delete("right"); base.delete("bottom");
        if (base.has("margin-left") || base.has("margin-right")) {
          base.delete("margin-left"); base.delete("margin-right"); base.delete("margin-top"); base.delete("margin-bottom");
        }
      }
      /* Centring (unreadable sheets only): equal non-zero side margins on a narrower block = auto. */
      if (!cascadeReadable && n.parent && !n.inline && base.has("width") && base.has("margin-left") && base.get("margin-left") === base.get("margin-right") && px(base.get("margin-left")!) > 0) {
        base.set("margin-left", "auto");
        base.set("margin-right", "auto");
      }
      const pseudo = (which: "::before" | "::after"): Decls | null => {
        const pcs2 = getComputedStyle(n.el, which);
        const content = pcs2.content;
        if (!content || content === "none" || content === "normal") return null;
        const d: Decls = new Map();
        d.set("content", content);
        for (const p of PROPS) {
          const v = pcs2.getPropertyValue(p);
          if (!v || v === cs.getPropertyValue(p)) continue;
          if (INITIAL[p] === v || (ZERO.has(p) && v === "0px")) continue;
          if (p === "transition" && isDefaultTransition(v)) continue;
          if (p === "animation" && isDefaultAnimation(v)) continue;
          if (p === "background-color" && isTransparent(v)) continue;
          d.set(p, v);
        }
        return d;
      };
      declsOf.set(n, { base, before: pseudo("::before"), after: pseudo("::after") });
    }

    /* ── 2. fold identical sets into classes ── */
    const classes = new Map<string, { cls: string; was: string[]; base: Decls; before: Decls | null; after: Decls | null }>();
    const serial = (d: Decls | null) => (d ? Array.from(d.entries()).map(([k, v]) => `${k}:${v}`).join(";") : "");
    for (const n of nodes) {
      const d = declsOf.get(n)!;
      const key = `${serial(d.base)}|${serial(d.before)}|${serial(d.after)}`;
      let c = classes.get(key);
      if (!c) {
        c = { cls: `c${classes.size + 1}`, was: Array.from(n.el.classList).filter((x) => !x.startsWith("__")).slice(0, 4), base: d.base, before: d.before, after: d.after };
        classes.set(key, c);
      }
      n.cls = c.cls;
    }

    /* ── 3. stylesheets: state rules, keyframes, breakpoints, font faces ── */
    const unreadable: string[] = [];
    const stateRules = new Set<string>();
    const keyframes = new Map<string, string>();
    const breakpoints = new Set<string>();
    const fontFaces: { family: string; urls: string[] }[] = [];
    const subtreeEls = nodes.map((n) => n.el);
    const matchesAny = (sel: string): Element[] => {
      const out: Element[] = [];
      try {
        for (const el of subtreeEls) if (el.matches(sel)) { out.push(el); if (out.length >= 20) break; }
      } catch {}
      return out;
    };
    const resolveVars = (text: string, el: Element) =>
      text.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]*))?\)/g, (_m, name: string, fb: string | undefined) => {
        const v = getComputedStyle(el).getPropertyValue(name).trim();
        return v || (fb ?? "").trim() || "initial";
      });
    const absUrl = (u: string, base?: string | null) => {
      try {
        return new URL(u, base || location.href).href;
      } catch {
        return u;
      }
    };
    function visit(rules: CSSRuleList, sheetHref: string | null, depth: number) {
      if (depth > 6) return;
      for (const rule of Array.from(rules)) {
        try {
          if (rule instanceof CSSStyleRule) {
            const sel = rule.selectorText;
            if (!STATE_TEST.test(sel)) continue;
            for (const one of sel.split(/,(?![^(]*\))/)) {
              const s = one.trim();
              const stripped = s.replace(STATE_RE, "").replace(/\s+/g, " ").trim();
              if (!stripped || stripped === ">" || stripped === "*") continue;
              const compounds = s.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
              const stateIdx = compounds.findIndex((c) => STATE_TEST.test(c));
              if (stateIdx < 0) continue;
              const stateTokens = (compounds[stateIdx]!.match(STATE_RE) || []).join("");
              for (const el of matchesAny(stripped)) {
                const n = byEl.get(el);
                if (!n) continue;
                let selector: string | null = null;
                if (stateIdx === compounds.length - 1) selector = `.${n.cls}${stateTokens}`;
                else {
                  const ancBase = compounds[stateIdx]!.replace(STATE_RE, "") || "*";
                  for (let a = el.parentElement; a && a !== root.parentElement; a = a.parentElement) {
                    const an = byEl.get(a);
                    if (!an) break;
                    try {
                      if (a.matches(ancBase)) { selector = `.${an.cls}${stateTokens} .${n.cls}`; break; }
                    } catch { break; }
                  }
                }
                if (!selector) continue;
                const decls = resolveVars(rule.style.cssText, el).trim();
                if (decls) stateRules.add(`${selector} { ${hexify(decls)} }`);
              }
            }
          } else if (rule instanceof CSSMediaRule) {
            const cond = rule.conditionText || rule.media.mediaText;
            let touches = false;
            for (const inner of Array.from(rule.cssRules)) {
              if (inner instanceof CSSStyleRule) {
                const stripped = inner.selectorText.replace(STATE_RE, "").trim();
                if (stripped && matchesAny(stripped).length) { touches = true; break; }
              }
            }
            if (touches && cond && !/^(all|screen|print)$/.test(cond)) breakpoints.add(cond);
            if (!cond || matchMedia(cond).matches) visit(rule.cssRules, sheetHref, depth + 1);
          } else if (rule instanceof CSSSupportsRule) {
            if (CSS.supports(rule.conditionText)) visit(rule.cssRules, sheetHref, depth + 1);
          } else if (rule instanceof CSSKeyframesRule) {
            keyframes.set(rule.name, hexify(rule.cssText));
          } else if (rule instanceof CSSFontFaceRule) {
            const fam = rule.style.getPropertyValue("font-family").replace(/^["']|["']$/g, "").trim();
            const src = rule.style.getPropertyValue("src") || "";
            const urls = Array.from(src.matchAll(/url\((['"]?)([^'")]+)\1\)/g)).map((m) => absUrl(m[2]!, sheetHref)).filter((u) => !u.startsWith("data:"));
            if (fam) fontFaces.push({ family: fam, urls });
          } else if (rule instanceof CSSImportRule) {
            const s = rule.styleSheet;
            if (s) {
              try { visit(s.cssRules, s.href, depth + 1); } catch { unreadable.push(s.href || "@import"); }
            }
          } else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
            visit((rule as CSSGroupingRule).cssRules, sheetHref, depth + 1);
          }
        } catch {}
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.disabled) continue;
      try {
        visit(sheet.cssRules, sheet.href, 0);
      } catch {
        unreadable.push(sheet.href || "an inline stylesheet");
      }
    }

    /* Keyframes actually used in the subtree. */
    const usedKeyframes = new Map<string, string>();
    const missingKeyframes = new Set<string>();
    for (const n of nodes) {
      const names = getComputedStyle(n.el).animationName.split(",").map((s) => s.trim()).filter((s) => s && s !== "none");
      for (const name of names) {
        const kf = keyframes.get(name);
        if (kf) usedKeyframes.set(name, kf);
        else missingKeyframes.add(name);
      }
    }

    /* ── 4. tokens ── */
    const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
    const colorUse = new Map<string, number>();
    const bgUse = new Map<string, number>();
    const fontUse = new Map<string, number>();
    const scaleUse = new Map<string, number>();
    const spacing = new Set<number>();
    const radii = new Set<number>();
    const shadowUse = new Map<string, number>();
    const firstFamily = (stack: string) => (stack.split(",")[0] || "").trim().replace(/^["']|["']$/g, "");
    for (const n of nodes) {
      const cs = getComputedStyle(n.el);
      if (n.hasText) {
        if (!isTransparent(cs.color)) count(colorUse, toHex(cs.color));
        count(fontUse, firstFamily(cs.fontFamily));
        const fs = px(cs.fontSize);
        const lh = px(cs.lineHeight);
        if (fs) count(scaleUse, `${Math.round(fs * 10) / 10}/${lh ? Math.round((lh / fs) * 100) / 100 : "normal"}`);
      }
      const bg = cs.backgroundColor;
      if (!isTransparent(bg)) { count(colorUse, toHex(bg)); count(bgUse, toHex(bg)); }
      for (const side of ["top", "right", "bottom", "left"]) {
        const bc = cs.getPropertyValue(`border-${side}-color`);
        if (px(cs.getPropertyValue(`border-${side}-width`)) > 0 && cs.getPropertyValue(`border-${side}-style`) !== "none" && !isTransparent(bc)) count(colorUse, toHex(bc));
      }
      if (n.svg) {
        for (const p of ["fill", "stroke"]) {
          const v = cs.getPropertyValue(p);
          if (v && v !== "none" && !isTransparent(v) && parseRgb(v)) count(colorUse, toHex(v));
        }
      }
      for (const p of ["padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left", "row-gap", "column-gap"]) {
        const v = px(cs.getPropertyValue(p));
        if (v > 0) spacing.add(Math.round(v * 10) / 10);
      }
      for (const p of ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"]) {
        const v = px(cs.getPropertyValue(p));
        if (v > 0) radii.add(Math.round(v * 10) / 10);
      }
      if (cs.boxShadow && cs.boxShadow !== "none") count(shadowUse, hexify(cs.boxShadow));
    }
    const mainBg = Array.from(bgUse.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#ffffff";
    const mainL = luminance(hexToRgb(mainBg)) ?? 1;
    const sorted = (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([value, c]) => ({ value, count: c }));
    const tokens: ClipTokens = {
      colors: sorted(colorUse).slice(0, 40).map((t) => {
        const rgb = hexToRgb(t.value);
        const l = luminance(rgb);
        const out: ClipTokens["colors"][number] = { value: t.value, count: t.count };
        const hsl = toHsl(rgb);
        if (hsl) out.hsl = hsl;
        if (l != null) out.contrast = Math.round(((Math.max(l, mainL) + 0.05) / (Math.min(l, mainL) + 0.05)) * 100) / 100;
        return out;
      }),
      fonts: sorted(fontUse).slice(0, 20),
      typeScale: sorted(scaleUse).slice(0, 30),
      spacing: Array.from(spacing).sort((a, b) => a - b).slice(0, 40),
      radii: Array.from(radii).sort((a, b) => a - b).slice(0, 20),
      shadows: sorted(shadowUse).slice(0, 12),
      breakpoints: Array.from(breakpoints).slice(0, 12),
    };

    /* ── 5. assets ── */
    const assets: ClipAsset[] = [];
    const seen = new Set<string>();
    let images = 0;
    for (const n of nodes) {
      if (n.tag === "img") {
        const img = n.el as HTMLImageElement;
        const url = img.currentSrc || img.src;
        images++;
        if (url && !url.startsWith("data:") && !seen.has(url)) {
          seen.add(url);
          assets.push({ kind: "image", url: absUrl(url), alt: img.alt || "", rendered: [Math.round(img.clientWidth), Math.round(img.clientHeight)], natural: [img.naturalWidth, img.naturalHeight] });
        }
      }
      const bgi = getComputedStyle(n.el).backgroundImage;
      if (bgi && bgi !== "none") {
        for (const m of bgi.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
          const u = absUrl(m[2]!);
          if (u.startsWith("data:") || seen.has(u)) continue;
          seen.add(u);
          images++;
          assets.push({ kind: "background", url: u });
        }
      }
    }
    /* Lottie / dotLottie players: Webflow's data-animation-type="lottie" + data-src,
       the <lottie-player>/<dotlottie-player> elements, and lottie-web's data-src.
       The markup can only hold one frame; the file is what rebuilds the motion. */
    for (const n of nodes) {
      const el = n.el as HTMLElement;
      const tag = n.tag;
      const isPlayer = tag === "lottie-player" || tag === "dotlottie-player" || tag === "dotlottie-wc";
      const isData = el.dataset?.animationType === "lottie" || (el.dataset?.src != null && /lottie|\.json(\?|$)/i.test(el.dataset.src));
      if (!isPlayer && !isData) continue;
      const raw = el.getAttribute("src") || el.dataset?.src || "";
      if (!raw) continue;
      const u = absUrl(raw);
      if (seen.has(u)) continue;
      seen.add(u);
      assets.push({ kind: "lottie", url: u, player: isPlayer ? tag : "lottie-web", loop: el.hasAttribute("loop") ? el.getAttribute("loop") !== "false" : el.dataset?.loop === "1" || el.dataset?.loop === "true", autoplay: el.hasAttribute("autoplay") ? el.getAttribute("autoplay") !== "false" : el.dataset?.autoplay === "1" || el.dataset?.autoplay === "true" });
    }
    for (const f of tokens.fonts) {
      const faces = fontFaces.filter((x) => x.family.toLowerCase() === f.value.toLowerCase());
      assets.push({ kind: "font", family: f.value, urls: Array.from(new Set(faces.flatMap((x) => x.urls))).slice(0, 8) });
    }

    /* ── 6. markup ── */
    const defs: string[] = [];
    const defsSeen = new Set<string>();
    const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");
    const absSrcset = (v: string) => v.split(",").map((part) => { const [u, ...rest] = part.trim().split(/\s+/); return u ? [absUrl(u), ...rest].join(" ") : ""; }).filter(Boolean).join(", ");
    const inlineDef = (ref: string) => {
      if (!ref.startsWith("#") || defsSeen.has(ref)) return;
      const target = document.getElementById(ref.slice(1));
      if (!target || byEl.has(target)) return;
      defsSeen.add(ref);
      defs.push(target.outerHTML.replace(/\son\w+="[^"]*"/g, ""));
    };
    let elementCount = 0;
    function serialize(n: Node, indent: string): string {
      const el = n.el;
      elementCount++;
      const tag = n.tag;
      /* Every element gets its folded class, whether or not the source had one. */
      const attrs: string[] = n.cls ? [`class="${n.cls}"`] : [];
      for (const a of Array.from(el.attributes)) {
        const name = a.name;
        if (/^on/i.test(name) || name.startsWith("data-") || name === "style" || name.startsWith("ng-") || name.startsWith("x-") || name.startsWith("v-") || name.startsWith("_")) continue;
        if (name === "class") continue;
        if (!n.svg && !KEEP_ATTR.has(name) && !name.startsWith("aria-")) continue;
        if (name === "value" || name === "checked" || name === "selected") { if (tag === "input" || tag === "textarea") continue; }
        let v = a.value;
        if (URL_ATTR.has(name)) {
          if (/^\s*javascript:/i.test(v)) continue;
          if (v.startsWith("#")) { if (n.svg) inlineDef(v); }
          else if (v.startsWith("data:")) { if (v.length > 20_000) continue; }
          else v = absUrl(v);
        }
        if (name === "srcset") v = absSrcset(v);
        if (name === "width" || name === "height") { if (!MEDIA.has(tag) && !n.svg) continue; }
        attrs.push(v === "" ? name : `${name}="${escAttr(v)}"`);
      }
      const open = `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>`;
      if (VOID.has(tag)) return open;
      const kids: string[] = [];
      let blockChild = false;
      for (const c of Array.from(el.childNodes)) {
        if (c.nodeType === 3) {
          const t = c.textContent || "";
          if (/\S/.test(t)) kids.push(escText(getComputedStyle(el).whiteSpace.startsWith("pre") ? t : t.replace(/\s+/g, " ")));
          else if (kids.length && !blockChild) kids.push(" ");
        } else if (c.nodeType === 1) {
          const cn = byEl.get(c as Element);
          if (!cn) continue;
          if (tag === "textarea") continue;
          if (!cn.inline) { blockChild = true; kids.push(`\n${indent}  ${serialize(cn, indent + "  ")}`); }
          else kids.push(serialize(cn, indent + "  "));
        }
      }
      const inner = kids.join("").replace(/^ +| +$/g, "");
      return `${open}${inner}${blockChild ? `\n${indent}` : ""}</${tag}>`;
    }
    const rootNode = nodes[0]!;
    let html = serialize(rootNode, "");
    if (defs.length) html = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>\n${defs.join("\n")}\n</defs></svg>\n${html}`;
    html += "\n";
    if (html.length > maxHtml) return { error: "the markup is over 200 KB — pick something smaller (Narrow)" };

    /* ── 7. CSS text — with the four-side shorthands collapsed so a card
       reads as `padding: 12px 22px` and `border-radius: 999px`, not eight
       lines. ── */
    const SIDES = ["top", "right", "bottom", "left"];
    const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
    function collapse(d: Decls): Decls {
      const out: Decls = new Map(d);
      const box = (pre: string, names: string[], prop: string) => {
        const vals = names.map((n) => out.get(`${pre}${n}`));
        if (vals.some((v) => v == null)) return;
        for (const n of names) out.delete(`${pre}${n}`);
        const [t, r, b, l] = vals as [string, string, string, string];
        out.set(prop, t === r && r === b && b === l ? t : t === b && r === l ? `${t} ${r}` : `${t} ${r} ${b} ${l}`);
      };
      box("padding-", SIDES, "padding");
      box("margin-", SIDES, "margin");
      box("border-", CORNERS.map((c) => `${c}-radius`), "border-radius");
      const sides = SIDES.map((sd) => [out.get(`border-${sd}-width`), out.get(`border-${sd}-style`), out.get(`border-${sd}-color`)]);
      if (sides.every((x) => x.every((v) => v != null)) && sides.every((x) => x.join("|") === sides[0]!.join("|"))) {
        for (const sd of SIDES) for (const k of ["width", "style", "color"]) out.delete(`border-${sd}-${k}`);
        out.set("border", `${sides[0]![0]} ${sides[0]![1]} ${sides[0]![2]}`);
      }
      return out;
    }
    const emit = (d: Decls) => Array.from(collapse(d).entries()).map(([k, v]) => `  ${k}: ${hexify(v)};`).join("\n");
    const css: string[] = [];
    css.push(`/* Clipped by IMRedline from ${location.host}${location.pathname} — computed styles folded into classes. */`);
    css.push(`/* Classes are .c1 .c2 … in order of first use; the comment on each says what the source called it. */`);
    css.push("");
    /* Reset-style sites put box-sizing on everything; say it once. */
    const bb = nodes.filter((n) => getComputedStyle(n.el).boxSizing === "border-box").length;
    if (bb >= nodes.length * 0.8 && bb > 1) {
      css.push(`.${nodes[0]!.cls}, .${nodes[0]!.cls} * { box-sizing: border-box; }`, "");
      for (const c of classes.values()) if (c.base.get("box-sizing") === "border-box") c.base.delete("box-sizing");
    }
    for (const c of classes.values()) {
      const was = c.was.length ? ` /* was: ${c.was.join(" ")} */` : "";
      if (c.base.size) css.push(`.${c.cls} {${was}\n${emit(c.base)}\n}`);
      else if (was) css.push(`.${c.cls} {${was} }`);
      if (c.before) css.push(`.${c.cls}::before {\n${emit(c.before)}\n}`);
      if (c.after) css.push(`.${c.cls}::after {\n${emit(c.after)}\n}`);
    }
    if (stateRules.size) {
      css.push("", `/* States, from readable stylesheets (${stateRules.size}). */`);
      css.push(...stateRules);
    }
    if (usedKeyframes.size) {
      css.push("", `/* Keyframes (${usedKeyframes.size}). */`);
      css.push(...usedKeyframes.values());
    }
    if (missingKeyframes.size) css.push("", `/* Keyframes used but not readable: ${Array.from(missingKeyframes).join(", ")} */`);
    if (unreadable.length) css.push("", `/* ${unreadable.length} stylesheet(s) could not be read (cross-origin): hover/focus/keyframe rules from them are missing. */`);
    let cssText = css.join("\n") + "\n";
    if (cssText.length > 200_000) cssText = cssText.slice(0, 200_000);

    return {
      html,
      css: cssText,
      tokens,
      assets,
      states: unreadable.length ? "partial" : "full",
      unreadable: Array.from(new Set(unreadable)).slice(0, 20),
      counts: { elements: elementCount, images, fonts: tokens.fonts.length, stateRules: stateRules.size, keyframes: usedKeyframes.size },
      bounds: { width: Math.round(rootRect.width), height: Math.round(rootRect.height) },
      selector: selectorFor(root),
    };
  } catch (e) {
    return { error: (e instanceof Error && e.message) || "clip failed" };
  } finally {
    defaults.dispose();
    if (warnings.length) console.warn("[imredline clip]", warnings.join("; "));
  }
}

function hexToRgb(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) return hex;
  const a = m[4] ? parseInt(m[4], 16) / 255 : 1;
  return a < 1 ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${Math.round(a * 100) / 100})` : `rgb(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)})`;
}

/** A sensible default name for a clip, from what the element is. */
export function suggestName(el: Element): string {
  const host = el instanceof HTMLElement ? el : el.parentElement ?? el;
  const tag = host.tagName.toLowerCase();
  const landmark = host.closest("nav, header, footer, aside, form, main, section, article");
  const role = host.getAttribute("role") || "";
  const text = (host.textContent || "").trim().toLowerCase();
  if (tag === "nav" || role === "navigation") return "nav";
  if (tag === "header") return "header";
  if (tag === "footer") return "footer";
  if (tag === "form") return "form";
  if (tag === "button" || role === "button" || (tag === "a" && /btn|button/.test(host.className))) return "button";
  if (/pric|plan/.test(host.className) || /\/(mo|month|year)\b/.test(text)) return "pricing";
  if (/card/.test(host.className)) return "card";
  if (/hero/.test(host.className) || (tag === "section" && host.querySelector("h1"))) return "hero";
  if (/testimonial|quote|review/.test(host.className)) return "testimonial";
  if (/faq|accordion/.test(host.className)) return "faq";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (/modal|dialog/.test(host.className) || tag === "dialog") return "modal";
  if (tag === "table") return "table";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "img" || tag === "picture" || tag === "figure") return "image";
  /* A source class is a good name only when it names a THING. Utility
     classes (Tailwind and friends) name a property, and a clip called
     "hidden" or "relative" helps nobody. */
  const UTILITY = /^(hidden|block|inline|flex|grid|contents|relative|absolute|fixed|sticky|static|container|wrapper|inner|outer|content|row|col|columns?|item|items|center|left|right|top|bottom|full|auto|screen|truncate|uppercase|lowercase|capitalize|italic|underline|antialiased|transition|transform|shadow|rounded|border|overflow|visible|invisible|group|peer|isolate|sr-only|clearfix|active|open|show|hide|dark|light|sm|md|lg|xl|xxl|is-\w+|has-\w+|js-\w+)$/;
  const cls = Array.from(host.classList).find((c) => /^[a-z][a-z]+(?:[-_]+[a-z]+)*$/.test(c) && c.length >= 3 && c.length <= 24 && !UTILITY.test(c) && !/^(w|h|m|p|mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py|gap|space|text|bg|font|leading|tracking|z|order|inset|max|min|basis|grow|shrink|justify|self|place|object|aspect|opacity|blur|ring|outline|divide|decoration|list|whitespace|break|align|table|origin|scale|rotate|translate|skew|duration|ease|delay|animate|cursor|select|resize|scroll|snap|touch|will|fill|stroke|from|via|to|col|row|size|line|indent|content|caret|accent|appearance|pointer|backdrop|mix|filter|brightness|contrast|grayscale|hue|invert|saturate|sepia|drop|sub|sup|not|first|last|odd|even|only|empty|focus|hover|group|peer|dark|print|motion|portrait|landscape|rtl|ltr|before|after|placeholder|marker|selection|file|backdrop|xs|sm|md|lg|xl)-/.test(c));
  if (cls) return cls;
  if (landmark && landmark !== host) return `${landmark.tagName.toLowerCase()}-part`;
  return tag === "div" || tag === "section" ? "section" : tag;
}
