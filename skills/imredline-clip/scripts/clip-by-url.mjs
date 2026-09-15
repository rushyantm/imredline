#!/usr/bin/env node
/*
  imredline-clip helper: clip a component from ANY page, including the ones
  whose Content-Security-Policy refuses the bookmarklet (Linear, Apple, Stripe…).

  It opens the page in a headless Chrome that ignores the page's CSP, injects
  the host's own IMRedline widget with the owner's token, pins the element by
  focus (exactly the element asked for, no coordinates), fills the dialog and
  presses Clip. The clip lands where every other clip lands: the host's
  imredline-clips branch, visible in the host's gallery.

    node clip-by-url.mjs <url> --list                       → numbered candidates (tag, classes, size, text, selector)
    node clip-by-url.mjs <url> --pick "<css selector>" [--widen N] [--narrow N]
                              [--name X] [--collection Y] [--note "…"]
                              [--viewport 1280x900 | mobile] [--dry-run] [--out <dir>]
    node clip-by-url.mjs <url> --text "<visible text>"      → the smallest element containing that text (then --widen)

  Host + token, in this order (the token is held in memory and NEVER printed):
    --host <origin>            default https://nutritionnest.com
    IMREDLINE_CLIP_TOKEN env   the admin (or a reviewer) token for that host
    --railway <service> --railway-dir <dir>
                               default nutritionnest-site / ~/Documents/Claude/Projects/nutritionnest-rebuild;
                               reads IMREDLINE_ADMIN_TOKEN via `railway variables --json` in memory

  --dry-run does everything except Send: the screenshot is saved to --out (default: the OS temp dir)
  so the caller can look at it and confirm the right element was picked.
*/

