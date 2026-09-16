import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReport, imageData, parseSamples, Reject } from "../../dist/core/validate.js";
import { PNG_1x1 } from "../helpers/fake-github.mjs";

const good = {
  requestId: "11111111-2222-4333-8444-555555555555",
  type: "bug",
  note: "The booking form does nothing when I press send.",
  page: "/book",
  selector: "form#book > button",
  viewport: { width: 1440, height: 900, dpr: 2 },
  device: { kind: "desktop", orientation: "landscape", touch: false },
};

const rejects = (body, re) => assert.throws(() => parseReport(body), (e) => e instanceof Reject && re.test(e.message), String(re));

test("a good report passes and is normalised", () => {
  const r = parseReport({ ...good, note: "  " + good.note + "\u0007 ", extra: "ignored" });
  assert.equal(r.note, good.note);
  assert.equal(r.page, "/book");
  assert.deepEqual(r.device, good.device);
  assert.deepEqual(r.viewport, good.viewport);
  assert.deepEqual(r.samples, []);
});

test("honeypot, bad type, short note, bad id all reject", () => {
  rejects({ ...good, website: "http://spam" }, /not accepted/);
  rejects({ ...good, type: "fix" }, /Unknown report type/);
  rejects({ ...good, note: "short" }, /8–4000/);
  rejects({ ...good, requestId: "nope" }, /Reload/);
  rejects({ ...good, note: "x".repeat(4001) }, /under 4000/);
});

test("a corrected device flag survives; an unknown kind is dropped", () => {
  assert.equal(parseReport({ ...good, device: { kind: "phone", orientation: "portrait", touch: true, corrected: 1 } }).device.corrected, true);
  assert.equal(parseReport({ ...good, device: { kind: "watch" } }).device, undefined);
});

test("imageData accepts a real PNG and refuses a fake one", () => {
  const ok = imageData(PNG_1x1);
  assert.equal(ok.ext, "png");
  assert.equal(ok.width, 1);
  assert.equal(imageData("data:image/png;base64,aGVsbG8="), null);
  assert.equal(imageData("data:image/gif;base64,R0lGOD"), null);
});

test("samples: links validated, paths validated, images verified, limits enforced", () => {
  const out = parseSamples([
    { kind: "link", value: "https://example.com/a" },
    { kind: "path", value: "C:\\Users\\me\\a.png" },
    { kind: "image", name: "a.png", data: PNG_1x1 },
  ]);
  assert.equal(out.length, 3);
  assert.throws(() => parseSamples([{ kind: "link", value: "https://user:pw@example.com" }]), /without a password/);
  assert.throws(() => parseSamples([{ kind: "link", value: "ftp://x" }]), /http or https/);
  assert.throws(() => parseSamples([{ kind: "path", value: "not a path" }]), /file path such as/);
  assert.throws(() => parseSamples(Array(6).fill({ kind: "link", value: "https://x.y" })), /Up to 5/);
  assert.throws(() => parseSamples(Array(4).fill({ kind: "image", name: "a", data: PNG_1x1 })), /Up to 3/);
  assert.throws(() => parseSamples([{ kind: "image", name: "a", data: "data:image/png;base64,AAAA" }]), /could not be read/);
});

test("inspiration: good paths pass; malformed and overlong paths have a 400 cause", () => {
  for (const path of ["clips/ideas/hero-01", `clips/${"a".repeat(40)}/${"b".repeat(50)}`]) {
    assert.deepEqual(parseReport({ ...good, inspiration: { path } }).inspiration, { path });
  }
  for (const path of ["", "clips/../hero", "clips/Ideas/hero", "clips/-ideas/hero", "clips/ideas/-hero", "clips/ideas/hero/meta.json", `clips/${"a".repeat(41)}/hero`, `clips/ideas/${"b".repeat(51)}`]) {
    assert.throws(() => parseReport({ ...good, inspiration: { path } }), (e) => e instanceof Reject && e.status === 400 && /clip path/.test(e.message));
  }
});

test("inspiration: foreign repo shape, URL scheme and length are enforced", () => {
  const inspiration = { path: "clips/ideas/hero-01", repo: "other.owner/clip_repo", url: "https://other.example/clips?clip=clips/ideas/hero-01" };
  assert.deepEqual(parseReport({ ...good, inspiration }).inspiration, inspiration);
  for (const repo of ["one", "a/b/c", "https://a/b", "a/b\n", 42]) rejects({ ...good, inspiration: { ...inspiration, repo } }, /owner\/repo/);
  for (const url of ["javascript:alert(1)", "ftp://example.com", "not a URL", "https://example.com/\ninjected", "https://example.com/" + "a".repeat(500)]) rejects({ ...good, inspiration: { ...inspiration, url } }, /http or https/);
});
