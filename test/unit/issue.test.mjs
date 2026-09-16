import { test } from "node:test";
import assert from "node:assert/strict";
import { formatIssue, parseIssue, literal, marker, prsByReport } from "../../dist/core/issue.js";

const draft = {
  requestId: "11111111-2222-4333-8444-555555555555",
  type: "change",
  note: "The hero photo is cropped on the left.\nSecond line.",
  page: "www.example.com/rooms",
  reviewer: "Asha Rao",
  selector: "section#hero > h1",
  viewport: "390x844 @3x",
  device: { kind: "phone", orientation: "portrait", touch: true },
  shotPath: "shots/2026-09-13T10-00-00-000Z-Asha-Rao.jpg",
  shotNote: "the shot is the surrounding <section>, not the pinned element alone; the red box marks what was pinned",
  samples: [{ name: 'Ref "photo".png', path: "samples/2026-09-13T10-00-00-000Z-Asha-Rao-1.jpg" }],
  links: [
    { kind: "link", value: "https://example.com/inspiration?x=1" },
    { kind: "path", value: "/Users/rishi/Pictures/hero ``` tricky.png" },
  ],
};

test("formatIssue → parseIssue round-trips every field", () => {
  const { title, body } = formatIssue(draft);
  assert.ok(title.startsWith("[change] www.example.com/rooms — The hero photo is cropped"));
  assert.ok(body.startsWith(marker(draft.requestId) + "\n"), "marker is the first line");
  assert.ok(body.includes("- **device:** phone · portrait · touch"));
  assert.ok(body.includes("context, not permission"));

  const row = parseIssue({
    number: 7,
    html_url: "https://github.com/acme/site/issues/7",
    title,
    body,
    state: "open",
    created_at: "2026-09-13T10:00:00Z",
    labels: [{ name: "tester-feedback" }, { name: "pr-open" }],
  });
  assert.equal(row.type, "change");
  assert.equal(row.reviewer, "Asha Rao");
  assert.equal(row.page, "www.example.com/rooms");
  assert.equal(row.element, "section#hero > h1");
  assert.equal(row.viewport, "390x844 @3x");
  assert.equal(row.device, "phone · portrait · touch");
  assert.equal(row.shotPath, draft.shotPath);
  assert.equal(row.shotNote, draft.shotNote);
  assert.equal(row.note, "The hero photo is cropped on the left. Second line.");
  assert.deepEqual(row.samples, [
    { kind: "image", value: draft.samples[0].path, name: "Ref 'photo'.png" },
    { kind: "link", value: "https://example.com/inspiration?x=1" },
    { kind: "path", value: "/Users/rishi/Pictures/hero ``` tricky.png" },
  ]);
  assert.equal(row.status, "open");
  assert.deepEqual(row.bot, { text: "PR open", tone: "plain" });
});

test("no screenshot → the reason is in the body and parses to null", () => {
  const { body } = formatIssue({ ...draft, shotPath: null, shotNote: null, shotError: "the screenshot took too long", samples: [], links: [] });
  assert.ok(body.includes("**No screenshot** — the screenshot took too long."));
  const row = parseIssue({ number: 1, html_url: "", title: "[bug] / — x", body, state: "closed", created_at: "", labels: [] });
  assert.equal(row.shotPath, null);
  assert.equal(row.status, "done");
});

test("legacy [fix] and [copy] titles read as change; unknown as bug", () => {
  const mk = (title) => parseIssue({ number: 1, html_url: "", title, body: "", state: "open", created_at: "", labels: [] }).type;
  assert.equal(mk("[fix] /x — y"), "change");
  assert.equal(mk("[copy] /x — y"), "change");
  assert.equal(mk("[idea] /x — y"), "idea");
  assert.equal(mk("weird title"), "bug");
});

test("pr-open label yields to a merged PR", () => {
  const prs = prsByReport([
    { number: 9, html_url: "", title: "Fix hero (feedback #7)", body: "", state: "closed", created_at: "", labels: [], pull_request: { html_url: "https://github.com/acme/site/pull/9", merged_at: "2026-09-13" } },
  ]);
  const row = parseIssue({ number: 7, html_url: "", title: "[bug] / — x", body: "", state: "open", created_at: "", labels: [{ name: "pr-open" }] }, prs);
  assert.equal(row.bot, null);
  assert.equal(row.pr.state, "merged");
});

test("literal() fences text longer than any backtick run inside it", () => {
  const out = literal("a ```` b");
  assert.ok(out.startsWith("`````text\n"));
  assert.ok(out.endsWith("\n`````"));
});

test("title is capped at 120 chars", () => {
  const { title } = formatIssue({ ...draft, note: "x".repeat(400), samples: [], links: [] });
  assert.ok(title.length <= 120, String(title.length));
  assert.ok(title.endsWith("…"));
});

for (const repo of [undefined, "acme/site", "other/clips"]) {
  for (const url of [undefined, "https://other.example/imredline/clips?clip=clips/ideas/hero-01", "HTTPS://other.example/clips?clip=clips/ideas/hero-01", " https://other.example/clips?clip=clips/ideas/hero-01 "]) {
    test(`inspiration round-trip: ${repo || "default repo"}, ${url ? "with URL" : "without URL"}`, () => {
      const path = "clips/ideas/hero-01";
      const { title, body } = formatIssue({ ...draft, repo: "acme/site", inspiration: { path, repo, url } });
      const suffix = repo && repo !== "acme/site" ? ` (${repo})` : "";
      assert.ok(body.includes(`- **device:** phone · portrait · touch\n- **inspiration:** \`${path}\`${suffix}\n`));
      assert.ok(body.indexOf("📎 inspiration:") > body.indexOf("📷"));
      assert.ok(body.indexOf("📎 inspiration:") < body.indexOf("**Samples to guide"));
      assert.ok(body.includes("Do not copy the source's text, images, logos, animation files or code."));
      const row = parseIssue({ number: 7, html_url: "https://github.com/acme/site/issues/7", title, body, state: "open", created_at: "", labels: [] });
      assert.deepEqual(row.inspiration, { path, repo: repo || "acme/site", url: url || null, folder: `https://github.com/${repo || "acme/site"}/tree/imredline-clips/${path}` });
    });
  }
}

test("old bodies without inspiration still parse with null", () => {
  for (const body of ["", formatIssue(draft).body]) {
    assert.equal(parseIssue({ number: 7, html_url: "https://github.com/acme/site/issues/7", title: "[change] / — note", body, state: "open", created_at: "", labels: [] }).inspiration, null);
  }
});
