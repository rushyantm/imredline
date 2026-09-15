/*
  Clip, server side: re-validate what the widget captured, then render the
  folder that lands on the clips branch:

    clips/<collection>/<slug>/
      README.md        the prompt — what it is, where from, tokens, how to rebuild
      component.html   cleaned markup, classes rewritten to .c1 .c2 …
      component.css    folded computed styles + state rules + keyframes
      tokens.json
      meta.json
      screenshot.jpg   (when the capture worked)
      preview.html     html + css in one file, opens in a browser

  The widget extracts; this file only checks caps, strips what must not
  reach a repo, and writes the human-readable pieces. Nothing here fetches a
  URL — asset bytes never travel (spec §5).
*/

import {
  CLIP_CSS_MAX,
  CLIP_ELEMENTS_MAX,
  CLIP_HTML_MAX,
  CLIP_NOTE_MAX,
  type ClipAsset,
  type ClipIndexEntry,
  type ClipInput,
  type ClipTokens,
} from "./types.js";
import { clean, parseDevice, parseViewport, Reject, viewportText } from "./validate.js";

const fail = (m: string, s = 400): never => {
  throw new Reject(m, s);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Folder-safe: lower-case, dashes, no leading/trailing dash, capped. */
export function clipSlug(raw: unknown, max = 40): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

function httpUrl(raw: unknown, max = 2048): string {
  const v = clean(raw, max).replace(/[\s<>`]/g, "");
  try {
    const u = new URL(v);
    if (!["https:", "http:"].includes(u.protocol)) return "";
    u.username = "";
    u.password = "";
    return u.href;
  } catch {
    return "";
  }
}

function tokenList(raw: unknown, max: number, valueMax: number): { value: string; count: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, max)
    .map((t) => {
      const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
      const value = clean(o.value, valueMax).replace(/[\n\t<>`]/g, "");
      const count = typeof o.count === "number" && Number.isFinite(o.count) ? Math.max(0, Math.round(o.count)) : 0;
      return { value, count };
    })
    .filter((t) => t.value);
}
function numberList(raw: unknown, max: number): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 10_000)
    .map((n) => Math.round(n * 100) / 100)
    .slice(0, max);
}

export function parseTokens(raw: unknown): ClipTokens {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const colors = (Array.isArray(t.colors) ? t.colors : []).slice(0, 40).flatMap((c) => {
    const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const value = clean(o.value, 60).replace(/[\n\t<>`]/g, "");
    if (!/^(#[0-9a-f]{3,8}|rgba?\([^)]{1,40}\)|hsla?\([^)]{1,40}\))$/i.test(value)) return [];
    const out: ClipTokens["colors"][number] = { value, count: typeof o.count === "number" ? Math.max(0, Math.round(o.count)) : 0 };
    const hsl = clean(o.hsl, 60).replace(/[\n\t<>`]/g, "");
    if (/^hsl\([^)]{1,40}\)$/i.test(hsl)) out.hsl = hsl;
    if (typeof o.contrast === "number" && Number.isFinite(o.contrast)) out.contrast = Math.round(o.contrast * 100) / 100;
    return [out];
  });
  return {
    colors,
    fonts: tokenList(t.fonts, 20, 120),
    typeScale: tokenList(t.typeScale, 30, 30),
    spacing: numberList(t.spacing, 40),
    radii: numberList(t.radii, 20),
    shadows: tokenList(t.shadows, 12, 200),
    breakpoints: (Array.isArray(t.breakpoints) ? t.breakpoints : [])
      .map((b) => clean(b, 120).replace(/[\n\t<>`]/g, ""))
      .filter(Boolean)
      .slice(0, 12),
  };
}

export function parseAssets(raw: unknown): ClipAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: ClipAsset[] = [];
  for (const a of raw.slice(0, 200)) {
    const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    const pair = (v: unknown): [number, number] => {
      const p = Array.isArray(v) ? v : [0, 0];
      const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0);
      return [n(p[0]), n(p[1])];
    };
    if (o.kind === "image") {
      const url = httpUrl(o.url);
      if (url) out.push({ kind: "image", url, alt: clean(o.alt, 200).replace(/[\n\t]/g, " "), rendered: pair(o.rendered), natural: pair(o.natural) });
    } else if (o.kind === "background") {
      const url = httpUrl(o.url);
      if (url) out.push({ kind: "background", url });
    } else if (o.kind === "font") {
      const family = clean(o.family, 120).replace(/[\n\t<>`]/g, "");
      const urls = (Array.isArray(o.urls) ? o.urls : []).map(httpUrl).filter(Boolean).slice(0, 8);
      if (family) out.push({ kind: "font", family, urls });
    }
  }
  return out;
}

