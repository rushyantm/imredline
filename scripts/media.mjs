#!/usr/bin/env node
/*
  Produces the README pictures and the demo recording, from the real widget
  against an in-memory GitHub — nothing is filed anywhere.

    node scripts/media.mjs            → docs/media/{01-review,02-queue,03-clip,04-gallery}.png + demo.gif
    node scripts/media.mjs --no-gif   → pictures only

  Needs system Chrome (Playwright channel "chrome") and ffmpeg on PATH for the GIF.
*/

import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createNodeHandler } from "../dist/adapters/node.js";
import { fakeGitHub, TEST_ENV } from "../test/helpers/fake-github.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const OUT = join(ROOT, "docs/media");
await mkdir(OUT, { recursive: true });
const GIF = !process.argv.includes("--no-gif");

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {}
  return import(join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "playwright/index.mjs"));
}

const gh = fakeGitHub({ repo: "sable-house/site" });
const env = { ...TEST_ENV, IMREDLINE_SITE: "sable", IMREDLINE_GITHUB_REPO: "sable-house/site", IMREDLINE_DATA_DIR: await mkdtemp(join(tmpdir(), "imredline-media-")), IMREDLINE_CLIP_ORIGINS: "*" };
const imredline = createNodeHandler({ env, fetch: gh.fetch });
const demo = (await readFile(join(ROOT, "docs/demo/index.html"), "utf8")).replace("</body>", '<script src="/imredline/widget.js" defer></script></body>');
const server = createServer(async (req, res) => {
  if (await imredline(req, res)) return;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(demo);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;
const TOKEN = TEST_ENV.IMREDLINE_ADMIN_TOKEN;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: "chrome" });

/* A visible cursor for the recording (video frames carry no pointer). */
const CURSOR = `
  const c = document.createElement("div"); c.id = "demo-cursor";
  Object.assign(c.style, { position: "fixed", left: "0", top: "0", width: "22px", height: "22px", zIndex: 2147483647, pointerEvents: "none", transition: "transform .05s linear", transform: "translate(-100px,-100px)" });
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9 22z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  document.addEventListener("DOMContentLoaded", () => document.body.append(c));
  addEventListener("mousemove", (e) => { c.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)"; }, true);
  addEventListener("mousedown", () => { c.style.filter = "drop-shadow(0 0 6px #e2483d)"; }, true);
  addEventListener("mouseup", () => { c.style.filter = ""; }, true);
`;