import { execFileSync, execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const url = argv[0];
if (!url || url.startsWith("--")) usage();
function opt(name, dflt) {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
}
const flag = (name) => argv.includes(name);
function usage() {
  console.error("usage: clip-by-url.mjs <url> (--list | --pick <selector> | --text <text>) [options]  (see header)");
  process.exit(2);
}

const HOST = (opt("--host", "https://nutritionnest.com") || "").replace(/\/+$/, "");
const BASE = "/imredline";
const LIST = flag("--list");
const PICK = opt("--pick");
const TEXT = opt("--text");
const WIDEN = Number(opt("--widen", "0")) || 0;
const NARROW = Number(opt("--narrow", "0")) || 0;
const NAME = opt("--name");
const COLLECTION = opt("--collection", "inspiration");
const NOTE = opt("--note", "");
const DRY = flag("--dry-run");
const OUT = opt("--out", tmpdir());
const VIEWPORT = opt("--viewport", "1280x900");
if (!LIST && !PICK && !TEXT) usage();

/* ── token ── */
function token() {
  if (LIST) return "";
  if (process.env.IMREDLINE_CLIP_TOKEN) return process.env.IMREDLINE_CLIP_TOKEN;
  const service = opt("--railway", "nutritionnest-site");
  const dir = opt("--railway-dir", join(homedir(), "Documents/Claude/Projects/nutritionnest-rebuild"));
  try {
    const vars = JSON.parse(execFileSync("railway", ["variables", "--service", service, "--json"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    const t = vars.IMREDLINE_ADMIN_TOKEN || vars.REVIEW_ADMIN_TOKEN || "";
    if (!t) throw new Error("no IMREDLINE_ADMIN_TOKEN on that service");
    return t;
  } catch (e) {
    console.error("token: set IMREDLINE_CLIP_TOKEN or point --railway/--railway-dir at the host's service (" + (e.message || e) + ")");
    process.exit(2);
  }
}

/* ── playwright, wherever it is ── */
async function playwright() {
  try {
    return await import("playwright");
  } catch {}
  const root = execSync("npm root -g", { encoding: "utf8" }).trim();
  return import(join(root, "playwright/index.mjs"));
}

const TOKEN = token();
const { chromium } = await playwright();
const mobile = VIEWPORT === "mobile";
const [vw, vh] = mobile ? [390, 844] : VIEWPORT.split("x").map(Number);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({
  bypassCSP: true,
  viewport: { width: vw, height: vh },
  deviceScaleFactor: mobile ? 3 : 2,
  isMobile: mobile,
  hasTouch: mobile,
  userAgent: mobile ? undefined : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && /imredline|widget\.js/i.test(m.text())) errors.push(m.text()); });
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);

  if (LIST) {
    const rows = await page.evaluate(() => {
      const path = (el) => {
        const parts = [];
        let anchored = false;
        for (let e = el; e && e !== document.body; e = e.parentElement) {
          if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) { parts.unshift("#" + CSS.escape(e.id)); anchored = true; break; }
          const tag = e.tagName.toLowerCase();
          const sibs = e.parentElement ? [...e.parentElement.children].filter((s) => s.tagName === e.tagName) : [];
          parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(e) + 1})` : tag);
        }
        return (anchored ? "" : "body > ") + parts.join(" > ");
      };
      const seen = new Set();
      const out = [];
      const cands = document.querySelectorAll("header, nav, main, section, article, aside, footer, form, main > *, body > *, [class*=hero], [class*=Hero], [class*=pricing], [class*=Pricing], [class*=card], [class*=Card], [class*=cta], [class*=feature], [class*=testimonial]");
      for (const el of cands) {
        if (seen.has(el) || el.closest("[class^=imr-]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height < 60) continue;
        seen.add(el);
        const text = (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 70);
        const cls = [...el.classList].filter((c) => !/^[a-z]{1,2}-|^css-|^sc-|^_/.test(c)).slice(0, 3).join(".");
        out.push({ tag: el.tagName.toLowerCase(), cls, id: el.id || "", w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + scrollY), text, selector: path(el) });
        if (out.length >= 40) break;
      }
      return out;
    });
    console.log(`${rows.length} candidates on ${url} (viewport ${vw}×${vh}); pick one with --pick "<selector>", then --widen/--narrow to adjust:\n`);
    rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. <${r.tag}${r.id ? "#" + r.id : ""}${r.cls ? "." + r.cls : ""}>  ${r.w}×${r.h} @y${r.top}  "${r.text}"\n    --pick "${r.selector}"`));
    await browser.close();
    process.exit(0);
  }

  /* inject the widget with the token on the tag, like the bookmarklet does */
  await page.evaluate(([host, base, tok]) => {
    const s = document.createElement("script");
    s.src = host + base + "/widget.js";
    s.dataset.host = host;
    s.dataset.base = base;
    s.dataset.token = tok;
    document.head.appendChild(s);
  }, [HOST, BASE, TOKEN]);
  const clipBtn = await page.waitForSelector(".imr-clip", { timeout: 20000 }).catch(() => null);
  if (!clipBtn) {
    console.error("The widget did not arm on this page. Is the token valid for " + HOST + "? Console: " + (errors.slice(-3).join(" | ") || "nothing"));
    await browser.close();
    process.exit(1);
  }

  /* find the element */
  const handle = TEXT
    ? await page.evaluate((needle) => {
        const norm = (t) => t.replace(/\s+/g, " ").trim().toLowerCase();
        const n = norm(needle);
        let best = null;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        for (let el = walker.nextNode(); el; el = walker.nextNode()) {
          if (el.closest("[class^=imr-]") || el.closest("script,style")) continue;
          if (norm(el.innerText || "").includes(n)) best = el; /* deepest match wins: later in document order = deeper or later */
        }
        if (best) { best.setAttribute("data-imr-pick", "1"); return true; }
        return false;
      }, TEXT)
      ? await page.$("[data-imr-pick]")
      : null
    : await page.$(PICK);
  if (!handle) {
    console.error("No element found for " + (TEXT ? `text "${TEXT}"` : `selector "${PICK}"`) + ". Run with --list to see candidates.");
    await browser.close();
    process.exit(1);
  }
  await handle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);

  /* arm, then pin by focus + Enter: exactly this element, no coordinates */
  await clipBtn.click();
  await page.waitForSelector(".imr-overlay--clip", { timeout: 5000 });
  await handle.evaluate((el) => {
    el.removeAttribute("data-imr-pick");
    if (el.tabIndex < 0) el.tabIndex = -1;
    el.focus({ preventScroll: true });
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await page.waitForSelector("dialog.imr-dialog--clip[open]", { timeout: 10000 });
  for (let i = 0; i < WIDEN; i++) await page.click(".imr-wn button:has-text('Widen')");
  for (let i = 0; i < NARROW; i++) await page.click(".imr-wn button:has-text('Narrow')");
  if (NAME) await page.fill(".imr-fields input:nth-child(1)", NAME);
  await page.fill(".imr-fields input:nth-child(2)", COLLECTION);
  if (NOTE) await page.fill(".imr-note--short", NOTE);
  await page.waitForFunction(() => /Screenshot ready|screenshot/i.test(document.querySelector(".imr-dialog--clip .imr-shot")?.textContent || "") && !/Preparing/.test(document.querySelector(".imr-dialog--clip .imr-shot")?.textContent || ""), null, { timeout: 30000 });
  const info = await page.evaluate(() => ({
    target: document.querySelector(".imr-dialog--clip .imr-target, .imr-dialog--clip .imr-on")?.textContent || "",
    stats: document.querySelector(".imr-cstats")?.textContent || "",
    shot: document.querySelector(".imr-dialog--clip .imr-shot")?.textContent || "",
    name: document.querySelector(".imr-fields input:nth-child(1)")?.value || "",
    img: document.querySelector(".imr-dialog--clip .imr-shot img")?.src || "",
  }));
  mkdirSync(OUT, { recursive: true });
  const shotPath = join(OUT, `clip-${new URL(url).host.replace(/[^\w.-]/g, "_")}-${(info.name || "component").replace(/[^\w-]/g, "_")}.jpg`);
  if (info.img.startsWith("data:")) writeFileSync(shotPath, Buffer.from(info.img.split(",")[1], "base64"));
  console.log(`element: ${info.target || "(see stats)"}\nname: ${info.name}\ncollection: ${COLLECTION}\nstats: ${info.stats}\nshot: ${info.shot.replace(/Screenshot ready/, "").trim() || "ready"} → ${shotPath}`);
  if (DRY) {
    console.log("dry run — nothing sent. Look at the screenshot; re-run without --dry-run (add --widen/--narrow or --name) to clip it.");
    await browser.close();
    process.exit(0);
  }
  const posted = page.waitForResponse((r) => r.url().includes(BASE + "/api/clip") && r.request().method() === "POST", { timeout: 60000 });
  await page.click(".imr-dialog--clip .imr-send");
  const res = await posted;
  const body = await res.json().catch(() => ({}));
  if (!res.ok() || !body.ok) {
    console.error(`clip refused: ${res.status()} ${JSON.stringify(body).slice(0, 300)}`);
    await browser.close();
    process.exit(1);
  }
  console.log(`clipped: ${body.path}${body.hasShot ? "" : " (no screenshot)"}\ngallery: ${HOST}${BASE}/clips`);
} finally {
  await browser.close().catch(() => {});
}