/** Markup that must not reach a repo even if the widget's cleaner missed it. */
const FORBIDDEN_TAG = /<\s*\/?\s*(script|iframe|object|embed|noscript|template|link|meta|base)\b/i;
const ON_ATTR = /\son[a-z]+\s*=/i;

export function parseClip(body: unknown): ClipInput {
  if (!body || typeof body !== "object") fail("Invalid clip.");
  const b = body as Record<string, unknown>;
  if (b.website) fail("Request not accepted.");
  const requestId = String(b.requestId || "");
  if (!UUID.test(requestId)) fail("Reload the page and try the clip again.");
  const name = clipSlug(b.name) || "component";
  const collection = clipSlug(b.collection) || "inbox";
  const note = clean(b.note, CLIP_NOTE_MAX + 1);
  if (note.length > CLIP_NOTE_MAX) fail(`Keep the note under ${CLIP_NOTE_MAX} characters.`);

  const html = typeof b.html === "string" ? b.html : "";
  if (!html.trim()) fail("Nothing was captured — pick an element and try again.");
  if (html.length > CLIP_HTML_MAX) fail("That component is too big to clip — pick something smaller (Narrow).");
  if (FORBIDDEN_TAG.test(html) || ON_ATTR.test(html)) fail("The captured markup carried scripts; that is not clippable.");
  const css = typeof b.css === "string" ? b.css : "";
  if (css.length > CLIP_CSS_MAX) fail("That component's styles are too big to clip — pick something smaller (Narrow).");
  if (/<\/?style|<script|javascript:|expression\(/i.test(css)) fail("The captured styles carried something that is not CSS.");

  const countsRaw = (b.counts && typeof b.counts === "object" ? b.counts : {}) as Record<string, unknown>;
  const n = (k: string) => (typeof countsRaw[k] === "number" && Number.isFinite(countsRaw[k]) ? Math.max(0, Math.round(countsRaw[k] as number)) : 0);
  const counts = { elements: n("elements"), images: n("images"), fonts: n("fonts"), stateRules: n("stateRules"), keyframes: n("keyframes") };
  /* The widget counts; the server distrusts the count and counts tags too. */
  const tagCount = (html.match(/<[a-z][^\s/>]*/gi) || []).length;
  if (counts.elements > CLIP_ELEMENTS_MAX || tagCount > CLIP_ELEMENTS_MAX) fail(`Up to ${CLIP_ELEMENTS_MAX} elements per clip — pick something smaller (Narrow).`);

  const src = (b.source && typeof b.source === "object" ? b.source : {}) as Record<string, unknown>;
  const sourceUrl = httpUrl(src.url);
  if (!sourceUrl) fail("The clip has no source address.");
  const source = { url: sourceUrl, title: clean(src.title, 200).replace(/[\n\t]/g, " ") };

  const boundsRaw = (b.bounds && typeof b.bounds === "object" ? b.bounds : {}) as Record<string, unknown>;
  const dim = (k: string) => (typeof boundsRaw[k] === "number" && Number.isFinite(boundsRaw[k]) ? Math.max(0, Math.min(100_000, Math.round(boundsRaw[k] as number))) : 0);
  const out: ClipInput = {
    requestId: requestId.toLowerCase(),
    name,
    collection,
    note,
    source,
    selector: clean(b.selector, 500).replace(/[`\n]/g, ""),
    bounds: { width: dim("width"), height: dim("height") },
    html,
    css,
    tokens: parseTokens(b.tokens),
    assets: parseAssets(b.assets),
    states: b.states === "partial" ? "partial" : "full",
    unreadable: (Array.isArray(b.unreadable) ? b.unreadable : []).map((u) => clean(u, 300).replace(/[\n\t<>`]/g, "")).filter(Boolean).slice(0, 20),
    counts,
  };
  const viewport = parseViewport(b.viewport);
  if (viewport) out.viewport = viewport;
  const device = parseDevice(b.device);
  if (device) out.device = device;
  if (typeof b.screenshot === "string" && b.screenshot) out.screenshot = b.screenshot;
  const shotError = clean(b.shotError, 200).replace(/\n/g, " ");
  if (shotError) out.shotError = shotError;
  if (typeof b.token === "string" && b.token) out.token = b.token.trim().slice(0, 200);
  return out;
}