async function glide(page, x, y, ms = 500) {
  await page.mouse.move(x, y, { steps: Math.max(8, Math.round(ms / 16)) });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function centre(page, sel) {
  const el = await page.waitForSelector(sel);
  await el.scrollIntoViewIfNeeded();
  await sleep(150);
  const b = await el.boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
}
async function shotReady(page) {
  await page.waitForFunction(() => !/Preparing/.test(document.querySelector(".imr-dialog[open] .imr-shot")?.textContent || ""), null, { timeout: 20000 });
}

/* ── seed: two reports and one clip already in the queue/gallery, filed through the widget ── */
async function seed() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${base}/?imredline=${TOKEN}`);
  await page.waitForSelector(".imr-launch");
  const file = async (sel, type, note) => {
    await page.click(".imr-launch");
    const [x, y] = await centre(page, sel);
    await page.mouse.click(x, y);
    await page.waitForSelector("dialog.imr-dialog[open]");
    await page.click(`.imr-type:has-text("${type}")`);
    await page.fill(".imr-note", note);
    await shotReady(page);
    await page.click(".imr-dialog[open] .imr-send");
    await page.waitForSelector(".imr-toast");
    await page.waitForSelector("dialog.imr-dialog[open]", { state: "detached" });
    await sleep(300);
  };
  await file("#room-tide .price", "Bug", "Tide shows $310 here but $250 in the rates table for the same season.");
  await file(".rates th:nth-child(1)", "Change", "Season names are long — keep the season word and move the months to a second, lighter line.");
  /* one clip */
  await page.click(".imr-clip");
  const [cx, cy] = await centre(page, "#room-dune h3");
  await page.mouse.click(cx, cy);
  await page.waitForSelector("dialog.imr-dialog--clip[open]");
  await page.click(".imr-wn button:has-text('Widen')");
  await page.click(".imr-wn button:has-text('Widen')");
  await page.fill(".imr-fields input:nth-child(1)", "room-card");
  await page.fill(".imr-fields input:nth-child(2)", "hotel-patterns");
  await page.fill(".imr-note--short", "Quiet card: one photo, one line, the price last.");
  await page.waitForFunction(() => /Screenshot ready/.test(document.querySelector(".imr-dialog--clip .imr-shot")?.textContent || ""), null, { timeout: 20000 });
  await page.click(".imr-dialog--clip .imr-send");
  await page.waitForSelector(".imr-toast");
  await ctx.close();
}

/* ── stills ── */
async function stills() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/?imredline=${TOKEN}`);
  await page.waitForSelector(".imr-launch");

  /* 01 — a report being written on the hero CTA */
  await page.click(".imr-launch");
  const [x, y] = await centre(page, "#hero-cta");
  await page.mouse.move(x, y);
  await sleep(200);
  await page.mouse.click(x, y);
  await page.waitForSelector("dialog.imr-dialog[open]");
  await page.click('.imr-type:has-text("Change")');
  await page.fill(".imr-note", "Make this the only button — two calls to action here split the click.");
  await shotReady(page);
  await sleep(300);
  await page.screenshot({ path: join(OUT, "01-review.png") });
  await page.keyboard.press("Escape");
  await sleep(200);

  /* 02 — the queue */
  await page.goto(`${base}/imredline/queue`);
  await page.waitForSelector(".imq-card");
  await sleep(400);
  await page.screenshot({ path: join(OUT, "02-queue.png") });

  /* 03 — clip dialog on a room card */
  await page.goto(`${base}/`);
  await page.waitForSelector(".imr-clip");
  await page.click(".imr-clip");
  const [cx, cy] = await centre(page, "#room-tide h3");
  await page.mouse.click(cx, cy);
  await page.waitForSelector("dialog.imr-dialog--clip[open]");
  await page.click(".imr-wn button:has-text('Widen')");
  await page.click(".imr-wn button:has-text('Widen')");
  await page.fill(".imr-fields input:nth-child(2)", "hotel-patterns");
  await page.waitForFunction(() => /Screenshot ready/.test(document.querySelector(".imr-dialog--clip .imr-shot")?.textContent || ""), null, { timeout: 20000 });
  await sleep(300);
  await page.screenshot({ path: join(OUT, "03-clip.png") });
  await page.keyboard.press("Escape");

  /* 04 — the gallery */
  await page.goto(`${base}/imredline/clips`);
  await page.waitForSelector(".imc-card");
  await sleep(400);
  await page.screenshot({ path: join(OUT, "04-gallery.png") });
  await ctx.close();
}

/* ── the recording: link → Review → pin → note → Send → queue ── */
async function recording() {
  const vdir = await mkdtemp(join(tmpdir(), "imredline-video-"));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, recordVideo: { dir: vdir, size: { width: 1280, height: 800 } } });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  await page.goto(`${base}/?imredline=${TOKEN}`);
  await page.waitForSelector(".imr-launch");
  await sleep(900);
  const [lx, ly] = await centre(page, ".imr-launch");
  await glide(page, lx, ly, 700);
  await sleep(250);
  await page.mouse.click(lx, ly);
  await sleep(500);
  const [x, y] = await centre(page, "#room-tide .price");
  await glide(page, x - 120, y - 80, 500);
  await glide(page, x, y, 600);
  await sleep(450);
  await page.mouse.click(x, y);
  await page.waitForSelector("dialog.imr-dialog[open]");
  await sleep(500);
  const [bx, by] = await centre(page, '.imr-type:has-text("Bug")');
  await glide(page, bx, by, 400);
  await page.mouse.click(bx, by);
  await sleep(250);
  const [nx, ny] = await centre(page, ".imr-note");
  await glide(page, nx, ny, 350);
  await page.click(".imr-note");
  await page.type(".imr-note", "Tide is $310 here but $250 in the rates table.", { delay: 34 });
  await shotReady(page);
  await sleep(600);
  const [sx, sy] = await centre(page, ".imr-dialog[open] .imr-send");
  await glide(page, sx, sy, 450);
  await sleep(200);
  await page.mouse.click(sx, sy);
  await page.waitForSelector(".imr-toast");
  await sleep(1400);
  await page.goto(`${base}/imredline/queue`);
  await page.waitForSelector(".imq-card");
  await sleep(2200);
  const video = page.video();
  await ctx.close();
  const webm = await video.path();
  const gif = join(OUT, "demo.gif");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-vf", "fps=12,scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=160:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0", gif]);
  await rm(vdir, { recursive: true, force: true });
}

