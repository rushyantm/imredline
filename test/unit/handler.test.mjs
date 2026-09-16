import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle } from "../../dist/core/handler.js";
import { fakeGitHub, JPG_1x1, PNG_1x1, TEST_ENV } from "../helpers/fake-github.mjs";

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
  const w = await call("/imredline/widget.js");
  assert.equal(w.status, 200);
  assert.ok((await w.text()).includes("imredline"));
  const q = await call("/imredline/queue");
  assert.equal(q.status, 200);
  assert.ok((await q.text()).includes('id="imq"'));
});

test("session: a good token sets cookies; a bad one clears them; GET reads the cookie back", async () => {
  const ok = await call("/imredline/api/session", { method: "POST", json: { token: "ravi-secret" } });
  assert.equal(ok.status, 200);
  const cookies = cookieOf(ok);
  assert.ok(cookies.includes("imredline=ravi-secret") && cookies.includes("imredline_on=1"));
  const me = await call("/imredline/api/session", {}, { cookie: cookies });
  assert.deepEqual((await me.json()).name, "ravi");
  const bad = await call("/imredline/api/session", { method: "POST", json: { token: "wrong" } });
  assert.equal(bad.status, 401);
  assert.ok(cookieOf(bad).includes("imredline=;"));
});

test("session: behind a TLS-terminating proxy (http URL, https Origin, same host) the cookie is still set and no CORS header leaks", async () => {
  const res = await call("/imredline/api/session", { method: "POST", json: { token: "ravi-secret" } }, { origin: "https://site.test" });
  assert.equal(res.status, 200);
  assert.ok(cookieOf(res).includes("imredline=ravi-secret"), cookieOf(res));
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  const viaHost = await handle(new Request("http://localhost:3000/imredline/api/session", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://www.site.test", "x-forwarded-host": "www.site.test" }, body: JSON.stringify({ token: "ravi-secret" }) }), opts);
  assert.ok((viaHost.headers.get("set-cookie") || "").includes("imredline=ravi-secret"));
  const foreign = await call("/imredline/api/session", { method: "POST", json: { token: "ravi-secret" } }, { origin: "https://other.test" });
  assert.equal(foreign.headers.get("set-cookie"), null);
});

test("report: files the issue with shot, device and samples on the assets branch", async () => {
  const res = await call("/imredline/api/report", { method: "POST", json: report() }, { cookie: "imredline=sri-secret" });
  const out = await res.json();
  assert.equal(res.status, 201, JSON.stringify(out));
  assert.equal(out.number, 1);
  assert.equal(out.hasShot, true);
  assert.equal(out.samplesSaved, 3);
  const issue = gh.state.issues[0];
  assert.deepEqual(issue.labels.map((l) => l.name), ["tester-feedback", "site:acme"]);
  assert.ok(issue.title.startsWith("[bug] /book — The booking button"));
  assert.ok(issue.body.includes("- **reviewer:** Asha Rao"));
  assert.ok(issue.body.includes("- **viewport:** 390x844 @3x"));
  assert.ok(issue.body.includes("- **device:** phone · portrait · touch"));
  assert.match(issue.body, /📷 `shots\/[0-9TZ-]+-Asha-Rao\.png` on `imredline-assets`/);
  assert.match(issue.body, /🖼 `samples\/[0-9TZ-]+-Asha-Rao-1\.png`/);
  assert.ok(issue.body.includes("https://example.com/ref"));
  assert.ok(issue.body.includes("~/Desktop/ref.png"));
  assert.ok(gh.state.branches.has("imredline-assets"));
  assert.equal([...gh.state.contents.keys()].filter((k) => k.startsWith("imredline-assets:")).length, 2);
});

test("report: the same requestId again is found, not filed twice", async () => {
  const res = await call("/imredline/api/report", { method: "POST", json: report() }, { cookie: "imredline=sri-secret" });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.duplicate, true);
  assert.equal(out.number, 1);
  assert.equal(gh.state.issues.length, 1);
});

test("report: no access → 401 with a cause; scoped link on the wrong site → 403", async () => {
  const anon = await call("/imredline/api/report", { method: "POST", json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001" }) });
  assert.equal(anon.status, 401);
  assert.match((await anon.json()).error, /expired/);
  const { createReviewer } = await import("../../dist/core/access.js");
  const scoped = await createReviewer({ name: "Scoped", sites: ["other.test"] }, env);
  const wrong = await call("/imredline/api/report", { method: "POST", json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002", token: scoped.token }) });
  assert.equal(wrong.status, 403);
  const right = await call("/imredline/api/report", {
    method: "POST",
    json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000003", token: scoped.token, page: "other.test/rooms", samples: [] }),
  });
  assert.equal(right.status, 201);
});

test("report: a bad shot still files, carrying the reason; a GitHub failure keeps the draft", async () => {
  const res = await call(
    "/imredline/api/report",
    { method: "POST", json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000004", screenshot: "data:image/png;base64,AAAA", samples: [] }) },
    { cookie: "imredline=ravi-secret" },
  );
  assert.equal(res.status, 201);
  assert.equal((await res.json()).hasShot, false);
  assert.ok(gh.state.issues.at(-1).body.includes("**No screenshot** — screenshot too large or not an image"));
  gh.state.failCreate = true;
  const down = await call("/imredline/api/report", { method: "POST", json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000005", samples: [] }) }, { cookie: "imredline=ravi-secret" });
  gh.state.failCreate = false;
  assert.equal(down.status, 502);
  assert.match((await down.json()).error, /Your note is still here/);
});

test("third-party origin: CORS headers only for the allow-list; token in the body works", async () => {
  const pre = await call("/imredline/api/report", { method: "OPTIONS" }, { origin: "https://old.example" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://old.example");
  const nope = await call("/imredline/api/report", { method: "OPTIONS" }, { origin: "https://evil.example" });
  assert.equal(nope.headers.get("access-control-allow-origin"), null);
  const res = await call(
    "/imredline/api/report",
    { method: "POST", json: report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000006", token: "ravi-secret", page: "old.example/rooms", samples: [] }) },
    { origin: "https://old.example" },
  );
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://old.example");
  assert.equal(cookieOf(res), "", "no Set-Cookie on a cross-origin response");
});

test("a reviewer reads the queue and its pictures, and cannot write", async () => {
  assert.equal((await call("/imredline/api/queue")).status, 401, "anonymous");
  const rq = await call("/imredline/api/queue", {}, { cookie: "imredline=ravi-secret" });
  assert.equal(rq.status, 200);
  const rd = await rq.json();
  assert.equal(rd.admin, false);
  assert.equal(rd.canMint, false);
  assert.ok(rd.rows.length >= 1);
  const rshot = await call(`/imredline/api/asset?path=${encodeURIComponent(rd.rows.find((r) => r.shotPath).shotPath)}`, {}, { cookie: "imredline=ravi-secret" });
  assert.equal(rshot.status, 200);
  assert.equal((await call("/imredline/api/report/1", { method: "PATCH", json: { status: "done" } }, { cookie: "imredline=ravi-secret" })).status, 401);
  assert.equal((await call("/imredline/api/reviewers", {}, { cookie: "imredline=ravi-secret" })).status, 401);
  assert.equal((await call("/imredline/api/reviewers", { method: "POST", json: { name: "x", days: 7 } }, { cookie: "imredline=ravi-secret" })).status, 401);
  assert.equal(gh.state.issues[0].state, "open", "a reviewer's PATCH changed nothing");
});

test("admin: queue, status, asset proxy, reviewers", async () => {
  const q = await call("/imredline/api/queue?token=admin-secret-token");
  assert.equal(q.status, 200);
  const data = await q.json();
  assert.equal(data.admin, true);
  assert.equal(data.canMint, true);
  assert.equal(data.repo, "acme/site");
  assert.ok(data.rows.length >= 4);
  const first = data.rows.find((r) => r.number === 1);
  assert.equal(first.device, "phone · portrait · touch");
  assert.equal(first.samples.length, 3);

  const done = await call("/imredline/api/report/1", { method: "PATCH", json: { status: "done" } }, { cookie: "imredline=admin-secret-token" });
  assert.equal(done.status, 200);
  assert.equal(gh.state.issues[0].state, "closed");
  assert.equal((await call("/imredline/api/report/1", { method: "PATCH", json: { status: "planned" } }, { cookie: "imredline=admin-secret-token" })).status, 400);

  const shot = await call(`/imredline/api/asset?path=${encodeURIComponent(first.shotPath)}`, {}, { cookie: "imredline=admin-secret-token" });
  assert.equal(shot.status, 200);
  assert.equal(shot.headers.get("content-type"), "image/png");
  assert.equal((await call("/imredline/api/asset?path=../secrets", {}, { cookie: "imredline=admin-secret-token" })).status, 400);

  const mint = await call("/imredline/api/reviewers", { method: "POST", json: { name: "New Person", days: 7 } }, { cookie: "imredline=admin-secret-token" });
  assert.equal(mint.status, 201);
  const { id, token } = await mint.json();
  assert.ok(await (await call("/imredline/api/session", { method: "POST", json: { token } })).ok);
  const list = await (await call("/imredline/api/reviewers", {}, { cookie: "imredline=admin-secret-token" })).json();
  assert.ok(list.reviewers.some((r) => r.name === "New Person"));
  assert.equal((await call(`/imredline/api/reviewers?id=${id}`, { method: "DELETE" }, { cookie: "imredline=admin-secret-token" })).status, 200);
  assert.equal((await call("/imredline/api/session", { method: "POST", json: { token } })).status, 401);
});

test("public repo → warning on the queue, not a block", async () => {
  gh.state.isPrivate = false;
  const q = await (await call("/imredline/api/queue?token=admin-secret-token")).json();
  gh.state.isPrivate = true;
  assert.ok(q.warnings.some((w) => /PUBLIC/.test(w)));
});

test("without GitHub vars every write is a loud 503", async () => {
  const res = await handle(
    new Request(ORIGIN + "/imredline/api/report", { method: "POST", headers: { cookie: "imredline=ravi-secret", "Content-Type": "application/json" }, body: JSON.stringify(report()) }),
    { env: { ...env, IMREDLINE_GITHUB_TOKEN: "" } },
  );
  assert.equal(res.status, 503);
});

test("a bring-your-own token source arms a browser and files, after the built-ins", async () => {
  const extra = { env, fetch: gh.fetch, resolveToken: async (t) => (t === "db-careers-token" ? { name: "Hiring Team" } : null) };
  const ok = await handle(new Request(ORIGIN + "/imredline/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "db-careers-token" }) }), extra);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).name, "Hiring Team");
  assert.ok(cookieOf(ok).includes("imredline=db-careers-token"));
  const no = await handle(new Request(ORIGIN + "/imredline/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "unknown" }) }), extra);
  assert.equal(no.status, 401);
  const filed = await handle(new Request(ORIGIN + "/imredline/api/report", { method: "POST", headers: { "Content-Type": "application/json", cookie: "imredline=db-careers-token" }, body: JSON.stringify(report({ requestId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000007", samples: [] })) }), extra);
  assert.equal(filed.status, 201);
  assert.ok(gh.state.issues.at(-1).body.includes("- **reviewer:** Hiring Team"));
  /* built-ins still win: the admin token stays admin even if the extra source would also answer */
  const adm = await handle(new Request(ORIGIN + "/imredline/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "admin-secret-token" }) }), { ...extra, resolveToken: async () => ({ name: "impostor" }) });
  assert.equal((await adm.json()).admin, true);
});

/* ── Clip (0.5.0) ── */
const clip = (over = {}) => ({
  requestId: "cccccccc-bbbb-4ccc-8ddd-000000000001",
  name: "Hero Section",
  collection: "PEMA rebuild",
  note: "Love the type scale.",
  source: { url: "https://www.example.com/rooms?x=1", title: "Rooms — Example" },
  selector: "section.hero",
  bounds: { width: 1200, height: 480 },
  viewport: { width: 1440, height: 900, dpr: 2 },
  device: { kind: "desktop", orientation: "landscape", touch: false },
  html: '<section class="c1" id="hero">\n  <h1 class="c2">Make room for life</h1>\n  <img class="c3" src="https://www.example.com/a.jpg" alt="room">\n</section>\n',
  css: ".c1 { /* was: hero */\n  display: block;\n  padding-top: 48px;\n  background-color: #e9dfd0;\n}\n.c2 {\n  font-size: 48px;\n}\n.c2:hover { color: #ff0000; }\n",
  tokens: {
    colors: [{ value: "#e9dfd0", count: 1, hsl: "hsl(36 36% 87%)", contrast: 1 }, { value: "#1a1a1a", count: 3, contrast: 12.4 }],
    fonts: [{ value: "Crimson Text", count: 4 }],
    typeScale: [{ value: "48/1.1", count: 1 }],
    spacing: [8, 16, 48],
    radii: [12],
    shadows: [],
    breakpoints: ["(max-width: 640px)"],
  },
  assets: [{ kind: "image", url: "https://www.example.com/a.jpg", alt: "room", rendered: [360, 220], natural: [720, 440] }, { kind: "font", family: "Crimson Text", urls: [] }, { kind: "lottie", url: "https://www.example.com/orbit.json", player: "lottie-web", loop: false, autoplay: true }],
  states: "full",
  unreadable: [],
  counts: { elements: 3, images: 1, fonts: 1, stateRules: 1, keyframes: 0 },
  screenshot: JPG_1x1,
  ...over,
});

test("clip: a reviewer clips → one commit with seven files + index on the clips branch", async () => {
  const before = gh.state.commits.length;
  const res = await call("/imredline/api/clip", { method: "POST", json: clip() }, { cookie: "imredline=ravi-secret" });
  const out = await res.json();
  assert.equal(res.status, 201, JSON.stringify(out));
  assert.equal(out.collection, "pema-rebuild");
  assert.equal(out.slug, "hero-section-01");
  assert.equal(out.path, "clips/pema-rebuild/hero-section-01");
  assert.equal(out.hasShot, true);
  assert.ok(gh.state.branches.has("imredline-clips"));
  assert.equal(gh.state.commits.length, before + 1, "exactly one commit");
  const c = gh.state.commits.at(-1);
  assert.equal(c.branch, "imredline-clips");
  assert.match(c.message, /^clip pema-rebuild\/hero-section-01 from www\.example\.com$/);
  const dir = "imredline-clips:clips/pema-rebuild/hero-section-01/";
  for (const f of ["README.md", "component.html", "component.css", "tokens.json", "meta.json", "preview.html", "screenshot.jpg"]) assert.ok(gh.state.contents.has(dir + f), f);
  assert.ok(gh.state.contents.has("imredline-clips:clips/index.json"));
  const readme = gh.state.contents.get(dir + "README.md").toString();
  assert.ok(readme.startsWith("# hero-section — clipped from www.example.com"));
  assert.ok(readme.includes("- **clipped:** ") && readme.includes(" by ravi"));
  assert.ok(readme.includes("| `#e9dfd0` | hsl(36 36% 87%) | 1 | 1.00 |"));
  assert.ok(readme.includes("**Fonts:** Crimson Text ×4"));
  assert.ok(readme.includes("- lottie https://www.example.com/orbit.json — the markup holds ONE frame of this animation; play it with lottie-web, once, autoplay"), readme);
  assert.ok(readme.includes("- image https://www.example.com/a.jpg — rendered 360×220, natural 720×440, alt “room”"));
  assert.ok(readme.includes("Love the type scale."));
  const preview = gh.state.contents.get(dir + "preview.html").toString();
  assert.ok(preview.includes(".c2:hover { color: #ff0000; }") && preview.includes('<h1 class="c2">Make room for life</h1>'));
  const meta = JSON.parse(gh.state.contents.get(dir + "meta.json").toString());
  assert.equal(meta.reviewer, "ravi");
  assert.equal(meta.widget, "0.6.0");
  assert.equal(meta.source.url, "https://www.example.com/rooms?x=1");
  const shot = gh.state.contents.get(dir + "screenshot.jpg");
  assert.ok(shot[0] === 0xff && shot[1] === 0xd8, "screenshot is a real JPEG");
  const index = JSON.parse(gh.state.contents.get("imredline-clips:clips/index.json").toString());
  assert.equal(index.length, 1);
  assert.equal(index[0].slug, "hero-section-01");
  assert.deepEqual(index[0].colors, ["#e9dfd0", "#1a1a1a"]);
  assert.equal(index[0].screenshot, "clips/pema-rebuild/hero-section-01/screenshot.jpg");
});

test("clip: the same name again is -02; the same requestId again is found, not landed twice", async () => {
  const again = await call("/imredline/api/clip", { method: "POST", json: clip({ requestId: "cccccccc-bbbb-4ccc-8ddd-000000000002", screenshot: undefined }) }, { cookie: "imredline=ravi-secret" });
  const out = await again.json();
  assert.equal(again.status, 201, JSON.stringify(out));
  assert.equal(out.slug, "hero-section-02");
  assert.equal(out.hasShot, false);
  const index = JSON.parse(gh.state.contents.get("imredline-clips:clips/index.json").toString());
  assert.equal(index.length, 2);
  assert.equal(index[0].slug, "hero-section-02", "newest first");
  const commits = gh.state.commits.length;
  const twin = await call("/imredline/api/clip", { method: "POST", json: clip() }, { cookie: "imredline=ravi-secret" });
  assert.equal(twin.status, 200);
  assert.equal((await twin.json()).duplicate, true);
  assert.equal(gh.state.commits.length, commits, "no new commit for a twin");
});

test("clip: caps and scripts are refused; anonymous → 401; a scoped link clips only its own site", async () => {
  const big = await call("/imredline/api/clip", { method: "POST", json: clip({ requestId: "cccccccc-bbbb-4ccc-8ddd-000000000003", html: "<div>" + "<span></span>".repeat(401) + "</div>" }) }, { cookie: "imredline=ravi-secret" });
  assert.equal(big.status, 400);
  assert.match((await big.json()).error, /400 elements/);
  const script = await call("/imredline/api/clip", { method: "POST", json: clip({ requestId: "cccccccc-bbbb-4ccc-8ddd-000000000004", html: '<div onclick="x()">hi</div>' }) }, { cookie: "imredline=ravi-secret" });
  assert.equal(script.status, 400);
  const anon = await call("/imredline/api/clip", { method: "POST", json: clip({ requestId: "cccccccc-bbbb-4ccc-8ddd-000000000005" }) });
  assert.equal(anon.status, 401);
  const { createReviewer } = await import("../../dist/core/access.js");
  const scoped = await createReviewer({ name: "Scoped2", sites: ["other.test"] }, env);
  const wrong = await call("/imredline/api/clip", { method: "POST", json: clip({ requestId: "cccccccc-bbbb-4ccc-8ddd-000000000006", token: scoped.token }) });
  assert.equal(wrong.status, 403);
  const right = await call("/imredline/api/clip", { method: "POST", json: clip({ requestId: "cccccccc-bbbb-4ccc-8ddd-000000000007", token: scoped.token, source: { url: "https://other.test/x", title: "" } }) });
  assert.equal(right.status, 201);
  gh.state.failCommit = true;
  const down = await call("/imredline/api/clip", { method: "POST", json: clip({ requestId: "cccccccc-bbbb-4ccc-8ddd-000000000008" }) }, { cookie: "imredline=ravi-secret" });
  gh.state.failCommit = false;
  assert.equal(down.status, 502);
});

test("clip: gallery page, list and the file proxy for any reviewer; path-jail; no bookmarklet by default", async () => {
  const page = await call("/imredline/clips");
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('id="imc"'));
  const anon = await call("/imredline/api/clips");
  assert.equal(anon.status, 401);
  const list = await call("/imredline/api/clips", {}, { cookie: "imredline=sri-secret" });
  const data = await list.json();
  assert.equal(list.status, 200);
  assert.equal(data.admin, false);
  assert.equal(data.bookmarklet, false);
  assert.equal(data.token, null);
  assert.equal(data.branch, "imredline-clips");
  assert.equal(data.clips.length, 3);
  assert.equal(data.clips[0].requestId, undefined, "requestId never leaves the server");
  const css = await call("/imredline/api/clip-asset?path=clips/pema-rebuild/hero-section-01/component.css", {}, { cookie: "imredline=sri-secret" });
  assert.equal(css.status, 200);
  assert.equal(css.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.ok((await css.text()).includes(".c1 {"));
  const html = await call("/imredline/api/clip-asset?path=clips/pema-rebuild/hero-section-01/preview.html", {}, { cookie: "imredline=sri-secret" });
  assert.equal(html.headers.get("content-type"), "text/plain; charset=utf-8", "preview is never served as a document");
  const shot = await call("/imredline/api/clip-asset?path=clips/pema-rebuild/hero-section-01/screenshot.jpg", {}, { cookie: "imredline=sri-secret" });
  assert.equal(shot.headers.get("content-type"), "image/jpeg");
  const audit = await call("/imredline/api/clip-asset?path=clips/pema-rebuild/hero-section-01/audit.md", {}, { cookie: "imredline=sri-secret" });
  assert.equal(audit.status, 404, "audit.md passes the jail, just not written yet");
  for (const bad of ["clips/../x/README.md", "clips/pema-rebuild/hero-section-01/evil.js", "shots/x.jpg", "clips/pema-rebuild/hero-section-01/README.md/.."]) {
    const r = await call(`/imredline/api/clip-asset?path=${encodeURIComponent(bad)}`, {}, { cookie: "imredline=sri-secret" });
    assert.equal(r.status, 400, bad);
  }
  const missing = await call("/imredline/api/clip-asset?path=clips/pema-rebuild/hero-section-09/README.md", {}, { cookie: "imredline=sri-secret" });
  assert.equal(missing.status, 404);
});

test("clip: IMREDLINE_CLIP_ORIGINS=* opens session + clip to any origin, never report; the list carries the token for the bookmarklet", async () => {
  const anyEnv = { ...env, IMREDLINE_CLIP_ORIGINS: "*" };
  const anyOpts = { env: anyEnv, fetch: gh.fetch };
  const c2 = (path, init = {}, headers = {}) =>
    handle(new Request(ORIGIN + path, { ...init, headers: { "Content-Type": "application/json", ...headers }, body: init.json !== undefined ? JSON.stringify(init.json) : null }), anyOpts);
  const pre = await c2("/imredline/api/clip", { method: "OPTIONS" }, { origin: "https://anything.example" });
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://anything.example");
  const sess = await c2("/imredline/api/session", { method: "POST", json: { token: "ravi-secret" } }, { origin: "https://anything.example" });
  assert.equal(sess.status, 200);
  assert.equal(sess.headers.get("access-control-allow-origin"), "https://anything.example");
  assert.equal(cookieOf(sess), "");
  const clipped = await c2("/imredline/api/clip", { method: "POST", json: clip({ requestId: "cccccccc-bbbb-4ccc-8ddd-000000000009", token: "ravi-secret", source: { url: "https://anything.example/p", title: "t" } }) }, { origin: "https://anything.example" });
  assert.equal(clipped.status, 201);
  assert.equal(clipped.headers.get("access-control-allow-origin"), "https://anything.example");
  const rep = await c2("/imredline/api/report", { method: "OPTIONS" }, { origin: "https://anything.example" });
  assert.equal(rep.headers.get("access-control-allow-origin"), null, "reports stay on the allow-list");
  const list = await c2("/imredline/api/clips", {}, { cookie: "imredline=ravi-secret" });
  const data = await list.json();
  assert.equal(data.bookmarklet, true);
  assert.equal(data.token, "ravi-secret");
  const separate = await handle(new Request(ORIGIN + "/imredline/api/clips", { headers: { cookie: "imredline=ravi-secret" } }), { env: { ...env, IMREDLINE_CLIPS_REPO: "acme/swipe" }, fetch: gh.fetch });
  assert.equal(separate.status, 200);
  assert.equal((await separate.json()).repo, "acme/swipe");
});

test("inspiration: local meta is checked, both blocks filed, queue carries the reference", async () => {
  const local = fakeGitHub();
  const path = "clips/ideas/hero-01";
  local.state.contents.set(`imredline-clips:${path}/meta.json`, Buffer.from("{}"));
  const run = (body) => handle(new Request(ORIGIN + "/imredline/api/report", { method: "POST", headers: { "Content-Type": "application/json", cookie: "imredline=ravi-secret" }, body: JSON.stringify(body) }), { env, fetch: local.fetch });
  for (const [i, repo] of [undefined, "acme/site"].entries()) {
    const res = await run(report({ requestId: `dddddddd-bbbb-4ccc-8ddd-00000000000${i}`, samples: [], inspiration: { path, repo, url: `${ORIGIN}/imredline/clips?clip=${path}` } }));
    assert.equal(res.status, 201, JSON.stringify(await res.json()));
    assert.ok(local.state.issues.at(-1).body.includes(`- **inspiration:** \`${path}\`\n`));
    assert.ok(local.state.issues.at(-1).body.includes(`📎 inspiration: ${ORIGIN}/imredline/clips?clip=${path}  — folder: https://github.com/acme/site/tree/imredline-clips/${path}`));
    assert.ok(local.state.issues.at(-1).body.includes("📷"));
  }
  assert.ok(local.state.calls.includes(`GET /contents/${path}/meta.json?ref=imredline-clips`));
  const q = await handle(new Request(ORIGIN + "/imredline/api/queue", { headers: { cookie: "imredline=ravi-secret" } }), { env, fetch: local.fetch });
  assert.deepEqual((await q.json()).rows[0].inspiration, { path, repo: "acme/site", url: `${ORIGIN}/imredline/clips?clip=${path}`, folder: `https://github.com/acme/site/tree/imredline-clips/${path}` });
  const missing = await run(report({ inspiration: { path: "clips/ideas/missing" } }));
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "That clip does not exist here");
  assert.equal(local.state.issues.length, 2);
});

test("inspiration: foreign repo files unverified, including cross-origin reports", async () => {
  const local = fakeGitHub();
  const inspiration = { path: "clips/ideas/foreign-01", repo: "other/site", url: "https://other.example/imredline/clips?clip=clips/ideas/foreign-01" };
  const res = await handle(new Request(ORIGIN + "/imredline/api/report", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://old.example" }, body: JSON.stringify(report({ token: "ravi-secret", page: "old.example/rooms", inspiration, samples: [] })) }), { env, fetch: local.fetch });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://old.example");
  assert.ok(local.state.issues[0].body.includes("`clips/ideas/foreign-01` (other/site)"));
  assert.ok(!local.state.calls.some((c) => c.includes("meta.json") || c.includes("other/site")));
});

test("inspiration: the configured clips repo is checked and recorded, GitHub outage is best-effort", async () => {
  const reports = fakeGitHub();
  const clips = fakeGitHub({ repo: "acme/swipe" });
  const path = "clips/ideas/hero-01";
  clips.state.contents.set(`imredline-clips:${path}/meta.json`, Buffer.from("{}"));
  const fetch = (url, init) => new URL(url).pathname.startsWith("/repos/acme/swipe/") ? clips.fetch(url, init) : reports.fetch(url, init);
  const req = () => new Request(ORIGIN + "/imredline/api/report", { method: "POST", headers: { "Content-Type": "application/json", cookie: "imredline=ravi-secret" }, body: JSON.stringify(report({ inspiration: { path }, samples: [] })) });
  const res = await handle(req(), { env: { ...env, IMREDLINE_CLIPS_REPO: "acme/swipe" }, fetch });
  assert.equal(res.status, 201);
  assert.ok(clips.state.calls.includes(`GET /contents/${path}/meta.json?ref=imredline-clips`));
  assert.ok(reports.state.issues[0].body.includes("`clips/ideas/hero-01` (acme/swipe)"));
  const outage = fakeGitHub();
  const bestEffort = await handle(req(), { env, fetch: (url, init) => url.includes("meta.json") ? Promise.resolve(new Response("unavailable", { status: 503 })) : outage.fetch(url, init) });
  assert.equal(bestEffort.status, 201);
});

/* ── Discard (0.6.0) ── */
function housekeeping(over = {}) {
  const gh = fakeGitHub({ repo: over.IMREDLINE_CLIPS_REPO || env.IMREDLINE_GITHUB_REPO });
  const run = (path, method, body, token = "admin-secret-token", fetch = gh.fetch) => handle(new Request(ORIGIN + "/imredline/api" + path, {
    method, headers: { "Content-Type": "application/json", cookie: `imredline=${token}` }, body: body === undefined ? null : JSON.stringify(body),
  }), { env: { ...env, ...over }, fetch });
  return { gh, run };
}
const botLabels = ["triaged:bug", "triaged:change", "plan-approved", "pr-open", "merged", "deployed", "implement-failed"];
function seedReport(gh) {
  const issue = { number: 12, html_url: "https://github.com/acme/site/issues/12", title: "[bug] / — note", body: "original body", state: "open", created_at: "", labels: ["tester-feedback", ...botLabels].map((name) => ({ name })) };
  gh.state.issues.push(issue);
  return issue;
}

for (const why of [undefined, "Duplicate of #3", "x".repeat(300)]) {
  test(`discard report: one comment ${why ? "with why" : "without why"}, close not planned, create and add label`, async () => {
    const { gh, run } = housekeeping();
    const issue = seedReport(gh);
    const res = await run("/report/12", "PATCH", { status: "discarded", why });
    assert.deepEqual(await res.json(), { ok: true, status: "discarded" });
    assert.equal(issue.state, "closed");
    assert.equal(issue.state_reason, "not_planned");
    assert.deepEqual(issue.comments, [`Discarded from the queue by rishi${why ? ": " + why : "."}`]);
    assert.equal(issue.body, "original body");
    assert.deepEqual(issue.labels.map((l) => l.name), ["tester-feedback", ...botLabels, "discarded"]);
    const calls = gh.state.requests;
    assert.ok(calls.findIndex((r) => r.path.endsWith("/comments")) < calls.findIndex((r) => r.method === "PATCH"));
    assert.deepEqual(calls.find((r) => r.method === "PATCH").body, { state: "closed", state_reason: "not_planned" });
    assert.deepEqual(calls.find((r) => r.path === "/labels").body, { name: "discarded", color: "9e9e9e", description: "Discarded from the review queue" });
    const q = await run("/queue", "GET");
    assert.equal((await q.json()).rows[0].status, "discarded");
  });
}

test("discard report: reviewer refused and invalid why rejected before any GitHub write", async () => {
  const { gh, run } = housekeeping();
  seedReport(gh);
  assert.equal((await run("/report/12", "PATCH", { status: "discarded" }, "ravi-secret")).status, 401);
  for (const why of ["x".repeat(301), 123, null]) assert.equal((await run("/report/12", "PATCH", { status: "discarded", why })).status, 400);
  assert.equal(gh.state.calls.length, 0);
});

for (const mode of ["response", "network"]) {
  test(`discard report: label ${mode} failure still reports discarded with warning`, async () => {
    const { gh, run } = housekeeping();
    const issue = seedReport(gh);
    const fetch = (url, init) => {
      if (url.endsWith("/issues/12/labels")) {
        if (mode === "network") throw new Error("offline");
        return new Response("no", { status: 500 });
      }
      return gh.fetch(url, init);
    };
    const res = await run("/report/12", "PATCH", { status: "discarded" }, "admin-secret-token", fetch);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, status: "discarded", warning: "label not applied" });
    assert.equal(issue.state_reason, "not_planned");
  });
}

test("discard report: comment failure prevents close; close failure does not add label", async () => {
  for (const failed of ["comments", "close"]) {
    const { gh, run } = housekeeping();
    const issue = seedReport(gh);
    const fetch = (url, init) => (failed === "comments" ? url.endsWith("/comments") : init.method === "PATCH") ? new Response("no", { status: 503 }) : gh.fetch(url, init);
    assert.equal((await run("/report/12", "PATCH", { status: "discarded" }, "admin-secret-token", fetch)).status, 502);
    assert.equal(issue.state, "open");
    assert.equal(issue.labels.some((l) => l.name === "discarded"), false);
  }
});

test("restore report: reopen, remove only discarded, tolerate an absent label", async () => {
  const { gh, run } = housekeeping();
  const issue = seedReport(gh);
  issue.state = "closed";
  issue.state_reason = "not_planned";
  issue.labels.push({ name: "discarded" }, { name: "wontfix" });
  for (let i = 0; i < 2; i++) {
    const res = await run("/report/12", "PATCH", { status: "open" });
    assert.deepEqual(await res.json(), { ok: true, status: "open" });
  }
  assert.equal(issue.state, "open");
  assert.deepEqual(issue.labels.map((l) => l.name), ["tester-feedback", ...botLabels, "wontfix"]);
  assert.ok(gh.state.calls.includes("DELETE /issues/12/labels/discarded"));
  assert.equal(issue.comments, undefined);
});

async function seedClips(gh, repo = "acme/site") {
  const { GitHub } = await import("../../dist/core/github.js");
  const path = "clips/ideas/hero-01";
  const keep = { path: "clips/ideas/keep-01", requestId: "keep-me", extra: true };
  const index = [{ path, audited: "today" }, keep];
  const files = ["README.md", "component.html", "component.css", "tokens.json", "meta.json", "preview.html", "screenshot.jpg", "audit.md", "extra.txt"];
  await new GitHub(env, gh.fetch, repo).commitFiles("imredline-clips", "seed", [
    { path: "clips/index.json", content: JSON.stringify(index) },
    { path: `${keep.path}/meta.json`, content: "keep" },
    ...files.map((f) => ({ path: `${path}/${f}`, content: "clip file" })),
  ]);
  return { path, keep, files };
}

test("discard clip: reviewer/anonymous 401, bad path 400, absent index or entry 404", async () => {
  const { gh, run } = housekeeping();
  for (const token of ["ravi-secret", ""]) assert.equal((await run("/clip?path=clips/ideas/hero-01", "DELETE", undefined, token)).status, 401);
  for (const path of ["../secrets", "clips/ideas/hero-01/meta.json", "clips/../hero", "clips/ideas/" + "x".repeat(49), "clips/" + "x".repeat(41) + "/hero", "clips/ideas/hero-01/"]) {
    assert.equal((await run(`/clip?path=${encodeURIComponent(path)}`, "DELETE")).status, 400, path);
  }
  assert.equal(gh.state.calls.length, 0);
  for (const seeded of [false, true]) {
    if (seeded) await seedClips(gh);
    const res = await run("/clip?path=clips/ideas/missing", "DELETE");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "That clip does not exist here." });
  }
});

for (const repo of ["acme/site", "acme/swipe"]) {
  test(`discard clip: one commit removes every actual file and index entry on ${repo}`, async () => {
    const { gh, run } = housekeeping({ IMREDLINE_CLIPS_REPO: repo });
    const { path, keep, files } = await seedClips(gh, repo);
    const before = gh.state.requests.length;
    const res = await run(`/clip?path=${path}`, "DELETE");
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.deepEqual(out, { ok: true, commit: gh.state.commits.at(-1).sha, path });
    assert.equal(gh.state.commits.length, 2);
    assert.equal(gh.state.commits.at(-1).message, "discard ideas/hero-01 (by rishi)");
    const tree = gh.state.requests.slice(before).find((r) => r.path === "/git/trees").body.tree;
    assert.deepEqual(tree.filter((e) => e.sha === null).map((e) => e.path).sort(), files.map((f) => `${path}/${f}`).sort());
    for (const f of files) assert.equal(gh.state.contents.has(`imredline-clips:${path}/${f}`), false, f);
    assert.deepEqual(JSON.parse(gh.state.contents.get("imredline-clips:clips/index.json")), [keep]);
    assert.equal(gh.state.contents.get(`imredline-clips:${keep.path}/meta.json`).toString(), "keep");
  });
}

test("discard clip: failed commit leaves folder and index unchanged, returns 502", async () => {
  const { gh, run } = housekeeping();
  const { path } = await seedClips(gh);
  const before = new Map(gh.state.contents);
  gh.state.failCommit = true;
  const res = await run(`/clip?path=${path}`, "DELETE");
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "GitHub refused the change — the clip is still there.");
  assert.deepEqual(gh.state.contents, before);
  assert.equal(gh.state.commits.length, 1);
});

test("discard report: an existing label needs no create, and the resolved admin is named", async () => {
  const gh = fakeGitHub();
  const issue = seedReport(gh);
  gh.state.labels.add("discarded");
  const res = await handle(new Request(ORIGIN + "/imredline/api/report/12", {
    method: "PATCH", headers: { cookie: "imredline=team-token", "Content-Type": "application/json" }, body: JSON.stringify({ status: "discarded", why: "  Duplicate  " }),
  }), { env, fetch: gh.fetch, resolveToken: async () => ({ name: "Housekeeping Team", admin: true }) });
  assert.equal(res.status, 200);
  assert.deepEqual(issue.comments, ["Discarded from the queue by Housekeeping Team: Duplicate"]);
  assert.equal(gh.state.calls.filter((c) => c === "POST /issues/12/labels").length, 1);
  assert.equal(gh.state.calls.includes("POST /labels"), false);
});

test("restore report: failed label removal warns, but open state is the truth", async () => {
  const { gh, run } = housekeeping();
  const issue = seedReport(gh);
  issue.state = "closed";
  issue.labels.push({ name: "discarded" });
  const fetch = (url, init) => init.method === "DELETE" ? new Response("no", { status: 503 }) : gh.fetch(url, init);
  const res = await run("/report/12", "PATCH", { status: "open" }, "admin-secret-token", fetch);
  assert.deepEqual(await res.json(), { ok: true, status: "open", warning: "label not removed" });
  const q = await run("/queue", "GET");
  assert.equal((await q.json()).rows[0].status, "open");
});

test("discard clip: unreadable index or folder makes no write", async () => {
  for (const [target, status, body] of [
    ["index", 503, "unavailable"], ["index", 200, "{"], ["index", 200, "{}"], ["index", 200, "[null]"],
    ["folder", 503, "unavailable"], ["folder", 200, JSON.stringify([{ type: "dir", path: "clips/ideas/hero-01/nested" }])],
    ["folder", 200, JSON.stringify([{ type: "file", path: "clips/ideas/keep-01/meta.json" }])],
  ]) {
    const { gh, run } = housekeeping();
    const { path } = await seedClips(gh);
    const before = gh.state.requests.length;
    const fetch = (url, init) => url.includes(target === "index" ? "/contents/clips/index.json?" : `/contents/${path}?`) ? new Response(body, { status }) : gh.fetch(url, init);
    const res = await run(`/clip?path=${path}`, "DELETE", undefined, "admin-secret-token", fetch);
    assert.equal(res.status, 502, `${target}: ${body}`);
    assert.equal(gh.state.commits.length, 1);
    assert.ok(gh.state.requests.slice(before).every((r) => r.method === "GET"));
  }
});

test("discard clip: refused final ref move leaves every file and the index in place", async () => {
  const { gh, run } = housekeeping();
  const { path } = await seedClips(gh);
  const before = new Map(gh.state.contents);
  const fetch = (url, init) => url.includes("/git/refs/heads/") && init.method === "PATCH" ? new Response("conflict", { status: 422 }) : gh.fetch(url, init);
  const res = await run(`/clip?path=${path}`, "DELETE", undefined, "admin-secret-token", fetch);
  assert.equal(res.status, 502);
  assert.deepEqual(gh.state.contents, before);
  assert.equal(gh.state.commits.length, 1);
});

test("queue: three statuses sort open, done, discarded", async () => {
  const { gh, run } = housekeeping();
  const issue = seedReport(gh);
  gh.state.issues.push({ ...issue, number: 13, state: "closed", state_reason: "not_planned" }, { ...issue, number: 14, state: "closed" });
  const res = await run("/queue", "GET");
  assert.deepEqual((await res.json()).rows.map((r) => r.status), ["open", "done", "discarded"]);
});