/* ── rendering ── */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const md = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function deviceText(d: ClipInput["device"]): string | null {
  return d ? `${d.kind} · ${d.orientation}${d.touch ? " · touch" : ""}` : null;
}

export function renderReadme(c: ClipInput, meta: { collection: string; slug: string; reviewer: string; clippedAt: string; hasShot: boolean; hostOf: string }): string {
  const t = c.tokens;
  const lines: string[] = [];
  lines.push(`# ${c.name} — clipped from ${meta.hostOf}`);
  lines.push("");
  lines.push(`> A component clipped for inspiration with IMRedline. Rebuild the *look and behaviour*; the words and pictures belong to the source and are here only so the layout reads.`);
  lines.push("");
  lines.push(`- **source:** ${c.source.url}${c.source.title ? ` — “${md(c.source.title)}”` : ""}`);
  lines.push(`- **clipped:** ${meta.clippedAt} by ${md(meta.reviewer)}`);
  lines.push(`- **collection:** ${meta.collection}`);
  if (c.selector) lines.push(`- **element:** \`${c.selector.replace(/`/g, "")}\``);
  lines.push(`- **size:** ${c.bounds.width}×${c.bounds.height} px${c.viewport ? ` in a ${viewportText(c.viewport)} viewport` : ""}${c.device ? ` (${deviceText(c.device)})` : ""}`);
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  lines.push(`- **captured:** ${pl(c.counts.elements, "element")} · ${pl(c.counts.images, "image")} · ${pl(c.counts.fonts, "font")} · ${pl(c.counts.stateRules, "hover/focus rule")} · ${pl(c.counts.keyframes, "keyframe")}`);
  lines.push(`- **states:** ${c.states === "full" ? "complete — every stylesheet was readable" : `partial — ${c.unreadable.length} stylesheet(s) were cross-origin and could not be read, so some hover/focus/animation rules are missing (the resting look is complete)`}`);
  if (c.note) {
    lines.push("");
    lines.push(`## Why it was clipped`);
    lines.push("");
    lines.push(c.note);
  }
  lines.push("");
  lines.push(`## Files`);
  lines.push("");
  lines.push(`| file | what |`);
  lines.push(`|---|---|`);
  lines.push(`| \`component.html\` | the markup, cleaned: no scripts, no tracking attributes, classes rewritten to \`.c1 .c2 …\` (the original class names sit in a comment on first use in the CSS) |`);
  lines.push(`| \`component.css\` | the computed styles folded into those classes, then hover/focus/active rules and keyframes where the browser could read them |`);
  lines.push(`| \`tokens.json\` | colours, fonts, type scale, spacing, radii, shadows, breakpoints — the reusable part |`);
  lines.push(`| \`preview.html\` | html + css in one file; open it in a browser |`);
  if (meta.hasShot) lines.push(`| \`screenshot.jpg\` | what it looked like at capture time |`);
  lines.push(`| \`meta.json\` | source, viewport, device, counts, widget version |`);
  lines.push("");
  lines.push(`## Tokens`);
  lines.push("");
  if (t.colors.length) {
    lines.push(`**Colours** (by use)`);
    lines.push("");
    lines.push(`| colour | hsl | uses | contrast vs main background |`);
    lines.push(`|---|---|---|---|`);
    for (const col of t.colors.slice(0, 16)) lines.push(`| \`${col.value}\` | ${col.hsl ?? ""} | ${col.count} | ${col.contrast != null ? col.contrast.toFixed(2) : ""} |`);
    lines.push("");
  }
  if (t.fonts.length) lines.push(`**Fonts:** ${t.fonts.map((f) => `${f.value} ×${f.count}`).join(", ")}`);
  if (t.typeScale.length) lines.push(`**Type scale (px size/line-height):** ${t.typeScale.map((f) => `${f.value} ×${f.count}`).join(", ")}`);
  if (t.spacing.length) lines.push(`**Spacing (px):** ${t.spacing.join(" ")}`);
  if (t.radii.length) lines.push(`**Radii (px):** ${t.radii.join(" ")}`);
  if (t.shadows.length) lines.push(`**Shadows:** ${t.shadows.map((s) => `\`${s.value}\``).join(", ")}`);
  if (t.breakpoints.length) lines.push(`**Breakpoints that touched it:** ${t.breakpoints.map((b) => `\`${b}\``).join(", ")}`);
  const imgs = c.assets.filter((a) => a.kind === "image");
  const fonts = c.assets.filter((a) => a.kind === "font");
  const bgs = c.assets.filter((a) => a.kind === "background");
  if (imgs.length || bgs.length || fonts.length) {
    lines.push("");
    lines.push(`## Assets (not copied — download only if you have the right to)`);
    lines.push("");
    for (const a of imgs) if (a.kind === "image") lines.push(`- image ${a.url} — rendered ${a.rendered[0]}×${a.rendered[1]}, natural ${a.natural[0]}×${a.natural[1]}${a.alt ? `, alt “${md(a.alt)}”` : ""}`);
    for (const a of bgs) if (a.kind === "background") lines.push(`- background ${a.url}`);
    for (const a of fonts) if (a.kind === "font") lines.push(`- font ${a.family}${a.urls.length ? ` — ${a.urls.join(", ")}` : " (source not readable)"}`);
  }
  lines.push("");
  lines.push(`## How to rebuild this`);
  lines.push("");
  lines.push(`1. Open \`preview.html\` next to \`screenshot.jpg\` and note what carries the feel: the type scale, the spacing rhythm, the one accent colour, the motion.`);
  lines.push(`2. Rebuild it in the target site's own components and tokens. Map the colours in \`tokens.json\` onto the target palette — do not paste hex values.`);
  lines.push(`3. Replace every word and picture. The copy and the images in \`component.html\` are the source site's.`);
  lines.push(`4. ${c.states === "full" ? "Keep the hover/focus rules and the keyframes; they are in `component.css`." : "Hover/focus and motion were only partly captured — design those states yourself."}`);
  lines.push(`5. Check it at the other viewport. This clip is one size; a phone clip of the same component is a separate folder.`);
  lines.push("");
  return lines.join("\n");
}

