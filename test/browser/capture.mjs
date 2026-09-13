/*
  Render-and-look test for imredline/capture.

  No unit test catches a wrong picture; every capture failure looks correct in
  the browser and is only visible by decoding the image. So this serves the
  fixture, runs capture() against the cases that have bitten before, asserts
  the structural facts it can, and writes every picture to test/output/ for
  a human (or a model with eyes) to open.

  Uses the system Chrome through Playwright (`channel: "chrome"`); no browser
  download. Playwright itself comes from the global install this machine has.
*/

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const OUT = join(ROOT, "test/output");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".map": "application/json" };

async function loadPlaywright() {
  try { return await import("playwright"); } catch {}
  return import("/Users/Rishi/.npm-global/lib/node_modules/playwright/index.mjs");
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await mkdir(OUT, { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

await page.goto(`${base}/test/browser/fixture.html`);
await page.addScriptTag({ url: `${base}/node_modules/html2canvas-pro/dist/html2canvas-pro.js` });
await page.addScriptTag({ type: "module", content: `
  import * as cap from "${base}/dist/capture/index.js";
  window.__cap = cap;
  window.__run = async (sel, opts = {}) => {
    const el = sel ? document.querySelector(sel) : null;
    const r = await cap.capture(el, { loadLibrary: () => Promise.resolve(window.html2canvas), ...opts });
    return { ...r, bytes: r.dataUrl ? r.dataUrl.length : 0 };
  };
` });
await page.waitForFunction(() => Boolean(window.__run));

async function shoot(name, selector, opts, expect) {
  const r = await page.evaluate(([s, o]) => window.__run(s, o), [selector, opts]);
  if (r.dataUrl) {
    const b64 = r.dataUrl.split(",")[1];
    await writeFile(join(OUT, `${name}.jpg`), Buffer.from(b64, "base64"));
  }
  check(`${name}: captured`, Boolean(r.dataUrl), r.error ?? `${r.bytes} chars, q=${r.quality}, scale=${r.scale.toFixed(2)}`);
  check(`${name}: under cap`, r.bytes <= 1_500_000, `${r.bytes}`);
  if (expect.frame) check(`${name}: frame is <${expect.frame}>`, r.frame.tag === expect.frame, `got <${r.frame.tag}> ${r.frame.selector}`);
  if (expect.pin === "none") check(`${name}: no pin (frame is the element)`, r.pin === null, JSON.stringify(r.pin));
  if (expect.pin === "some") {
    const p = r.pin;
    check(`${name}: pin is fractional`, p && [p.x, p.y, p.width, p.height].every((v) => v >= 0 && v <= 1), JSON.stringify(p));
  }
  if (expect.note !== undefined) check(`${name}: note ${expect.note ? "present" : "absent"}`, Boolean(r.note) === expect.note, r.note ?? "");
  return r;
}

// 1. A heading inside the hero → frame should be the hero section, with a pin.
await shoot("01-hero-title", "#hero-title", {}, { frame: "section", pin: "some", note: true });

// 2. The tiny logo in the header <div>: the size climb must give the whole header, not an 89×12 logo.
await shoot("02-logo-in-header", "#logo", {}, { frame: "header", pin: "some" });

// 3. An <img> inside an overflow:clip frame — the commonest pin. Marker is on the canvas, so no clip problem.
await shoot("03-img-in-clip", "#room-img", {}, { frame: "section", pin: "some" });

// 4. The form, masking OFF (default): typed values must be visible in the picture.
await shoot("04-form-mask-off", "#f-phone", {}, { frame: "section", pin: "some" });

// 5. The form, masking ON: fields blanked.
await shoot("05-form-mask-on", "#f-phone", { maskForms: true }, { frame: "section", pin: "some" });

// 6. The private span must be blanked even with masking off.
const r6 = await shoot("06-private-always", "#secret-price", {}, { frame: "section", pin: "some" });

// 7. Stacked siblings: elementFromPoint returns the transparent top; resolveVisible must pick "TWO".
const visible = await page.evaluate(() => {
  const top = document.querySelector("#stack-top");
  top.scrollIntoView({ block: "center" });
  const r = top.getBoundingClientRect(); // read AFTER scrolling — viewport coords
  const el = window.__cap.elementUnder(r.left + r.width / 2, r.top + r.height / 2, null);
  return el ? el.textContent.trim() : null;
});
check("07-stack: resolves to the visible sibling", visible === "TWO — visible", String(visible));

// 8. Sticky stage in a 7000px runway → data-imredline-frame wins; frame is the <div> stage, not <main>/<section>.
await page.evaluate(() => document.querySelector("#panel").scrollIntoView({ block: "center" }));
await shoot("08-sticky-stage", "#panel", {}, { frame: "div", pin: "some" });

// 9. The runway section itself pinned (taller than the 6000px ceiling) → falls back to the element = the section.
const r9 = await shoot("09-runway-ceiling", "#runway", {}, { frame: "section", pin: "none" });

// 10. Nothing pinned → body, no pin, honest but thin.
await shoot("10-nothing-pinned", null, {}, { frame: "body", pin: "none", note: false });

// 11. A timeout that is too short must fail cleanly with a message, not hang.
const r11 = await page.evaluate(() => window.__run("#hero", { timeoutMs: 1 }));
check("11-timeout: fails with a message", r11.dataUrl === null && /too long/.test(r11.error), r11.error);

// 12. selectorFor escapes and disambiguates.
const sel = await page.evaluate(() => window.__cap.selectorFor(document.querySelector("#nav-book")));
check("12-selector: id form", sel === "a#nav-book", sel);

await browser.close();
server.close();
console.log(`\n${failed ? `${failed} FAILED` : "all passed"} — pictures in ${OUT}`);
process.exit(failed ? 1 : 0);
