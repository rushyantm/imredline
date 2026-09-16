#!/usr/bin/env node
/*
  Renders docs/media/fix-transcript.json (a condensed, real Claude Code run of
  "Fix the review queue") as a terminal window and records it to
  docs/media/demo-fix.gif. Deterministic; re-run after a transcript edit.

    node scripts/media-terminal.mjs

  Needs system Chrome (Playwright channel "chrome") and ffmpeg.
*/

import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const OUT = join(ROOT, "docs/media");
const transcript = JSON.parse(await readFile(join(OUT, "fix-transcript.json"), "utf8"));

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {}
  return import(join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "playwright/index.mjs"));
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0d0f12;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
  .win{width:1000px;height:930px;margin:0 auto;background:#15181d;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden;display:flex;flex-direction:column}
  .bar{height:38px;background:#1d2127;display:flex;align-items:center;padding:0 14px;gap:8px;color:#8a919c;font-size:13px;font-family:ui-sans-serif,-apple-system,Segoe UI,Helvetica,Arial}
  .bar i{width:12px;height:12px;border-radius:50%;display:inline-block}
  .bar .t{margin-left:auto;margin-right:auto}
  .term{flex:1;padding:18px 22px;color:#d7dce2;font-size:14px;line-height:1.45;overflow:hidden;white-space:pre-wrap;word-break:break-word}
  .l{opacity:0}
  .l.on{opacity:1}
  .prompt{color:#e8ecf1}.prompt b{color:#e2483d;font-weight:700}
  .think{color:#e8ecf1}.think::before{content:"● ";color:#e2483d}
  .tool{color:#8fb3ff}.tool::before{content:"  ⎿ ";color:#5b6573}
  .out{color:#9aa4b1}.out::before{content:"    "}
  .ok{color:#7fd39a}.ok::before{content:"  ✔ "}
  .final{color:#e8ecf1;margin-top:6px}.final::before{content:"● ";color:#7fd39a}
  .table{color:#c9d1da}
  .cursor{display:inline-block;width:9px;height:17px;background:#e2483d;vertical-align:-3px}
</style></head><body>
<div class="win"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span class="t">${esc(transcript.title || "terminal")}</span></div>
<div class="term" id="term"><div class="l on prompt" id="p"><b>›</b> <span id="typed"></span><span class="cursor" id="cur"></span></div></div></div>
<script>
  const lines = ${JSON.stringify(transcript.lines)};
  const term = document.getElementById("term");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function trim() { while (term.scrollHeight > term.clientHeight && term.children.length > 1) term.removeChild(term.children[0]); }
  window.play = async function () {
    await sleep(900);
    const typed = document.getElementById("typed");
    const first = lines[0];
    for (const ch of first.t) { typed.textContent += ch; await sleep(38 + Math.random() * 40); }
    await sleep(500);
    document.getElementById("cur").remove();
    await sleep(first.pause);
    for (const l of lines.slice(1)) {
      const d = document.createElement("div");
      d.className = "l " + l.k;
      d.textContent = l.t;
      term.appendChild(d);
      trim();
      d.classList.add("on");
      await sleep(l.pause);
    }
    const c = document.createElement("div"); c.className = "l on prompt"; c.innerHTML = '<b>›</b> <span class="cursor"></span>'; term.appendChild(c); trim();
    await sleep(1800);
    window.__done = true;
  };
</script></body></html>`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: "chrome" });
const vdir = await mkdtemp(join(tmpdir(), "imredline-term-"));
const ctx = await browser.newContext({ viewport: { width: 1000, height: 930 }, deviceScaleFactor: 1, recordVideo: { dir: vdir, size: { width: 1000, height: 930 } } });
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => window.play());
await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
const video = page.video();
await ctx.close();
await browser.close();
const webm = await video.path();
const gif = join(OUT, "demo-fix.gif");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-vf", "fps=8,mpdecimate=hi=64*4:lo=64*2:frac=0.1,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64:stats_mode=diff[p];[s1][p]paletteuse=dither=none:diff_mode=rectangle", "-fps_mode", "vfr", "-loop", "0", gif]);
await rm(vdir, { recursive: true, force: true });
console.log("wrote docs/media/demo-fix.gif");
