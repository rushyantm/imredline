#!/usr/bin/env node
/*
  imredline-audit helper. Three verbs, all through the `gh` CLI (already
  signed in on the owner's machine; no token handling here):

    node audit-clip.mjs facts   <owner/repo> <clips/coll/slug>     → JSON + a markdown facts block on stdout
    node audit-clip.mjs list    <owner/repo> [collection]          → the index, newest first
    node audit-clip.mjs publish <owner/repo> <clips/coll/slug> <audit.md> [--issues <owner/repo> --site <label>]
                                                                   → writes audit.md to the clips branch, marks
                                                                     the index entry audited, optionally files one
                                                                     tester-feedback issue per "### " finding

  `facts` is deterministic: it measures what CSS, HTML and tokens say
  (contrast, tap targets, type scale, spacing, hierarchy, copy length, motion,
  state coverage, images, palette, semantics). It never judges. The skill
  reads the facts, the screenshot and the README, then writes the judgement.
*/

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BRANCH = "imredline-clips";
const [verb, repo, ...rest] = process.argv.slice(2);
if (!verb || !repo) usage();

function usage() {
  console.error("usage: audit-clip.mjs facts|list|publish <owner/repo> …  (see header)");
  process.exit(2);
}
function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 50 * 1024 * 1024 });
}
function raw(path) {
  try {
    return gh(["api", `repos/${repo}/contents/${path}?ref=${BRANCH}`, "-H", "Accept: application/vnd.github.raw"]);
  } catch {
    return null;
  }
}
function fileSha(path) {
  try {
    return JSON.parse(gh(["api", `repos/${repo}/contents/${encodeURI(path)}?ref=${BRANCH}`])).sha;
  } catch {
    return null;
  }
}
function put(path, content, message) {
  const sha = fileSha(path);
  const body = JSON.stringify({ message, content: Buffer.from(content, "utf8").toString("base64"), branch: BRANCH, ...(sha ? { sha } : {}) });
  gh(["api", "-X", "PUT", `repos/${repo}/contents/${encodeURI(path)}`, "--input", "-"], body);
}

