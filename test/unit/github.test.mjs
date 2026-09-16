import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHub } from "../../dist/core/github.js";
import { fakeGitHub, TEST_ENV } from "../helpers/fake-github.mjs";

test("commitFiles: a delete entry uses sha:null with no blob, in one commit", async () => {
  const fake = fakeGitHub();
  const gh = new GitHub(TEST_ENV, fake.fetch);
  const branch = "imredline-clips";
  await gh.commitFiles(branch, "seed", [{ path: "clips/ideas/hero/audit.md", content: "audit" }, { path: "keep.txt", content: "keep" }]);
  const before = fake.state.requests.length;
  const sha = await gh.commitFiles(branch, "discard ideas/hero", [{ path: "clips/ideas/hero/audit.md", delete: true }, { path: "clips/index.json", content: "[]\n" }]);
  const calls = fake.state.requests.slice(before);
  assert.ok(sha);
  assert.equal(calls.filter((r) => r.path === "/git/blobs").length, 1);
  assert.deepEqual(calls.find((r) => r.path === "/git/trees").body.tree[0], { path: "clips/ideas/hero/audit.md", mode: "100644", type: "blob", sha: null });
  assert.equal(fake.state.commits.length, 2);
  assert.equal(fake.state.contents.has(`${branch}:clips/ideas/hero/audit.md`), false);
  assert.equal(fake.state.contents.get(`${branch}:keep.txt`).toString(), "keep");
});
