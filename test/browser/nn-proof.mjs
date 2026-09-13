/*
  Proof that Nutrition Nest, running locally on imredline/capture, produces
  the same pictures its old in-file engine did — without filing anything.

  Drives the real ReviewMode widget in system Chrome: arm with the throwaway
  token the dev server was started with, click a target, type a note, press
  Send — and intercept the POST to /api/review so the report never leaves
  the browser. The screenshot in that request body is written to
  test/output/ for a human to open.

  Run:  REVIEW_ADMIN_TOKEN=imredline-local-test npx next dev -p 3200   (in NN)
        node test/browser/nn-proof.mjs                                  (here)
*/

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const OUT = join(ROOT, "test/output");
const BASE = process.env.NN_BASE ?? "http://localhost:3200";
const TOKEN = process.env.REVIEW_ADMIN_TOKEN ?? "imredline-local-test";

async function loadPlaywright() {
  try { return await import("playwright"); } catch {}
  return import("/Users/Rishi/.npm-global/lib/node_modules/playwright/index.mjs");
}
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await mkdir(OUT, { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

/* Nothing leaves this machine: third-party tags, pixels and the hero film
   are blocked, so the page settles and GA4 sees no dev traffic. */
await page.route("**/*", (route) => {
  const host = new URL(route.request().url()).hostname;
  return host === "localhost" || host === "127.0.0.1" ? route.continue() : route.abort();
});

/* Never let a report reach the server. Capture the body, answer as if filed. */
const posts = [];
await page.route("**/api/review", async (route) => {
  const req = route.request();
  if (req.method() !== "POST") return route.continue();
  posts.push(req.postDataJSON());
  await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, number: 0, hasShot: true }) });
});

await page.goto(`${BASE}/?review=${TOKEN}`, { waitUntil: "domcontentloaded" });
await page.waitForResponse((r) => r.url().includes("/api/review/session") && r.status() === 200);
/* Dev-only: React StrictMode double-mounts, and the first effect run strips
   the token from the URL before its cancelled continuation can set access.
   A reviewer's SECOND page arms from the cookie — so load one, like they do. */
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".rv-launch", { timeout: 20_000 });
check("armed: 🛠 Review button visible", true);
check("token stripped from the URL", !page.url().includes("review="), page.url());

const attrs = await page.evaluate(() => ({
  frame: document.querySelectorAll("[data-imredline-frame]").length,
  stack: document.querySelectorAll("[data-imredline-stack]").length,
  animated: document.querySelectorAll("[data-imredline-animated]").length,
}));
check("markup opt-ins present on /", attrs.frame >= 1 && attrs.stack === 1 && attrs.animated >= 10, JSON.stringify(attrs));

async function report(name, selector, { scroll = "center" } = {}) {
  const before = posts.length;
  /* NN scrolls smoothly; read the box only once it has stopped moving and
     sits inside the viewport, else the click lands on nothing. */
  await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center", behavior: "instant" }), selector);
  let box = null;
  for (let i = 0; i < 20; i++) {
    const a = await page.locator(selector).first().boundingBox();
    await page.waitForTimeout(150);
    const b = await page.locator(selector).first().boundingBox();
    if (a && b && a.y === b.y && b.y >= 0 && b.y + Math.min(b.height, 40) <= 900) { box = b; break; }
  }
  check(`${name}: target settled on screen`, Boolean(box), selector + (box ? ` @ y=${Math.round(box.y)}` : ""));
  if (!box) return;
  await page.click(".rv-launch");
  await page.waitForSelector("#rv-overlay");
  const cx = box.x + box.width / 2, cy = box.y + Math.min(box.height / 2, 200);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(100);
  await page.mouse.click(cx, cy);
  await page.waitForSelector(".rv-form");
  const target = await page.locator(".rv-target").textContent().catch(() => "");
  await page.fill(".rv-note", `imredline local proof — ${name}`);
  await page.click(".rv-send");
  await page.waitForFunction((n) => !document.querySelector(".rv-form") || document.querySelector(".rv-toast"), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(300);
  const body = posts[before];
  check(`${name}: report POSTed (intercepted)`, Boolean(body));
  if (!body) return;
  check(`${name}: has screenshot`, typeof body.screenshot === "string", body.shotError ?? `${body.screenshot?.length} chars`);
  check(`${name}: under server cap`, (body.screenshot?.length ?? 0) <= 1_500_000);
  console.log(`      selector: ${body.selector}\n      viewport: ${body.viewport}\n      note: ${body.shotNote ?? "(none)"}\n      widget said: ${target}`);
  if (body.screenshot) await writeFile(join(OUT, `nn-${name}.jpg`), Buffer.from(body.screenshot.split(",")[1], "base64"));
  await page.keyboard.press("Escape");
}

await report("01-hero-title", "h1.hero__title, h1");
await report("02-dept-thumb", "[data-imredline-stack] img");
await report("03-footer-link", "footer a");

await browser.close();
console.log(`\n${failed ? `${failed} FAILED` : "all passed"} — ${posts.length} reports intercepted, none filed — pictures in ${OUT}`);
process.exit(failed ? 1 : 0);
