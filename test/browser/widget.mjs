/*
  End-to-end: the real widget on a real page in system Chrome, through the
  plain-Node adapter, against an in-memory GitHub. Proves the whole path a
  reviewer walks — open the link, arm, pin, type, attach, send — and what
  lands in the issue, on desktop and on a phone. Pictures go to test/output/.
*/

import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeHandler } from "../../dist/adapters/node.js";
import { fakeGitHub, PNG_1x1, TEST_ENV } from "../helpers/fake-github.mjs";

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
const env = { ...TEST_ENV, IMREDLINE_DATA_DIR: await mkdtemp(join(tmpdir(), "imredline-")) };
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

const { chromium, devices } = await loadPlaywright();
const browser = await chromium.launch({ channel: "chrome" });
browser.on("context", (c) => c.on("page", (p) => {
  p.on("pageerror", (e) => console.log("  [page error]", e.message));
  p.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text()); });
}));
const pngBuffer = Buffer.from(PNG_1x1.split(",")[1], "base64");

/* ── 1. desktop: the full path ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/?imredline=admin-secret-token`);
  await page.waitForSelector(".imr-launch", { timeout: 5000 });
  check("desktop: button appears for a valid link", true);
  check("desktop: token stripped from the URL", !page.url().includes("imredline="), page.url());
  check("desktop: admin sees the Queue link", (await page.locator(".imr-queue").count()) === 1);

  await page.click(".imr-launch");
  await page.waitForSelector(".imr-overlay");
  await page.hover("#hero-title", { force: true });
  await page.waitForSelector(".imr-highlight");
  await page.click("#hero-title", { force: true });
  await page.waitForSelector("dialog.imr-dialog[open]");
  check("desktop: dialog opens on pin", true);
  const chip = await page.locator(".imr-chip").textContent();
  check("desktop: device chip says desktop · landscape", /desktop · landscape/.test(chip), chip);
  check("desktop: default type is Change", (await page.locator('.imr-type[aria-checked="true"]').textContent()) === "Change");
  check("desktop: selector shown", /h1#hero-title/.test(await page.locator(".imr-target").textContent()));
  await page.waitForFunction(() => /Screenshot attached/.test(document.querySelector(".imr-shot")?.textContent || ""), null, { timeout: 15000 });
  check("desktop: screenshot attached in the background", true);

  await page.fill(".imr-note", "The hero title should say 'Make room for living', not 'life'.");
  await page.click(".imr-samples summary");
  await page.setInputFiles('.imr-samples input[type="file"]', { name: "reference.png", mimeType: "image/png", buffer: pngBuffer });
  await page.waitForFunction(() => document.querySelectorAll(".imr-list li").length === 1);
  await page.fill(".imr-samples input[type=text]", "https://example.com/inspiration");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".imr-list li").length === 2);
  /* An uncommitted path in the field is added on Send, not lost. */
  await page.fill(".imr-samples input[type=text]", "/Users/rishi/Pictures/hero.png");
  await page.screenshot({ path: join(OUT, "widget-01-desktop-dialog.jpg"), type: "jpeg", quality: 80 });

  /* Q3: GitHub down → clear error, draft kept. */
  gh.state.failCreate = true;
  await page.click(".imr-send");
  await page.waitForFunction(() => /still here/.test(document.querySelector(".imr-status")?.textContent || ""));
  check("desktop: GitHub failure keeps the draft in the dialog", (await page.locator("dialog.imr-dialog[open]").count()) === 1);
  check("desktop: note survives the failure", (await page.inputValue(".imr-note")).includes("Make room"));
  gh.state.failCreate = false;

  await page.click(".imr-send");
  await page.waitForSelector(".imr-toast");
  const toast = await page.locator(".imr-toast").textContent();
  check("desktop: filed as #1", /Filed as #1$/.test(toast), toast);
  const issue = gh.state.issues[0];
  check("desktop: reviewer is the admin name", issue?.body.includes("- **reviewer:** rishi"));
  check("desktop: device line", /- \*\*device:\*\* desktop · landscape/.test(issue?.body || ""));
  check("desktop: viewport line", /- \*\*viewport:\*\* 1440x900/.test(issue?.body || ""));
  check("desktop: element line", /- \*\*element:\*\* `h1#hero-title`/.test(issue?.body || ""));
  check("desktop: screenshot uploaded (jpg)", /📷 `shots\/.+-rishi\.jpg`/.test(issue?.body || ""));
  check("desktop: sample image uploaded", /🖼 `samples\/.+-rishi-1\.jpg` on `imredline-assets` — sample image "reference\.png"/.test(issue?.body || ""));
  check("desktop: link and path both recorded", issue?.body.includes("https://example.com/inspiration") && issue?.body.includes("/Users/rishi/Pictures/hero.png"));
  check("desktop: labels", JSON.stringify(issue?.labels.map((l) => l.name)) === '["tester-feedback","site:acme"]');
  const shotBytes = gh.state.contents.get("imredline-assets:" + /📷 `([^`]+)`/.exec(issue.body)[1]);
  check("desktop: the uploaded shot is a real JPEG", shotBytes?.[0] === 0xff && shotBytes?.[1] === 0xd8, String(shotBytes?.length));

  /* Cookie path: a plain reload still shows the button, no token anywhere. */
  await page.goto(`${base}/`);
  await page.waitForSelector(".imr-launch", { timeout: 5000 });
  check("desktop: cookie keeps the button on the next visit", true);

  /* Esc leaves any state. */
  await page.click(".imr-launch");
  await page.waitForSelector(".imr-overlay");
  await page.keyboard.press("Escape");
  check("desktop: Esc disarms", (await page.locator(".imr-overlay").count()) === 0);

  /* Keyboard picking: Tab to a link, Enter pins it. */
  await page.click(".imr-launch");
  await page.focus("#nav-book");
  await page.keyboard.press("Enter");
  await page.waitForSelector("dialog.imr-dialog[open]");
  check("desktop: keyboard pin", /a#nav-book/.test(await page.locator(".imr-target").textContent()));
  await page.keyboard.press("Escape");
  await ctx.close();
}

/* ── 2. phone: device detection + the flip ── */
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto(`${base}/rooms?imredline=ravi-secret`);
  await page.waitForSelector(".imr-launch", { timeout: 5000 });
  check("phone: reviewer (not admin) sees no Queue link", (await page.locator(".imr-queue").count()) === 0);
  await page.tap(".imr-launch");
  await page.waitForSelector(".imr-overlay");
  await page.tap("#room-img", { force: true });
  await page.waitForSelector("dialog.imr-dialog[open]");
  const chip = await page.locator(".imr-chip").textContent();
  check("phone: device chip says phone · portrait", /phone · portrait/.test(chip), chip);
  await page.tap(".imr-chip");
  check("phone: one tap flips to tablet", /tablet/.test(await page.locator(".imr-chip").textContent()));
  await page.fill(".imr-note", "This room photo is cropped on the phone.");
  await page.waitForFunction(() => !/Preparing/.test(document.querySelector(".imr-shot")?.textContent || ""), null, { timeout: 15000 });
  await page.screenshot({ path: join(OUT, "widget-02-phone-dialog.jpg"), type: "jpeg", quality: 80 });
  await page.tap(".imr-send");
  await page.waitForSelector(".imr-toast");
  const issue = gh.state.issues[1];
  check("phone: filed as #2", Boolean(issue), await page.locator(".imr-toast").textContent());
  check("phone: device line carries the correction", /- \*\*device:\*\* tablet · portrait · touch · set by reviewer/.test(issue?.body || ""), /device:\*\* [^\n]+/.exec(issue?.body || "")?.[0]);
  check("phone: reviewer is ravi", issue?.body.includes("- **reviewer:** ravi"));
  check("phone: page is /rooms", issue?.body.includes("- **page:** `/rooms`"));
  await ctx.close();
}

/* ── 3. the queue page ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/imredline/queue`);
  await page.waitForSelector(".imq-gate");
  check("queue: gated without a token", true);
  await page.goto(`${base}/imredline/queue?token=admin-secret-token`);
  await page.waitForSelector(".imq-card");
  check("queue: two cards", (await page.locator(".imq-card").count()) === 2, String(await page.locator(".imq-card").count()));
  const loaded = await page.evaluate(() => {
    const img = document.querySelector(".imq-shot");
    return new Promise((ok) => {
      if (!img) return ok(0);
      if (img.complete) return ok(img.naturalWidth);
      img.onload = () => ok(img.naturalWidth);
      img.onerror = () => ok(-1);
    });
  });
  check("queue: screenshot renders through the proxy", loaded > 0, String(loaded));
  const chips = await page.locator(".imq-device").allTextContents();
  check("queue: device chips on both cards", chips.some((c) => c.includes("desktop")) && chips.some((c) => c.includes("tablet")), chips.join(" | "));
  check("queue: samples listed", (await page.locator(".imq-samples li").count()) === 3);
  await page.screenshot({ path: join(OUT, "widget-03-queue.jpg"), type: "jpeg", quality: 80, fullPage: true });
  await page.click(".imq-card .imq-status");
  await page.waitForFunction(() => document.querySelectorAll(".imq-card").length === 1);
  check("queue: Done closes the issue on GitHub", gh.state.issues[0].state === "closed" || gh.state.issues[1].state === "closed");
  /* The bare URL works now — the ?token= visit armed this browser. */
  await page.goto(`${base}/imredline/queue`);
  await page.waitForSelector(".imq-card");
  check("queue: bare URL works after the token visit", true);
  await page.click(".imq-manage");
  await page.fill(".imq-mint input[maxlength='40']", "Asha");
  await page.click(".imq-mint button[type=submit]");
  await page.waitForSelector(".imq-fresh code");
  const link = await page.locator(".imq-fresh code").textContent();
  check("queue: minted link has the site origin and the param", link.startsWith(base + "/?imredline="), link);
  const p2 = await ctx.newPage();
  await p2.goto(link);
  await p2.waitForSelector(".imr-launch", { timeout: 5000 });
  check("queue: the minted link arms a fresh page", true);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${failed ? `${failed} FAILED` : "all passed"} — pictures in ${OUT}`);
process.exit(failed ? 1 : 0);
