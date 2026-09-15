/*
  End-to-end for Clip (0.5.0): the real widget in system Chrome, through the
  plain-Node adapter, against an in-memory GitHub. Arm ✂ Clip, click inside
  the hero, Widen to the section, send — then read what landed on the clips
  branch and open it in the gallery. Pictures go to test/output/.
*/

import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeHandler } from "../../dist/adapters/node.js";
import { fakeGitHub, TEST_ENV } from "../helpers/fake-github.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const OUT = join(ROOT, "test/output");
await mkdir(OUT, { recursive: true });

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {}
  return import("/Users/Rishi/.npm-global/lib/node_modules/playwright/index.mjs");
}

const gh = fakeGitHub();
const env = { ...TEST_ENV, IMREDLINE_DATA_DIR: await mkdtemp(join(tmpdir(), "imredline-")), IMREDLINE_CLIP_ORIGINS: "*" };
const imredline = createNodeHandler({ env, fetch: gh.fetch });
const fixture = (await readFile(join(ROOT, "test/browser/fixture.html"), "utf8")).replace(
  "</body>",
  '<script src="/imredline/widget.js" defer></script></body>',
);
const server = createServer(async (req, res) => {
  if (await imredline(req, res)) return;
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(fixture);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
};

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: "chrome" });
browser.on("context", (c) => c.on("page", (p) => {
  p.on("pageerror", (e) => console.log("  [page error]", e.message));
  p.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text()); });
}));