/* ── the clip recording: ✂ Clip → pick a card → Widen → name it → Clip → gallery → Copy prompt ── */
async function clipRecording() {
  const vdir = await mkdtemp(join(tmpdir(), "imredline-video-"));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, recordVideo: { dir: vdir, size: { width: 1280, height: 800 } } });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  await page.goto(`${base}/?imredline=${TOKEN}#rooms`);
  await page.waitForSelector(".imr-clip");
  await page.evaluate(() => document.querySelector("#rooms").scrollIntoView({ block: "start" }));
  await sleep(900);
  const [cx0, cy0] = await centre(page, ".imr-clip");
  await glide(page, cx0, cy0, 700);
  await sleep(250);
  await page.mouse.click(cx0, cy0);
  await sleep(500);
  const [x, y] = await centre(page, "#room-loft h3");
  await glide(page, x - 160, y - 60, 500);
  await glide(page, x, y, 600);
  await sleep(500);
  await page.mouse.click(x, y);
  await page.waitForSelector("dialog.imr-dialog--clip[open]");
  await sleep(700);
  const [wx, wy] = await centre(page, ".imr-wn button:has-text('Widen')");
  await glide(page, wx, wy, 450);
  await page.mouse.click(wx, wy);
  await sleep(650);
  await page.mouse.click(wx, wy);
  await sleep(650);
  const [nx, ny] = await centre(page, ".imr-fields input:nth-child(1)");
  await glide(page, nx, ny, 350);
  await page.click(".imr-fields input:nth-child(1)");
  await page.keyboard.press("Meta+A");
  await page.type(".imr-fields input:nth-child(1)", "room-card", { delay: 45 });
  await page.click(".imr-fields input:nth-child(2)");
  await page.type(".imr-fields input:nth-child(2)", "hotel-patterns", { delay: 40 });
  await page.click(".imr-note--short");
  await page.type(".imr-note--short", "Quiet card: photo, one line, price last.", { delay: 30 });
  await page.waitForFunction(() => /Screenshot ready/.test(document.querySelector(".imr-dialog--clip .imr-shot")?.textContent || ""), null, { timeout: 20000 });
  await sleep(500);
  const [sx, sy] = await centre(page, ".imr-dialog--clip .imr-send");
  await glide(page, sx, sy, 450);
  await sleep(150);
  await page.mouse.click(sx, sy);
  await page.waitForSelector(".imr-toast");
  await sleep(1300);
  await page.goto(`${base}/imredline/clips`);
  await page.waitForSelector(".imc-card");
  await sleep(1000);
  const [kx, ky] = await centre(page, ".imc-card:has-text('room-card')");
  await glide(page, kx, ky, 600);
  await page.mouse.click(kx, ky);
  await page.waitForSelector(".imc-detail");
  await sleep(1400);
  const [px, py] = await centre(page, ".imc-detail button:has-text('Copy prompt')");
  await glide(page, px, py, 600);
  await sleep(200);
  await page.mouse.click(px, py).catch(() => {});
  await sleep(1600);
  const video = page.video();
  await ctx.close();
  const webm = await video.path();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-vf", "fps=12,scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=160:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0", join(OUT, "demo-clip.gif")]);
  await rm(vdir, { recursive: true, force: true });
}

try {
  await seed();
  await stills();
  if (GIF) await recording();
  if (GIF) await clipRecording();
  const files = (await readdir(OUT)).filter((f) => /\.(png|gif)$/.test(f));
  for (const f of files) console.log("wrote", join("docs/media", f));
} finally {
  await browser.close();
  server.close();
}
