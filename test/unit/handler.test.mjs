import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle } from "../../dist/core/handler.js";
import { fakeGitHub, PNG_1x1, TEST_ENV } from "../helpers/fake-github.mjs";

const ORIGIN = "http://site.test";
const env = { ...TEST_ENV, IMREDLINE_DATA_DIR: mkdtempSync(join(tmpdir(), "imredline-")), IMREDLINE_ORIGINS: "https://old.example" };
const gh = fakeGitHub();
const opts = { env, fetch: gh.fetch };

const call = (path, init = {}, headers = {}) =>
  handle(
    new Request(ORIGIN + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...headers },
      body: init.json !== undefined ? JSON.stringify(init.json) : (init.body ?? null),
    }),
    opts,
  );
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const report = (over = {}) => ({
  requestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  type: "bug",
  note: "The booking button does nothing at all.",
  page: "/book",
  selector: "form#book > button",
  viewport: { width: 390, height: 844, dpr: 3 },
  device: { kind: "phone", orientation: "portrait", touch: true },
  screenshot: PNG_1x1,
  samples: [
    { kind: "image", name: "ref.png", data: PNG_1x1 },
    { kind: "link", value: "https://example.com/ref" },
    { kind: "path", value: "~/Desktop/ref.png" },
  ],
  ...over,
});

test("not ours → null; static assets and the queue page are served", async () => {
  assert.equal(await handle(new Request(ORIGIN + "/about"), opts), null);
  const w = await call("/_imredline/widget.js");
  assert.equal(w.status, 200);
  assert.ok((await w.text()).includes("imredline"));
  const q = await call("/_imredline/queue");
  assert.equal(q.status, 200);
  assert.ok((await q.text()).includes('id="imq"'));
});

test("session: a good token sets cookies; a bad one clears them; GET reads the cookie back", async () => {
  const ok = await call("/_imredline/api/session", { method: "POST", json: { token: "ravi-secret" } });
  assert.equal(ok.status, 200);
  const cookies = cookieOf(ok);
  assert.ok(cookies.includes("imredline=ravi-secret") && cookies.includes("imredline_on=1"));
  const me = await call("/_imredline/api/session", {}, { cookie: cookies });
  assert.deepEqual((await me.json()).name, "ravi");
  const bad = await call("/_imredline/api/session", { method: "POST", json: { token: "wrong" } });
  assert.equal(bad.status, 401);
  assert.ok(cookieOf(bad).includes("imredline=;"));
});

test("report: files the issue with shot, device and samples on the assets branch", async () => {
  const res = await call("/_imredline/api/report", { method: "POST", json: report() }, { cookie: "imredline=sri-secret" });
  const out = await res.json();
  assert.equal(res.status, 201, JSON.stringify(out));
  assert.equal(out.number, 1);
  assert.equal(out.hasShot, true);
  assert.equal(out.samplesSaved, 3);
  const issue = gh.state.issues[0];
  assert.deepEqual(issue.labels.map((l) => l.name), ["tester-feedback", "site:acme"]);
  assert.ok(issue.title.startsWith("[bug] /book — The booking button"));
  assert.ok(issue.body.includes("- **reviewer:** Sriharsha Salaka"));
  assert.ok(issue.body.includes("- **viewport:** 390x844 @3x"));
  assert.ok(issue.body.includes("- **device:** phone · portrait · touch"));
  assert.match(issue.body, /📷 `shots\/[0-9TZ-]+-Sriharsha-Salaka\.png` on `imredline-assets`/);
  assert.match(issue.body, /🖼 `samples\/[0-9TZ-]+-Sriharsha-Salaka-1\.png`/);
  assert.ok(issue.body.includes("https://example.com/ref"));
  assert.ok(issue.body.includes("~/Desktop/ref.png"));
  assert.ok(gh.state.branches.has("imredline-assets"));
  assert.equal([...gh.state.contents.keys()].filter((k) => k.startsWith("imredline-assets:")).length, 2);
});

test("report: the same requestId again is found, not filed twice", async () => {
  const res = await call("/_imredline/api/report", { method: "POST", json: report() }, { cookie: "imredline=sri-secret" });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.duplicate, true);
  assert.equal(out.number, 1);
  assert.equal(gh.state.issues.length, 1);
});