/* ── 1. clip the hero: click the title, widen to the section, send ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/?imredline=ravi-secret`);
  await page.waitForSelector(".imr-clip", { timeout: 5000 });
  check("clip: ✂ Clip button appears for a reviewer", true);
  await page.click(".imr-clip");
  await page.waitForSelector(".imr-overlay--clip");
  check("clip: arming shows the clip banner", /Clip mode/.test(await page.locator(".imr-banner").textContent()));
  await page.hover("#hero-title", { force: true });
  await page.click("#hero-title", { force: true });
  await page.waitForSelector("dialog.imr-dialog--clip[open]");
  check("clip: dialog opens on pin", true);
  check("clip: name suggested from the element", (await page.inputValue(".imr-fields input:nth-child(1)")) === "heading", await page.inputValue(".imr-fields input:nth-child(1)"));
  check("clip: target is the h1", /h1#hero-title/.test(await page.locator(".imr-wn .imr-target").textContent()));
  await page.click(".imr-wn button:has-text('Widen')");
  await page.waitForFunction(() => /section#hero/.test(document.querySelector(".imr-wn .imr-target")?.textContent || ""));
  check("clip: Widen climbs to the section", true);
  check("clip: the suggested name follows Widen", (await page.inputValue(".imr-fields input:nth-child(1)")) === "hero", await page.inputValue(".imr-fields input:nth-child(1)"));
  const stats = await page.locator(".imr-cstats").textContent();
  check("clip: stats line reads the capture", /elements · 0 images · 1 font · hover rules: readable \(\d+\)/.test(stats), stats);
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => /h1#hero-title/.test(document.querySelector(".imr-wn .imr-target")?.textContent || ""));
  check("clip: ↓ narrows back to the h1", true);
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => /section#hero/.test(document.querySelector(".imr-wn .imr-target")?.textContent || ""));
  check("clip: ↑ widens again", true);
  await page.fill(".imr-fields input:nth-child(1)", "Hero");
  await page.fill(".imr-fields input:nth-child(2)", "Fixture Ideas");
  await page.fill(".imr-note--short", "The pill button and the serif scale.");
  await page.waitForFunction(() => /Screenshot ready/.test(document.querySelector(".imr-dialog--clip .imr-shot")?.textContent || ""), null, { timeout: 15000 });
  check("clip: screenshot ready in the background", true);
  await page.screenshot({ path: join(OUT, "clip-01-dialog.jpg"), type: "jpeg", quality: 80 });
  await page.click(".imr-dialog--clip .imr-send");
  await page.waitForSelector(".imr-toast");
  const toast = await page.locator(".imr-toast").textContent();
  check("clip: toast names the folder", toast === "Clipped as fixture-ideas/hero-01", toast);

  const dir = "imredline-clips:clips/fixture-ideas/hero-01/";
  check("clip: one commit on the clips branch", gh.state.commits.length === 1 && gh.state.commits[0].branch === "imredline-clips", String(gh.state.commits.length));
  const files = ["README.md", "component.html", "component.css", "tokens.json", "meta.json", "preview.html", "screenshot.jpg"];
  check("clip: all seven files landed", files.every((f) => gh.state.contents.has(dir + f)), files.filter((f) => !gh.state.contents.has(dir + f)).join(","));
  const html = gh.state.contents.get(dir + "component.html")?.toString() || "";
  check("clip: markup is the section with rewritten classes", /^<section class="c1" id="hero">/.test(html), html.slice(0, 60));
  check("clip: text kept, tracking + on* attributes dropped, href absolute", html.includes("Make room for life") && !html.includes("data-track") && !html.includes("onclick") && html.includes(`href="${base}/book"`), html);
  const css = gh.state.contents.get(dir + "component.css")?.toString() || "";
  check("clip: css folds the hero's background and the h1 size", /background-color: #e9dfd0/.test(css) && /font-size: 48px/.test(css), "");
  check("clip: css names the source classes", /\/\* was: hero \*\//.test(css) && /\/\* was: cta \*\//.test(css));
  check("clip: hover on the h1 captured as .cN:hover", /\.c\d+:hover \{ color: #c0392b; \}/.test(css), (css.match(/:hover[^\n]*/g) || []).join(" | "));
  check("clip: ancestor hover captured as .cA:hover .cB", /\.c\d+:hover \.c\d+ \{ text-decoration: underline; \}/.test(css));
  check("clip: cta hover transform captured", /\.c\d+:hover \{ transform: translateY\(-2px\); \}/.test(css));
  check("clip: keyframes captured", /@keyframes fx-pulse/.test(css));
  check("clip: transition kept on the cta", /transition: transform 0\.2s/.test(css), (css.match(/transition[^\n]*/g) || []).join(" | "));
  check("clip: every element carries a class, even those the source left bare", /<h1 class="c\d+" id="hero-title">/.test(html) && /<p class="c\d+">/.test(html), html);
  check("clip: no width baked onto the block h1", !/\.c2 \{[^}]*width: \d+px/.test(css));
  const tokens = JSON.parse(gh.state.contents.get(dir + "tokens.json").toString());
  check("clip: tokens carry colours with contrast", tokens.colors.some((c) => c.value === "#e9dfd0") && tokens.colors.some((c) => c.value === "#1c2b26" && c.contrast > 10), JSON.stringify(tokens.colors.slice(0, 4)));
  check("clip: type scale has 48px", tokens.typeScale.some((t) => t.value.startsWith("48/")), JSON.stringify(tokens.typeScale));
  check("clip: spacing has 48 and 12", tokens.spacing.includes(48) && tokens.spacing.includes(12), JSON.stringify(tokens.spacing));
  check("clip: radii has 999", tokens.radii.includes(999), JSON.stringify(tokens.radii));
  check("clip: breakpoint recorded", tokens.breakpoints.includes("(max-width: 640px)"), JSON.stringify(tokens.breakpoints));
  const meta = JSON.parse(gh.state.contents.get(dir + "meta.json").toString());
  check("clip: meta has states full + reviewer", meta.states === "full" && meta.reviewer === "ravi" && meta.counts.keyframes === 1, JSON.stringify(meta.counts));
  const readme = gh.state.contents.get(dir + "README.md")?.toString() || "";
  check("clip: README is the prompt", readme.startsWith("# hero — clipped from 127.0.0.1") && readme.includes("The pill button and the serif scale.") && readme.includes("## How to rebuild this"));
  const shot = gh.state.contents.get(dir + "screenshot.jpg");
  check("clip: screenshot is a real JPEG", shot?.[0] === 0xff && shot?.[1] === 0xd8, String(shot?.length));
  check("clip: collection remembered for next time", (await page.evaluate(() => localStorage.getItem("imredline_collection"))) === "Fixture Ideas");
  await ctx.close();
}

