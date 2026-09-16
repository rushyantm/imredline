import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const path = "clips/ideas/hero-01";
const keep = { path: "clips/ideas/keep-01", requestId: "keep", extra: true };
function run(t, script, args, mode = "") {
  const dir = mkdtempSync(join(tmpdir(), "imredline-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "calls.jsonl");
  const index = [{ path }, keep];
  /* A real child process with a fake gh on PATH: exercise argv and JSON stdin
     without invoking the installed CLI or contacting GitHub. */
  writeFileSync(join(dir, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const input = args.includes("--input") ? JSON.parse(fs.readFileSync(0, "utf8")) : null;
let calls = [];
try { calls = fs.readFileSync(process.env.IMR_TEST_LOG, "utf8").trim().split("\\n").map(JSON.parse); } catch {}
fs.appendFileSync(process.env.IMR_TEST_LOG, JSON.stringify({ args, input }) + "\\n");
const mode = process.env.IMR_TEST_MODE;
const endpoint = args[1] || "";
if (mode === "comment-fails" && endpoint.endsWith("/comments")) process.exit(1);
if (args[0] === "issue" && args[1] === "edit" && (mode === "label-fails" || (mode === "missing-label" && !calls.some((c) => c.args[0] === "label")))) process.exit(1);
if (mode === "tree-fails" && endpoint.endsWith("/git/trees")) process.exit(1);
if (mode === "ref-fails" && endpoint.includes("/git/refs/heads/")) process.exit(1);
let out = {};
if (endpoint.endsWith("/issues/12")) out = { number: 12, title: "[bug] / — note", body: "original", html_url: "https://github.com/acme/site/issues/12", state: "open", created_at: "", labels: [{name:"triaged:bug"}] };
else if (endpoint.includes("/git/ref/heads/")) out = { object: { sha: "parent123" } };
else if (endpoint.includes("/contents/clips/index.json")) out = mode === "missing-clip" ? [] : mode === "bad-index" ? {} : ${JSON.stringify(index)};
else if (endpoint.includes("/contents/clips/ideas/hero-01")) out = ["meta.json", "audit.md", "extra.txt"].map((f) => ({ path: "${path}/" + f, type: mode === "directory" ? "dir" : "file" }));
else if (endpoint.endsWith("/git/commits/parent123")) out = { tree: { sha: "base123" } };
else if (endpoint.endsWith("/git/trees")) out = { sha: "tree123" };
else if (endpoint.endsWith("/git/commits")) out = { sha: "commit123" };
console.log(JSON.stringify(out));
`, { mode: 0o755 });
  const child = spawnSync(process.execPath, [resolve(`skills/imredline-fix/scripts/${script}.mjs`), ...args], {
    encoding: "utf8", env: { ...process.env, PATH: dir + ":" + process.env.PATH, IMR_TEST_LOG: log, IMR_TEST_MODE: mode },
  });
  let calls = [];
  try { calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse); } catch {}
  return { ...child, calls };
}

for (const verb of ["discard", "skip"]) {
  test(`queue CLI ${verb}: one comment, close not planned and discarded label only`, (t) => {
    const why = 'Duplicate: `x` $(echo private) "quoted"';
    const out = run(t, "queue", [verb, "acme/site", "12", "--why", why]);
    assert.equal(out.status, 0, out.stderr);
    const calls = out.calls.map((c) => c.args);
    assert.deepEqual(calls, [
      ["api", "repos/acme/site/issues/12"],
      ["api", "repos/acme/site/issues/12/comments", "-f", `body=Discarded from the queue by claude: ${why}`],
      ["issue", "close", "12", "--repo", "acme/site", "--reason", "not planned"],
      ["issue", "edit", "12", "--repo", "acme/site", "--add-label", "discarded"],
    ]);
  });
}

test("queue CLI: missing label is created with metadata, then retried", (t) => {
  const out = run(t, "queue", ["discard", "acme/site", "12", "--why", "duplicate"], "missing-label");
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.calls.find((c) => c.args[0] === "label").args, ["label", "create", "discarded", "--repo", "acme/site", "--color", "9e9e9e", "--description", "Discarded from the review queue"]);
  assert.equal(out.calls.filter((c) => c.args[0] === "issue" && c.args[1] === "edit").length, 2);
});

test("queue CLI: label failure says already closed; comment failure prevents close", (t) => {
  const args = ["discard", "acme/site", "12", "--why", "duplicate"];
  const label = run(t, "queue", args, "label-fails");
  assert.equal(label.status, 1);
  assert.match(label.stderr, /closed as not planned.*label was not applied/);
  const comment = run(t, "queue", args, "comment-fails");
  assert.equal(comment.status, 1);
  assert.equal(comment.calls.some((c) => c.args[0] === "issue"), false);
});

test("queue CLI: discard needs why, at most 300 characters; no write on invalid input", (t) => {
  for (const opts of [[], ["--why", " "], ["--why", "x".repeat(301)]]) {
    const out = run(t, "queue", ["discard", "acme/site", "12", ...opts]);
    assert.equal(out.status, 2);
    assert.ok(out.calls.every((c) => c.args.length === 2 && c.args[1].endsWith("/issues/12")));
  }
});

test("clips CLI: list reads index as raw JSON on clips branch", (t) => {
  const out = run(t, "clips", ["list", "other/swipe"]);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), [{ path }, keep]);
  assert.deepEqual(out.calls[0].args, ["api", "repos/other/swipe/contents/clips/index.json?ref=imredline-clips", "-H", "Accept: application/vnd.github.raw"]);
});

for (const why of [undefined, 'No longer needed: `x` $(echo private) "quoted"']) {
  test(`clips CLI: atomic discard ${why ? "with" : "without"} why`, (t) => {
    const out = run(t, "clips", ["discard", "other/swipe", path, ...(why ? ["--why", why] : [])]);
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), { ok: true, commit: "commit123", path });
    assert.ok(out.calls.every((c) => c.args[1].startsWith("repos/other/swipe/")));
    assert.ok(out.calls.filter((c) => c.args[1].includes("/contents/")).every((c) => c.args[1].endsWith("?ref=parent123")));
    assert.equal(out.calls.some((c) => c.args[1].endsWith("/git/blobs")), false);
    const tree = out.calls.find((c) => c.args[1].endsWith("/git/trees")).input;
    assert.equal(tree.base_tree, "base123");
    assert.deepEqual(JSON.parse(tree.tree[0].content), [keep]);
    assert.deepEqual(tree.tree.slice(1), ["meta.json", "audit.md", "extra.txt"].map((f) => ({ path: `${path}/${f}`, mode: "100644", type: "blob", sha: null })));
    const commits = out.calls.filter((c) => c.args[1].endsWith("/git/commits"));
    assert.equal(commits.length, 1);
    assert.deepEqual(commits[0].input, { message: `discard ideas/hero-01 (by claude)${why ? ": " + why : ""}`, tree: "tree123", parents: ["parent123"] });
    assert.deepEqual(out.calls.at(-1).input, { sha: "commit123", force: false });
  });
}

test("clips CLI: invalid path/repo fails before gh; absent clip or unreadable index/folder cannot write", (t) => {
  for (const args of [["discard", "acme/site", "clips/../secrets"], ["discard", "../site", path], ["discard", "acme/site", path + "/meta.json"]]) {
    const out = run(t, "clips", args);
    assert.equal(out.status, 2);
    assert.equal(out.calls.length, 0);
  }
  for (const mode of ["missing-clip", "bad-index", "directory"]) {
    const out = run(t, "clips", ["discard", "acme/site", path], mode);
    assert.equal(out.status, 1);
    assert.ok(out.calls.every((c) => !c.input));
  }
});

test("clips CLI: tree failure never moves ref; rejected ref never claims success", (t) => {
  const tree = run(t, "clips", ["discard", "acme/site", path], "tree-fails");
  assert.equal(tree.status, 1);
  assert.equal(tree.calls.some((c) => c.args[1].includes("/git/refs/")), false);
  const ref = run(t, "clips", ["discard", "acme/site", path], "ref-fails");
  assert.equal(ref.status, 1);
  assert.equal(ref.stdout, "");
  assert.match(ref.stderr, /discard was not confirmed/);
});
