#!/usr/bin/env node
/*
  imredline-fix helper — the review queue from a terminal, through the `gh` CLI
  (no token handling here; `gh auth login` once).

    node queue.mjs list <owner/repo>                 → open tester-feedback reports, newest first (JSON with --json)
    node queue.mjs show <owner/repo> <number>        → one report: type, page, element, device, note, samples,
                                                       and the screenshot saved to a temp file for you to look at
    node queue.mjs done <owner/repo> <number> [--commit <sha>] [--note "…"]
                                                     → comments what was done and closes the issue
    node queue.mjs skip <owner/repo> <number> --why "…"
                                                     → comments why it was not fixed, adds label "wontfix", closes

  Parsing uses the package's own parseIssue, so what you see here is what the
  /imredline/queue page sees. Works from the package repo (dist/) or anywhere
  `imredline` is installed.
*/

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const [verb, repo, num, ...rest] = process.argv.slice(2);
if (!verb || !repo || (verb !== "list" && !num)) usage();
function usage() {
  console.error("usage: queue.mjs list|show|done|skip <owner/repo> [number] [options]  (see header)");
  process.exit(2);
}
const opt = (name) => {
  const i = rest.indexOf(name);
  return i === -1 ? undefined : rest[i + 1];
};
const flag = (name) => rest.includes(name);

async function loadServer() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "../../../dist/server.js"), "imredline/server"];
  for (const c of candidates) {
    try {
      return await import(c);
    } catch {}
  }
  try {
    const req = createRequire(join(process.cwd(), "package.json"));
    return await import(req.resolve("imredline/server"));
  } catch {}
  console.error("Could not load imredline's parser: run from the package repo (after `npm run build`) or a project with `imredline` installed.");
  process.exit(2);
}
const { parseIssue, ASSETS_BRANCH } = await loadServer();

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 50 * 1024 * 1024 });
}
function issues(state = "open") {
  const raw = gh(["api", `repos/${repo}/issues?labels=tester-feedback&state=${state}&per_page=100`]);
  return JSON.parse(raw).filter((i) => !i.pull_request);
}
const rows = (list) => list.map((i) => parseIssue(i));

if (verb === "list") {
  const list = rows(issues());
  if (flag("--json")) {
    console.log(JSON.stringify(list, null, 2));
  } else if (!list.length) {
    console.log(`No open reports on ${repo}. The queue is clear.`);
  } else {
    console.log(`${list.length} open report${list.length === 1 ? "" : "s"} on ${repo}:\n`);
    for (const r of list) {
      console.log(`#${r.number}  ${r.type.toUpperCase().padEnd(6)} ${r.page || "/"}  ${r.element ? "· " + r.element : ""}\n      ${r.note.split("\n")[0].slice(0, 110)}\n      by ${r.reviewer} · ${r.device || "device ?"} · ${r.createdAt.slice(0, 10)}${r.shotPath ? " · 📷" : ""}\n`);
    }
  }
  process.exit(0);
}

const issue = JSON.parse(gh(["api", `repos/${repo}/issues/${num}`]));
const r = parseIssue(issue);

if (verb === "show") {
  let shotPath = null;
  if (r.shotPath) {
    try {
      const dir = mkdtempSync(join(tmpdir(), "imredline-shot-"));
      shotPath = join(dir, `${num}.${r.shotPath.endsWith(".png") ? "png" : "jpg"}`);
      const buf = execFileSync("gh", ["api", `repos/${repo}/contents/${r.shotPath}?ref=${ASSETS_BRANCH}`, "-H", "Accept: application/vnd.github.raw"], { maxBuffer: 50 * 1024 * 1024 });
      writeFileSync(shotPath, buf);
    } catch (e) {
      shotPath = null;
    }
  }
  const out = {
    number: r.number,
    url: issue.html_url,
    type: r.type,
    status: r.status,
    reviewer: r.reviewer,
    page: r.page,
    element: r.element,
    device: r.device,
    viewport: r.viewport,
    note: r.note,
    samples: r.samples,
    shotNote: r.shotNote,
    screenshot: shotPath,
    createdAt: r.createdAt,
  };
  if (flag("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`#${r.number} ${r.type.toUpperCase()} on ${r.page || "/"} — ${issue.html_url}`);
    console.log(`element:   ${r.element || "(none — page-level)"}`);
    console.log(`device:    ${r.device || "?"}${r.viewport ? " · " + r.viewport : ""}`);
    console.log(`reviewer:  ${r.reviewer} · ${r.createdAt.slice(0, 16).replace("T", " ")}`);
    console.log(`note:      ${r.note}`);
    if (r.samples?.length) console.log(`samples:   ${r.samples.map((s) => (s.kind === "image" ? s.name || s.value : s.value)).join(", ")}`);
    if (r.shotNote) console.log(`shot note: ${r.shotNote}`);
    console.log(`screenshot: ${shotPath || "(none)"}${shotPath ? "  ← open it; the red box marks what was pinned" : ""}`);
  }
  process.exit(0);
}

if (verb === "done") {
  const commit = opt("--commit");
  const note = opt("--note") || "";
  const body = ["Fixed.", commit ? `Commit ${commit}.` : "", note].filter(Boolean).join(" ") + "\n\n— imredline-fix";
  gh(["api", `repos/${repo}/issues/${num}/comments`, "-f", `body=${body}`]);
  gh(["api", "-X", "PATCH", `repos/${repo}/issues/${num}`, "-f", "state=closed", "-f", "state_reason=completed"]);
  console.log(`#${num} closed as fixed${commit ? " (" + commit + ")" : ""}.`);
  process.exit(0);
}

if (verb === "skip") {
  const why = opt("--why");
  if (!why) usage();
  gh(["api", `repos/${repo}/issues/${num}/comments`, "-f", `body=Not changing this: ${why}\n\n— imredline-fix`]);
  gh(["api", `repos/${repo}/issues/${num}/labels`, "-f", "labels[]=wontfix"]);
  gh(["api", "-X", "PATCH", `repos/${repo}/issues/${num}`, "-f", "state=closed", "-f", "state_reason=not_planned"]);
  console.log(`#${num} closed as not planned.`);
  process.exit(0);
}
usage();
