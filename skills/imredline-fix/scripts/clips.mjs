#!/usr/bin/env node
/*
  Clip housekeeping through gh (use the clips repo, IMREDLINE_CLIPS_REPO
  when configured, otherwise IMREDLINE_GITHUB_REPO).

    node clips.mjs list <owner/repo>                         → index as JSON
    node clips.mjs discard <owner/repo> <clips/coll/slug> [--why "…"]

  The index and every file in the folder disappear in one Git Data commit.
  Undo with git revert of the printed commit on imredline-clips.
*/
import { execFileSync } from "node:child_process";

const [verb, repo, path, ...rest] = process.argv.slice(2);
const branch = "imredline-clips";
function usage() {
  console.error('usage: clips.mjs list <owner/repo> | discard <owner/repo> <clips/coll/slug> [--why "…"]');
  process.exit(2);
}
if (!["list", "discard"].includes(verb) || (!/^[\w.-]+\/[\w.-]+$/.test(repo || "") || repo.split("/").some((part) => part === "." || part === ".."))) usage();
if (verb === "discard" && !/^clips\/[a-z0-9-]{1,40}\/[a-z0-9-]{1,48}$/.test(path || "")) usage();
if (rest.length && (rest.length !== 2 || rest[0] !== "--why")) usage();
const why = (rest[1] || "").trim();
if (why.length > 300) usage();
function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 50 * 1024 * 1024 });
}
function api(endpoint, method = "GET", body) {
  const args = ["api", `repos/${repo}${endpoint}`, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  return JSON.parse(gh(args, body === undefined ? undefined : JSON.stringify(body)));
}
function readIndex(ref) {
  const entries = JSON.parse(gh(["api", `repos/${repo}/contents/clips/index.json?ref=${ref}`, "-H", "Accept: application/vnd.github.raw"]));
  if (!Array.isArray(entries) || entries.some((e) => !e || typeof e.path !== "string")) throw new Error("The clips index is unreadable.");
  return entries;
}
try {
  if (verb === "list") {
    console.log(JSON.stringify(readIndex(branch), null, 2));
  } else {
    /* Read one immutable snapshot. A competing branch update will refuse
       our non-forced ref move instead of overwriting its index. */
    const parent = api(`/git/ref/heads/${branch}`).object.sha;
    const entries = readIndex(parent);
    if (!entries.some((e) => e.path === path)) throw new Error("That clip does not exist here.");
    const files = api(`/contents/${path}?ref=${parent}`);
    if (!Array.isArray(files) || !files.length || files.some((f) => !f || f.type !== "file" || typeof f.path !== "string" || !f.path.startsWith(path + "/") || f.path.slice(path.length + 1).includes("/"))) throw new Error("Could not read every file in the clip folder.");
    const base = api(`/git/commits/${parent}`).tree.sha;
    const tree = api("/git/trees", "POST", {
      base_tree: base,
      tree: [
        { path: "clips/index.json", mode: "100644", type: "blob", content: JSON.stringify(entries.filter((e) => e.path !== path), null, 2) + "\n" },
        ...files.map((f) => ({ path: f.path, mode: "100644", type: "blob", sha: null })),
      ],
    }).sha;
    const commit = api("/git/commits", "POST", { message: `discard ${path.slice(6)} (by claude)${why ? ": " + why : ""}`, tree, parents: [parent] }).sha;
    api(`/git/refs/heads/${branch}`, "PATCH", { sha: commit, force: false });
    console.log(JSON.stringify({ ok: true, commit, path }, null, 2));
  }
} catch (e) {
  console.error(`${e.message}${verb === "discard" ? " The discard was not confirmed; check the branch before retrying." : ""}`);
  process.exit(1);
}
