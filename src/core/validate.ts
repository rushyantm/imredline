/*
  Server-side re-validation of everything the widget sends. The widget is
  polite; the network is not. Every string is capped and stripped of control
  characters before it can reach an issue body (NN + Aradea rules).
*/

import {
  DEVICE_KINDS,
  IMAGE_MAX,
  NOTE_MAX,
  NOTE_MIN,
  REPORT_TYPES,
  SAMPLE_IMAGE_LIMIT,
  SAMPLE_LIMIT,
  type Device,
  type ReportInput,
  type ReportType,
  type Sample,
  type Viewport,
} from "./types.js";

export class Reject extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const fail = (m: string, s = 400): never => {
  throw new Reject(m, s);
};

/** Control and format characters stripped (newline and tab kept), trimmed, capped. */
export const clean = (raw: unknown, max: number): string =>
  String(raw ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" || c === "\t" ? c : ""))
    .trim()
    .slice(0, max);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reviewer names appear in asset filenames. A space broke NN's path-jail
 *  forever ("Asha Rao" uploaded fine, then 400'd on every read). */
export function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "reviewer";
}

/** Decode a data URL and check it really is a PNG or JPEG with sane
 *  dimensions (Aradea's magic-byte check). */
export function imageData(
  value: unknown,
): { b64: string; ext: "png" | "jpg"; bytes: number; width: number; height: number } | null {
  if (typeof value !== "string" || value.length > IMAGE_MAX) return null;
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!m) return null;
  const bytes = Buffer.from(m[2]!, "base64");
  let width = 0;
  let height = 0;
  if (m[1] === "png") {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
    if (bytes.subarray(12, 16).toString() !== "IHDR") return null;
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else {
    if (bytes[0] !== 255 || bytes[1] !== 216) return null;
    for (let i = 2; i + 8 < bytes.length; ) {
      if (bytes[i++] !== 255) break;
      while (bytes[i] === 255) i++;
      const mk = bytes[i++]!;
      if (mk === 218 || mk === 217) break;
      if (mk === 1 || (mk >= 208 && mk <= 215)) continue;
      const len = bytes.readUInt16BE(i);
      if (len < 2 || i + len > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(mk) && len >= 8) {
        height = bytes.readUInt16BE(i + 3);
        width = bytes.readUInt16BE(i + 5);
        break;
      }
      i += len;
    }
  }
  if (!width || !height || width > 12000 || height > 12000 || width * height > 12_000_000) return null;
  return { b64: m[2]!, ext: m[1] === "png" ? "png" : "jpg", bytes: bytes.length, width, height };
}

export function parseSamples(raw: unknown): Sample[] {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > SAMPLE_LIMIT) fail(`Up to ${SAMPLE_LIMIT} samples per report.`);
  const list = raw as unknown[];
  let images = 0;
  return list.map((s): Sample => {
    if (!s || typeof s !== "object") fail("A sample could not be read. Remove it and try again.");
    const o = s as Record<string, unknown>;
    if (o.kind === "image") {
      if (++images > SAMPLE_IMAGE_LIMIT) fail(`Up to ${SAMPLE_IMAGE_LIMIT} sample images per report.`);
      const name = clean(o.name, 160).replace(/\n|\t/g, " ") || "Sample image";
      if (!imageData(o.data)) fail("A sample image could not be read or is too large. Remove it and add a PNG or JPG again.");
      return { kind: "image", name, data: o.data as string };
    }
    const value = clean(o.value, 2048).replace(/\n|\t/g, "");
    if (!value) fail("Add a valid sample link or file path.");
    if (o.kind === "link") {
      let u: URL;
      try {
        u = new URL(value);
      } catch {
        return fail("Use a full sample link starting with https:// or http://.");
      }
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) {
        fail("Use an http or https link without a password.");
      }
      return { kind: "link", value };
    }
    if (o.kind === "path") {
      if (!/^(?:\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/]|\\\\|file:\/\/\/)/.test(value)) {
        fail("Use a file path such as /Users/you/Pictures/sample.png.");
      }
      return { kind: "path", value };
    }
    return fail("Unknown sample kind.");
  });
}

export function parseDevice(raw: unknown): Device | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  const kind = String(d.kind || "");
  if (!(DEVICE_KINDS as readonly string[]).includes(kind)) return undefined;
  const out: Device = {
    kind: kind as Device["kind"],
    orientation: d.orientation === "landscape" ? "landscape" : "portrait",
    touch: Boolean(d.touch),
  };
  if (d.corrected) out.corrected = true;
  return out;
}

export function parseViewport(raw: unknown): Viewport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  const n = (k: string, max: number) => {
    const x = v[k];
    return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : null;
  };
  const width = n("width", 100_000);
  const height = n("height", 100_000);
  const dpr = n("dpr", 16);
  if (width == null || height == null) return undefined;
  return { width: Math.round(width), height: Math.round(height), dpr: dpr ?? 1 };
}

export const viewportText = (v: Viewport | undefined): string | null =>
  v ? `${v.width}x${v.height}${v.dpr && v.dpr !== 1 ? ` @${Math.round(v.dpr * 100) / 100}x` : ""}` : null;

/** Whole body. Throws Reject with a message the widget can show verbatim. */
export function parseReport(body: unknown): ReportInput {
  if (!body || typeof body !== "object") fail("Invalid submission.");
  const b = body as Record<string, unknown>;
  if (b.website) fail("Request not accepted.");
  const type = String(b.type || "");
  if (!(REPORT_TYPES as readonly string[]).includes(type)) fail("Unknown report type.");
  const note = clean(b.note, NOTE_MAX + 1);
  if (note.length < NOTE_MIN) fail(`Add specific feedback (${NOTE_MIN}–${NOTE_MAX} characters).`);
  if (note.length > NOTE_MAX) fail(`Keep the note under ${NOTE_MAX} characters.`);
  const requestId = String(b.requestId || "");
  if (!UUID.test(requestId)) fail("Reload the review tool and try again.");
  const page = clean(b.page, 300).replace(/[<>`\s]/g, "") || "/";
  const out: ReportInput = { requestId: requestId.toLowerCase(), type: type as ReportType, note, page };
  const selector = clean(b.selector, 500).replace(/[`\n]/g, "");
  if (selector) out.selector = selector;
  const viewport = parseViewport(b.viewport);
  if (viewport) out.viewport = viewport;
  const device = parseDevice(b.device);
  if (device) out.device = device;
  if (typeof b.screenshot === "string" && b.screenshot) out.screenshot = b.screenshot;
  const shotError = clean(b.shotError, 200).replace(/\n/g, " ");
  if (shotError) out.shotError = shotError;
  const shotNote = clean(b.shotNote, 300).replace(/\n/g, " ");
  if (shotNote) out.shotNote = shotNote;
  out.samples = parseSamples(b.samples);
  if (typeof b.token === "string" && b.token) out.token = b.token.trim().slice(0, 200);
  return out;
}