test("report: no access → 401 with a cause; scoped link on the wrong site → 403", async () => {
  const anon = await call("/_imredline/api/report", { method: "POST", json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001" }) });
  assert.equal(anon.status, 401);
  assert.match((await anon.json()).error, /expired/);
  const { createReviewer } = await import("../../dist/core/access.js");
  const scoped = await createReviewer({ name: "Scoped", sites: ["other.test"] }, env);
  const wrong = await call("/_imredline/api/report", { method: "POST", json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002", token: scoped.token }) });
  assert.equal(wrong.status, 403);
  const right = await call("/_imredline/api/report", {
    method: "POST",
    json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000003", token: scoped.token, page: "other.test/rooms", samples: [] }),
  });
  assert.equal(right.status, 201);
});

test("report: a bad shot still files, carrying the reason; a GitHub failure keeps the draft", async () => {
  const res = await call(
    "/_imredline/api/report",
    { method: "POST", json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000004", screenshot: "data:image/png;base64,AAAA", samples: [] }) },
    { cookie: "imredline=ravi-secret" },
  );
  assert.equal(res.status, 201);
  assert.equal((await res.json()).hasShot, false);
  assert.ok(gh.state.issues.at(-1).body.includes("**No screenshot** — screenshot too large or not an image"));
  gh.state.failCreate = true;
  const down = await call("/_imredline/api/report", { method: "POST", json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000005", samples: [] }) }, { cookie: "imredline=ravi-secret" });
  gh.state.failCreate = false;
  assert.equal(down.status, 502);
  assert.match((await down.json()).error, /Your note is still here/);
});

test("third-party origin: CORS headers only for the allow-list; token in the body works", async () => {
  const pre = await call("/_imredline/api/report", { method: "OPTIONS" }, { origin: "https://old.example" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://old.example");
  const nope = await call("/_imredline/api/report", { method: "OPTIONS" }, { origin: "https://evil.example" });
  assert.equal(nope.headers.get("access-control-allow-origin"), null);
  const res = await call(
    "/_imredline/api/report",
    { method: "POST", json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000006", token: "ravi-secret", page: "old.example/rooms", samples: [] }) },
    { origin: "https://old.example" },
  );
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://old.example");
  assert.equal(cookieOf(res), "", "no Set-Cookie on a cross-origin response");
});

test("admin-only: queue, status, asset proxy, reviewers; a reviewer is refused", async () => {
  assert.equal((await call("/_imredline/api/queue", {}, { cookie: "imredline=ravi-secret" })).status, 401);
  const q = await call("/_imredline/api/queue?token=admin-secret-token");
  assert.equal(q.status, 200);
  const data = await q.json();
  assert.equal(data.repo, "acme/site");
  assert.ok(data.rows.length >= 4);
  const first = data.rows.find((r) => r.number === 1);
  assert.equal(first.device, "phone · portrait · touch");
  assert.equal(first.samples.length, 3);

  const done = await call("/_imredline/api/report/1", { method: "PATCH", json: { status: "done" } }, { cookie: "imredline=admin-secret-token" });
  assert.equal(done.status, 200);
  assert.equal(gh.state.issues[0].state, "closed");
  assert.equal((await call("/_imredline/api/report/1", { method: "PATCH", json: { status: "planned" } }, { cookie: "imredline=admin-secret-token" })).status, 400);

  const shot = await call(`/_imredline/api/asset?path=${encodeURIComponent(first.shotPath)}`, {}, { cookie: "imredline=admin-secret-token" });
  assert.equal(shot.status, 200);
  assert.equal(shot.headers.get("content-type"), "image/png");
  assert.equal((await call("/_imredline/api/asset?path=../secrets", {}, { cookie: "imredline=admin-secret-token" })).status, 400);

  const mint = await call("/_imredline/api/reviewers", { method: "POST", json: { name: "New Person", days: 7 } }, { cookie: "imredline=admin-secret-token" });
  assert.equal(mint.status, 201);
  const { id, token } = await mint.json();
  assert.ok(await (await call("/_imredline/api/session", { method: "POST", json: { token } })).ok);
  const list = await (await call("/_imredline/api/reviewers", {}, { cookie: "imredline=admin-secret-token" })).json();
  assert.ok(list.reviewers.some((r) => r.name === "New Person"));
  assert.equal((await call(`/_imredline/api/reviewers?id=${id}`, { method: "DELETE" }, { cookie: "imredline=admin-secret-token" })).status, 200);
  assert.equal((await call("/_imredline/api/session", { method: "POST", json: { token } })).status, 401);
});

test("public repo → warning on the queue, not a block", async () => {
  gh.state.isPrivate = false;
  const q = await (await call("/_imredline/api/queue?token=admin-secret-token")).json();
  gh.state.isPrivate = true;
  assert.ok(q.warnings.some((w) => /PUBLIC/.test(w)));
});

test("without GitHub vars every write is a loud 503", async () => {
  const res = await handle(
    new Request(ORIGIN + "/_imredline/api/report", { method: "POST", headers: { cookie: "imredline=ravi-secret", "Content-Type": "application/json" }, body: JSON.stringify(report()) }),
    { env: { ...env, IMREDLINE_GITHUB_TOKEN: "" } },
  );
  assert.equal(res.status, 503);
});
