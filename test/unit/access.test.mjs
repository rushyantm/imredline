import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveToken, createReviewer, revokeReviewer, listReviewers, allowedSite, cookieValue, accessCookies, reviewerCount } from "../../dist/core/access.js";
import { TEST_ENV } from "../helpers/fake-github.mjs";

const env = { ...TEST_ENV, IMREDLINE_DATA_DIR: mkdtempSync(join(tmpdir(), "imredline-")) };

test("admin and env reviewers resolve; garbage does not", async () => {
  assert.deepEqual(await resolveToken("admin-secret-token", env), { name: "rishi", admin: true, sites: [] });
  assert.deepEqual(await resolveToken(" sri-secret ", env), { name: "Sriharsha Salaka", admin: false, sites: [] });
  assert.equal(await resolveToken("nope", env), null);
  assert.equal(await resolveToken("", env), null);
  assert.equal(reviewerCount(env), 3);
});

test("minted links: only the hash is stored, expiry and scope apply, revoke works", async () => {
  const made = await createReviewer({ name: "  Tester One ", days: 7, sites: ["Pebblebeachvizag.com"] }, env);
  assert.match(made.token, /^[A-Za-z0-9_-]{32}$/);
  const raw = readFileSync(join(env.IMREDLINE_DATA_DIR, "reviewers.json"), "utf8");
  assert.ok(!raw.includes(made.token), "plaintext token must not be on disk");
  const who = await resolveToken(made.token, env);
  assert.equal(who.name, "Tester One");
  assert.deepEqual(who.sites, ["pebblebeachvizag.com"]);
  assert.equal(allowedSite(who, "pebblebeachvizag.com"), true);
  assert.equal(allowedSite(who, "www.pebblebeachvizag.com:443"), true);
  assert.equal(allowedSite(who, "aradea.in"), false);
  assert.equal(allowedSite({ name: "x", admin: true, sites: ["a"] }, "b"), true);

  const list = await listReviewers(env);
  assert.equal(list.filter((r) => r.source === "minted").length, 1);
  assert.equal(list.filter((r) => r.source === "env").length, 2);

  assert.equal(await revokeReviewer(made.id, env), true);
  assert.equal(await revokeReviewer(made.id, env), false);
  assert.equal(await resolveToken(made.token, env), null);
});

test("two mints in the same tick both survive (serialised store)", async () => {
  const [a, b] = await Promise.all([createReviewer({ name: "A" }, env), createReviewer({ name: "B" }, env)]);
  assert.ok(await resolveToken(a.token, env));
  assert.ok(await resolveToken(b.token, env));
});

test("bad mint inputs are refused", async () => {
  await assert.rejects(createReviewer({ name: "" }, env), /name is required/);
  await assert.rejects(createReviewer({ name: "x", days: 0 }, env), /between 1 and 90/);
});

test("cookies", () => {
  const [tok, hint] = accessCookies("abc def", { NODE_ENV: "production" });
  assert.ok(tok.startsWith("imredline=abc%20def; HttpOnly;"));
  assert.ok(tok.includes("; Secure"));
  assert.ok(hint.startsWith("imredline_on=1;"));
  assert.equal(cookieValue("a=1; imredline=abc%20def; b=2", "imredline"), "abc def");
  assert.equal(cookieValue(null, "imredline"), null);
});