/* ── tiny CSS + HTML readers for our own clean output ── */
function parseCss(css) {
  const classes = new Map(); // ".c3" → {props: Map, was: string}
  const states = []; // {selector, decls}
  let keyframes = 0;
  let reducedMotion = /prefers-reduced-motion/.test(css);
  for (const m of css.matchAll(/(@keyframes\s+[\w-]+)|([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]) {
      keyframes++;
      continue;
    }
    const sel = (m[2] || "").trim();
    const decls = (m[3] || "").trim();
    if (!sel || sel.startsWith("@")) continue;
    const props = new Map();
    for (const d of decls.split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      props.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    const single = /^\.(c\d+)(::before|::after)?\s*\{?$/.exec(sel + "{");
    if (single && !single[2]) {
      const was = /\/\*\s*was:\s*([^*]+)\*\//.exec(m[0])?.[1]?.trim() || "";
      classes.set(single[1], { props, was });
    } else if (/:(hover|focus|active|checked|disabled|target)|\[aria-/.test(sel)) states.push({ selector: sel, decls, props });
  }
  return { classes, states, keyframes, reducedMotion };
}
const VOID = new Set(["area", "br", "col", "hr", "img", "input", "source", "track", "wbr"]);
function parseHtml(html) {
  /* Elements with tag, class, attrs, parent, text. Good enough for the markup this package writes. */
  const nodes = [];
  const stack = [];
  const re = /<\/?([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  for (const m of html.matchAll(re)) {
    if (m[3] != null) {
      const t = m[3].replace(/\s+/g, " ").trim();
      if (t && stack.length) stack[stack.length - 1].text += (stack[stack.length - 1].text ? " " : "") + t;
      continue;
    }
    const tag = m[1].toLowerCase();
    if (m[0].startsWith("</")) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const attrs = {};
    for (const a of m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
    const node = { tag, cls: attrs.class || "", attrs, parent: stack[stack.length - 1] || null, text: "", children: 0 };
    if (node.parent) node.parent.children++;
    nodes.push(node);
    if (!VOID.has(tag) && !m[0].endsWith("/>")) stack.push(node);
  }
  return nodes;
}
const px = (v) => (v && /px$/.test(v) ? parseFloat(v) : NaN);
function hexRgb(h) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(h || "");
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), m[4] ? parseInt(m[4], 16) / 255 : 1];
}
function lum([r, g, b]) {
  const f = (n) => { const x = n / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100; };
const styleOf = (node, classes) => classes.get((node.cls.match(/\bc\d+\b/) || [])[0])?.props || new Map();
const inherit = (node, classes, prop) => { for (let n = node; n; n = n.parent) { const v = styleOf(n, classes).get(prop); if (v) return v; } return null; };
const bgOf = (node, classes, fallback) => { for (let n = node; n; n = n.parent) { const v = styleOf(n, classes).get("background-color"); if (v && hexRgb(v) && hexRgb(v)[3] > 0.5) return v; } return fallback; };

function facts(clip) {
  const css = parseCss(clip.css);
  const nodes = parseHtml(clip.html);
  const tokens = clip.tokens;
  const meta = clip.meta;
  const out = { clip: clip.path, source: meta.source?.url, size: meta.bounds, states: meta.states, counts: meta.counts, findings: [] };
  const add = (check, severity, selector, detail, value) => out.findings.push({ check, severity, selector, detail, value });
  const sel = (n) => `.${(n.cls.match(/\bc\d+\b/) || ["?"])[0]}${n.attrs.id ? "#" + n.attrs.id : ""} <${n.tag}>`;
  /* The widget computed every colour's contrast against the real main
     background; the one at exactly 1:1 IS that background. When no element
     painted a background (a white page), it is absent → white. */
  const rootBg = styleOf(nodes[0] || { cls: "", parent: null }, css.classes).get("background-color");
  const mainBg = (rootBg && hexRgb(rootBg)?.[3] === 1 ? rootBg : null) || tokens.colors?.find((c) => c.contrast === 1 && hexRgb(c.value)?.[3] === 1)?.value || "#ffffff";

  /* 1. contrast, per text element on its own effective background */
  for (const n of nodes) {
    if (!n.text) continue;
    const color = inherit(n, css.classes, "color") || "#000000";
    const bg = bgOf(n, css.classes, mainBg);
    const c = hexRgb(color), b = hexRgb(bg);
    if (!c || !b || c[3] < 1) continue;
    const ratio = contrast(c, b);
    const size = px(inherit(n, css.classes, "font-size")) || 16;
    const weight = parseInt(inherit(n, css.classes, "font-weight") || "400", 10);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    if (ratio < need) add("contrast", ratio < need * 0.7 ? "high" : "medium", sel(n), `${color} on ${bg} = ${ratio}:1, needs ${need}:1 (${large ? "large" : "normal"} text ${size}px) — "${n.text.slice(0, 40)}"`, ratio);
  }

  /* 2. tap targets: links, buttons, inputs — height from line-height + padding */
  for (const n of nodes) {
    if (!["a", "button", "input", "select", "textarea"].includes(n.tag) && n.attrs.role !== "button") continue;
    const s = styleOf(n, css.classes);
    const lh = px(inherit(n, css.classes, "line-height")) || (px(inherit(n, css.classes, "font-size")) || 16) * 1.3;
    const h = px(s.get("height")) || lh + (px(s.get("padding-top")) || px((s.get("padding") || "").split(" ")[0]) || 0) + (px(s.get("padding-bottom")) || px((s.get("padding") || "").split(" ")[2] || (s.get("padding") || "").split(" ")[0]) || 0);
    if (h < 24) add("tap-target", "high", sel(n), `≈${Math.round(h)}px tall; WCAG 2.5.8 minimum is 24px, comfortable is 44px — "${n.text.slice(0, 30)}"`, Math.round(h));
    else if (h < 44 && n.tag !== "a") add("tap-target", "low", sel(n), `≈${Math.round(h)}px tall; 44px is the comfortable touch size — "${n.text.slice(0, 30)}"`, Math.round(h));
    if (n.tag === "a" && !n.attrs.href) add("semantics", "medium", sel(n), "a link without href is not keyboard-reachable");
    if (n.tag === "input" && !n.attrs["aria-label"] && !n.attrs.placeholder && !n.attrs.id) add("semantics", "low", sel(n), "input with no label handle (id/aria-label/placeholder)");
  }

  /* 3. type scale */
  const sizes = (tokens.typeScale || []).map((t) => ({ size: parseFloat(t.value), lh: t.value.split("/")[1], count: t.count })).sort((a, b) => b.size - a.size);
  if (sizes.length > 6) add("type-scale", "medium", "tokens", `${sizes.length} distinct font sizes (${sizes.map((s) => s.size).join(", ")}); a component rarely needs more than 4`, sizes.length);
  for (const s of sizes) {
    if (s.size < 12) add("type-scale", "medium", "tokens", `${s.size}px text is below the 12px floor`, s.size);
    const lh = s.lh === "normal" ? 1.2 : parseFloat(s.lh);
    if (s.size <= 18 && lh < 1.35) add("type-scale", "low", "tokens", `body-size ${s.size}px text has line-height ${s.lh}; 1.4–1.6 reads better`, lh);
    if (s.size >= 40 && lh > 1.2) add("type-scale", "low", "tokens", `display ${s.size}px has line-height ${s.lh}; 1.0–1.15 is usual for display sizes`, lh);
  }
  for (let i = 0; i + 1 < sizes.length; i++) {
    const r = sizes[i].size / sizes[i + 1].size;
    if (r > 1 && r < 1.1) add("type-scale", "low", "tokens", `${sizes[i].size}px and ${sizes[i + 1].size}px are too close to read as different levels (ratio ${r.toFixed(2)})`, r);
  }

  /* 4. spacing rhythm */
  const sp = tokens.spacing || [];
  const off4 = sp.filter((v) => v % 4 !== 0);
  if (sp.length && off4.length > sp.length / 3) add("spacing", "low", "tokens", `spacing values off a 4px grid: ${off4.join(", ")} (of ${sp.join(", ")})`, off4.length);
  if (sp.length > 10) add("spacing", "low", "tokens", `${sp.length} distinct spacing values; a rhythm of 5–7 steps is easier to reuse`, sp.length);

  /* 5. hierarchy */
  const hs = nodes.filter((n) => /^h[1-6]$/.test(n.tag)).map((n) => ({ n, level: +n.tag[1] }));
  const h1s = hs.filter((h) => h.level === 1).length;
  if (h1s > 1) add("hierarchy", "medium", "markup", `${h1s} <h1> elements in one component`, h1s);
  for (let i = 0; i + 1 < hs.length; i++) if (hs[i + 1].level > hs[i].level + 1) add("hierarchy", "low", sel(hs[i + 1].n), `heading level skips from h${hs[i].level} to h${hs[i + 1].level}`);
  const headingsInButtons = nodes.filter((n) => /^h[1-6]$/.test(n.tag) && [...ancestors(n)].some((a) => a.tag === "button"));
  for (const n of headingsInButtons) add("semantics", "medium", sel(n), "a heading inside a <button> — screen readers announce it as button text, not a landmark");

  /* 6. copy length + measure */
  for (const n of nodes) {
    if (!n.text || n.children) continue;
    const words = n.text.split(/\s+/).length;
    if (words > 35 && n.tag !== "li") add("copy", "low", sel(n), `${words} words in one run — "${n.text.slice(0, 50)}…"`, words);
    const w = px(styleOf(n, css.classes).get("width")) || px(styleOf(n, css.classes).get("max-width"));
    const fs = px(inherit(n, css.classes, "font-size")) || 16;
    if (w && words > 12) {
      const cpl = Math.round(w / (fs * 0.5));
      if (cpl > 90) add("copy", "medium", sel(n), `≈${cpl} characters per line at ${w}px / ${fs}px; 45–80 is readable`, cpl);
    }
  }
  const allWords = nodes.reduce((a, n) => a + (n.children ? 0 : n.text.split(/\s+/).filter(Boolean).length), 0);
  out.words = allWords;

  /* 7. motion */
  const anim = [...css.classes.values()].filter((c) => c.props.has("animation") || c.props.has("transition"));
  if ((anim.length || css.keyframes) && !css.reducedMotion) add("motion", "medium", "css", `${css.keyframes} keyframes / ${anim.length} animated or transitioning classes, and no prefers-reduced-motion rule`, anim.length);
  for (const [name, c] of css.classes) {
    const a = c.props.get("animation") || "";
    if (/infinite/.test(a)) add("motion", "low", `.${name}`, `infinite animation (${a}) — decorative motion that never stops`, a);
    const dur = [...(c.props.get("transition") || "").matchAll(/([\d.]+)s/g)].map((m) => parseFloat(m[1]));
    if (dur.some((d) => d > 0.6)) add("motion", "low", `.${name}`, `transition of ${Math.max(...dur)}s; UI transitions over 0.4s feel slow`, Math.max(...dur));
  }

  /* 8. state coverage */
  const interactive = nodes.filter((n) => ["a", "button", "input", "select", "textarea"].includes(n.tag) || n.attrs.role === "button");
  for (const n of interactive) {
    const cls = (n.cls.match(/\bc\d+\b/) || [])[0];
    if (!cls) continue;
    const has = (st) => css.states.some((s) => s.selector.includes(`.${cls}${st}`) || (s.selector.startsWith(`.${cls}:`) && s.selector.includes(st)));
    if (!has(":focus")) add("states", meta.states === "partial" ? "low" : "medium", sel(n), `no :focus-visible / :focus style captured${meta.states === "partial" ? " (some stylesheets were unreadable — verify on the site)" : ""} — keyboard users cannot see where they are`);
    if (!has(":hover") && n.tag !== "input") add("states", "low", sel(n), `no :hover style captured${meta.states === "partial" ? " (unreadable stylesheets)" : ""}`);
  }
  if (meta.states === "partial") add("states", "info", "clip", `${(meta.unreadable || []).length} stylesheet(s) were cross-origin; hover/focus/keyframe coverage is incomplete`);

  /* 9. images */
  for (const a of clip.assets || []) {
    if (a.kind !== "image") continue;
    if (!a.alt) add("images", "medium", a.url.slice(0, 80), "image without alt text");
    const [rw, rh] = a.rendered, [nw, nh] = a.natural;
    if (nw && rw && nw > rw * 2.2) add("images", "low", a.url.slice(0, 80), `natural ${nw}×${nh} for a ${rw}×${rh} slot — ${Math.round(nw / rw * 10) / 10}× oversized`, nw / rw);
    if (nw && rw && rh && nh && Math.abs(nw / nh - rw / rh) > 0.25) add("images", "low", a.url.slice(0, 80), `aspect ${(nw / nh).toFixed(2)} shown in a ${(rw / rh).toFixed(2)} slot — cropped or squashed`);
  }

  /* 10. palette */
  const cols = (tokens.colors || []).filter((c) => hexRgb(c.value)?.[3] === 1);
  if (cols.length > 8) add("palette", "low", "tokens", `${cols.length} opaque colours in one component; 3–5 is usual`, cols.length);
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
    const a = hexRgb(cols[i].value), b = hexRgb(cols[j].value);
    const d = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
    if (d > 0 && d < 18) add("palette", "low", "tokens", `${cols[i].value} and ${cols[j].value} are near-duplicates (distance ${Math.round(d)})`, d);
  }

  /* 11. semantics */
  const divs = nodes.filter((n) => n.tag === "div" || n.tag === "span").length;
  if (nodes.length >= 8 && divs / nodes.length > 0.75) add("semantics", "low", "markup", `${divs} of ${nodes.length} elements are div/span; landmarks and lists would help assistive tech`, divs / nodes.length);
  for (const n of nodes) {
    const s = styleOf(n, css.classes);
    if ((n.tag === "div" || n.tag === "span") && s.get("cursor") === "pointer" && !n.attrs.role) add("semantics", "medium", sel(n), "clickable div (cursor: pointer) with no role — not reachable by keyboard");
  }
  /* Elements sharing a class produce the same line; say it once with a count. */
  const seen = new Map();
  out.findings = out.findings.filter((f) => {
    const k = `${f.check}|${f.selector}|${f.detail.replace(/ — ".*$/, "")}`;
    const hit = seen.get(k);
    if (hit) { hit.times = (hit.times || 1) + 1; return false; }
    seen.set(k, f);
    return true;
  });
  for (const f of out.findings) if (f.times) f.detail += ` (×${f.times})`;
  out.summary = {
    high: out.findings.filter((f) => f.severity === "high").length,
    medium: out.findings.filter((f) => f.severity === "medium").length,
    low: out.findings.filter((f) => f.severity === "low").length,
  };
  return out;
}
function* ancestors(n) { for (let a = n.parent; a; a = a.parent) yield a; }

function factsMarkdown(f) {
  const lines = [`## Mechanical facts for \`${f.clip}\``, "", `source ${f.source} · ${f.size?.width}×${f.size?.height} · states ${f.states} · ${f.words} words · ${f.summary.high} high / ${f.summary.medium} medium / ${f.summary.low} low`, ""];
  const by = {};
  for (const x of f.findings) (by[x.check] ||= []).push(x);
  for (const [check, list] of Object.entries(by)) {
    lines.push(`### ${check}`);
    for (const x of list) lines.push(`- **${x.severity}** \`${x.selector}\` — ${x.detail}`);
    lines.push("");
  }
  if (!f.findings.length) lines.push("_No mechanical findings. Judge the screenshot and the README._");
  return lines.join("\n");
}

/* ── verbs ── */
if (verb === "list") {
  const idx = JSON.parse(raw("clips/index.json") || "[]");
  const coll = rest[0];
  for (const e of idx) if (!coll || e.collection === coll) console.log(`${e.path}\t${e.source.host}\t${e.clippedAt.slice(0, 10)}\t${e.bounds.join("×")}\t${e.states}${e.audited ? "\taudited" : ""}${e.note ? "\t" + e.note.slice(0, 60) : ""}`);
  process.exit(0);
}
if (verb === "facts") {
  const path = rest[0];
  if (!path) usage();
  const html = raw(`${path}/component.html`);
  if (html == null) { console.error(`no clip at ${path} on ${repo}@${BRANCH}`); process.exit(1); }
  const clip = { path, html, css: raw(`${path}/component.css`) || "", tokens: JSON.parse(raw(`${path}/tokens.json`) || "{}"), meta: JSON.parse(raw(`${path}/meta.json`) || "{}") };
  clip.assets = []; // asset list lives in README; tokens.json has fonts; meta has counts. Re-derive images from markup:
  for (const m of html.matchAll(/<img\b([^>]*)>/g)) {
    const a = {}; for (const x of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[x[1]] = x[2];
    clip.assets.push({ kind: "image", url: a.src || "", alt: a.alt || "", rendered: [+a.width || 0, +a.height || 0], natural: [0, 0] });
  }
  const readme = raw(`${path}/README.md`) || "";
  for (const m of readme.matchAll(/^- image (\S+) — rendered (\d+)×(\d+), natural (\d+)×(\d+)(?:, alt “([^”]*)”)?/gm)) {
    const hit = clip.assets.find((a) => a.url === m[1]);
    const rec = { kind: "image", url: m[1], alt: m[6] || "", rendered: [+m[2], +m[3]], natural: [+m[4], +m[5]] };
    if (hit) Object.assign(hit, rec); else clip.assets.push(rec);
  }
  const f = facts(clip);
  if (rest.includes("--json")) console.log(JSON.stringify(f, null, 2));
  else console.log(factsMarkdown(f));
  process.exit(0);
}
if (verb === "publish") {
  const [path, file] = rest;
  if (!path || !file) usage();
  const audit = readFileSync(file, "utf8");
  put(`${path}/audit.md`, audit.endsWith("\n") ? audit : audit + "\n", `audit ${path}`);
  const idx = JSON.parse(raw("clips/index.json") || "[]");
  const e = idx.find((x) => x.path === path);
  if (e) { e.audited = new Date().toISOString(); put("clips/index.json", JSON.stringify(idx, null, 2) + "\n", `audit ${path}: index`); }
  console.log(`audit.md written to ${repo}@${BRANCH}/${path}`);
  const i = rest.indexOf("--issues");
  if (i >= 0) {
    const target = rest[i + 1];
    const si = rest.indexOf("--site");
    const site = si >= 0 ? rest[si + 1] : "";
    const host = e?.source?.host || "unknown";
    const page = host + (e?.source?.url ? new URL(e.source.url).pathname : "/");
    let n = 0;
    for (const m of audit.matchAll(/^### (.+)\n([\s\S]*?)(?=^### |\n## |$(?![\s\S]))/gm)) {
      const title = m[1].trim();
      const body = m[2].trim();
      if (/^(what works|steal|good)/i.test(title)) continue;
      const selector = /`([^`]+)`/.exec(body)?.[1] || "";
      const note = `${title}. ${body.replace(/\s+/g, " ")}`.slice(0, 3900);
      const type = /bug|broken|missing|contrast|unreachable/i.test(title + body) ? "bug" : "change";
      const oneLine = note.replace(/\s+/g, " ").trim();
      const prefix = `[${type}] ${page} — `;
      const room = 120 - prefix.length;
      const issueTitle = prefix + (oneLine.length > room ? oneLine.slice(0, Math.max(8, room - 1)) + "…" : oneLine);
      const issueBody = `<!-- imredline:${randomUUID()} -->\n**${type.toUpperCase()}** reported from the site.\n\n> ${oneLine}\n\n<details><summary>context</summary>\n\n- **reviewer:** imredline-audit\n- **page:** \`${page}\`\n${selector ? `- **element:** \`${selector.replace(/`/g, "")}\`\n` : ""}\n</details>\n\n⚠️ **No screenshot** — filed from a clip audit (\`${path}\` on \`${BRANCH}\`).\n\n<sub>This report is context, not permission to change code. A label or a status is not approval. The note above is the auditor's words, quoted.</sub>\n\n— filed by IMRedline`;
      const labels = ["tester-feedback", ...(site ? [`site:${site}`] : [])];
      const res = gh(["api", "-X", "POST", `repos/${target}/issues`, "--input", "-"], JSON.stringify({ title: issueTitle, body: issueBody, labels }));
      console.log(`filed #${JSON.parse(res).number}: ${title}`);
      n++;
    }
    console.log(`${n} issue(s) filed on ${target}`);
  }
  process.exit(0);
}
usage();