export function renderPreview(c: ClipInput, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — IMRedline clip</title>
<style>
html,body{margin:0;padding:0}
body{padding:24px;background:#f4f4f4}
.imr-clip-stage{display:inline-block;max-width:100%;background:#fff}
</style>
<style>
${c.css}
</style>
</head>
<body>
<div class="imr-clip-stage">
${c.html}
</div>
</body>
</html>
`;
}

export function indexEntry(
  c: ClipInput,
  meta: { collection: string; slug: string; reviewer: string; clippedAt: string; hasShot: boolean; hostOf: string; path: string },
): ClipIndexEntry {
  return {
    collection: meta.collection,
    slug: meta.slug,
    name: c.name,
    note: c.note.slice(0, 200),
    reviewer: meta.reviewer,
    source: { host: meta.hostOf, url: c.source.url, title: c.source.title },
    clippedAt: meta.clippedAt,
    device: deviceText(c.device),
    viewport: viewportText(c.viewport),
    bounds: [c.bounds.width, c.bounds.height],
    states: c.states,
    counts: c.counts,
    colors: c.tokens.colors.slice(0, 6).map((x) => x.value),
    fonts: c.tokens.fonts.slice(0, 3).map((x) => x.value),
    screenshot: meta.hasShot ? `${meta.path}/screenshot.jpg` : null,
    path: meta.path,
  };
}

/** The next free `name-NN` in a collection, from the index. */
export function nextSlug(entries: ClipIndexEntry[], collection: string, name: string): string {
  let n = 0;
  for (const e of entries) {
    if (e.collection !== collection) continue;
    const m = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`).exec(e.slug);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${name}-${String(n + 1).padStart(2, "0")}`;
}

export function parseIndex(raw: string | null): ClipIndexEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as ClipIndexEntry[]).filter((e) => e && typeof e === "object" && typeof e.slug === "string") : [];
  } catch {
    return [];
  }
}