/* ── 2. the gallery ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/imredline/clips`);
  await page.waitForSelector(".imc-gate");
  check("gallery: gated without a token", true);
  await page.goto(`${base}/imredline/clips?token=ravi-secret`);
  await page.waitForSelector(".imc-card");
  check("gallery: one card", (await page.locator(".imc-card").count()) === 1);
  check("gallery: swatches on the card", (await page.locator(".imc-swatch").count()) > 0);
  check("gallery: bookmarklet offered (CLIP_ORIGINS=*)", (await page.locator(".imc-drag").count()) === 1);
  const href = await page.locator(".imc-drag").getAttribute("href");
  check("gallery: bookmarklet carries host + token", href.startsWith("javascript:") && decodeURIComponent(href).includes('dataset.token="ravi-secret"') && decodeURIComponent(href).includes(`${base}/imredline/widget.js`), href.slice(0, 80));
  await page.screenshot({ path: join(OUT, "clip-02-gallery.jpg"), type: "jpeg", quality: 80, fullPage: true });
  await page.click(".imc-card");
  await page.waitForSelector(".imc-readme h1");
  check("gallery: README rendered", /hero — clipped from/.test(await page.locator(".imc-readme h1").textContent()));
  check("gallery: tokens table rendered", (await page.locator(".imc-readme table").count()) >= 2);
  const previewOk = await page.evaluate(() => {
    const f = document.querySelector(".imc-frame");
    return Boolean(f && f.getAttribute("sandbox") === "" && (f.srcdoc || "").includes("Make room for life"));
  });
  check("gallery: preview in a sandboxed iframe", previewOk);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "clip-03-detail.jpg"), type: "jpeg", quality: 80, fullPage: true });
  check("gallery: URL carries the clip", page.url().includes("clip=clips%2Ffixture-ideas%2Fhero-01"), page.url());
  check("gallery: no audit section before an audit", (await page.locator(".imc-audit").count()) === 0);
  /* The imredline-audit skill writes audit.md and stamps the index; the gallery shows both. */
  gh.state.contents.set("imredline-clips:clips/fixture-ideas/hero-01/audit.md", Buffer.from("# Audit — fixture-ideas/hero-01\n\nVerdict line.\n\n## Fix before reuse\n\n### Raise the CTA contrast\n`.c4 <a>` — 3.9:1. Severity: medium.\n"));
  const idx = JSON.parse(gh.state.contents.get("imredline-clips:clips/index.json").toString());
  idx[0].audited = new Date().toISOString();
  gh.state.contents.set("imredline-clips:clips/index.json", Buffer.from(JSON.stringify(idx)));
  await page.goto(`${base}/imredline/clips`);
  await page.waitForSelector(".imc-card");
  check("gallery: audited chip on the card", (await page.locator(".imc-chip--good").allTextContents()).includes("audited"));
  await page.click(".imc-card");
  await page.waitForSelector(".imc-audit h1");
  check("gallery: audit rendered under the README", /Audit — fixture-ideas\/hero-01/.test(await page.locator(".imc-audit h1").textContent()));
  check("gallery: Copy audit button", (await page.locator(".imc-actions button:has-text('Copy audit')").count()) === 1);
  await ctx.close();
}

/* ── 3. bookmarklet mode: the widget injected on a foreign origin with data-token ── */
{
  const other = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>Other site</title><style>.card{padding:20px;border:1px solid #ccc;border-radius:8px;width:300px;font-family:Georgia}</style><div class="card" id="card"><h2>Other site card</h2><p>Some text.</p></div>`);
  });
  await new Promise((ok) => other.listen(0, "127.0.0.1", ok));
  const otherBase = `http://127.0.0.1:${other.address().port}`;
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(otherBase + "/");
  await page.evaluate(({ host }) => {
    const s = document.createElement("script");
    s.src = host + "/imredline/widget.js";
    s.dataset.host = host;
    s.dataset.base = "/imredline";
    s.dataset.token = "ravi-secret";
    document.head.appendChild(s);
  }, { host: base });
  await page.waitForSelector(".imr-clip", { timeout: 5000 });
  check("bookmarklet: widget arms on a foreign origin via data-token", true);
  await page.click(".imr-clip");
  await page.click("#card h2", { force: true });
  await page.waitForSelector("dialog.imr-dialog--clip[open]");
  await page.click(".imr-wn button:has-text('Widen')");
  await page.waitForFunction(() => /div#card/.test(document.querySelector(".imr-wn .imr-target")?.textContent || ""));
  await page.waitForFunction(() => !/Preparing/.test(document.querySelector(".imr-dialog--clip .imr-shot")?.textContent || ""), null, { timeout: 15000 });
  await page.click(".imr-dialog--clip .imr-send");
  await page.waitForSelector(".imr-toast");
  const toast = await page.locator(".imr-toast").textContent();
  check("bookmarklet: clip lands cross-origin, default collection, name from the class", /^Clipped as inbox\/card-01/.test(toast), toast);
  const meta = JSON.parse(gh.state.contents.get("imredline-clips:clips/inbox/card-01/meta.json")?.toString() || "{}");
  check("bookmarklet: source is the foreign page", meta.source.url === otherBase + "/", meta.source.url);
  await ctx.close();
  other.close();
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} FAILED` : "\nall clip checks passed");
process.exit(failed ? 1 : 0);
