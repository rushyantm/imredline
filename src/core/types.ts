/*
  Shapes shared by the widget, the server and the queue. Nothing here touches
  the DOM or Node — it is the contract between the three.
*/

/** Three, by owner ruling (2026-09-13): the type's only real reader is a human
 *  scanning the queue, and three = the three things you do next. Old `fix`
 *  and `copy` titles on existing issues are read as `change`. */
export const REPORT_TYPES = ["bug", "change", "idea"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const DEFAULT_TYPE: ReportType = "change";

/** Two, by owner ruling. Open = issue open, done = issue closed. Progress is
 *  the bot's own labels, never a hand-set middle state. */
export const STATUSES = ["open", "done"] as const;
export type Status = (typeof STATUSES)[number];

/** The label the auto-fix loop watches. The widget applies this one and
 *  nothing else; every other label belongs to the bot. */
export const REVIEW_LABEL = "tester-feedback";
/** Orphan branch for screenshots and sample images. A report never touches
 *  main and never triggers a redeploy. */
export const ASSETS_BRANCH = "imredline-assets";

export const DEVICE_KINDS = ["phone", "tablet", "desktop"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** Owner ask (2026-09-13): every report says which kind of screen it came
 *  from, so the fixer knows whether to look at the mobile or desktop layout.
 *  Classified automatically in the widget; one tap flips it if wrong. */
export type Device = {
  kind: DeviceKind;
  orientation: "portrait" | "landscape";
  touch: boolean;
  /** Set when the reviewer overrode the automatic guess. */
  corrected?: boolean;
};

export type Viewport = { width: number; height: number; dpr: number };

export type SampleImage = { kind: "image"; name: string; data: string };
export type SampleLink = { kind: "link"; value: string };
export type SamplePath = { kind: "path"; value: string };
/** "Samples" — Codex's addition on Aradea. Up to 5 per report, 3 of them
 *  images. Links are never fetched; paths are never read. */
export type Sample = SampleImage | SampleLink | SamplePath;

export const SAMPLE_LIMIT = 5;
export const SAMPLE_IMAGE_LIMIT = 3;
export const NOTE_MIN = 8;
export const NOTE_MAX = 4000;
/** Data-URL length ceiling for one image (~1.1 MB of JPEG). */
export const IMAGE_MAX = 1_500_000;

/** What the widget POSTs. */
export type ReportInput = {
  requestId: string;
  type: ReportType;
  note: string;
  /** `host/path` in third-party mode, `/path` when same-origin. */
  page: string;
  selector?: string;
  viewport?: Viewport;
  device?: Device;
  screenshot?: string;
  shotError?: string;
  shotNote?: string;
  samples?: Sample[];
  /** Third-party mode only — a cookie cannot cross origins. */
  token?: string;
  /** Honeypot. Anything here = a bot. */
  website?: string;
};

export type Access = {
  name: string;
  admin: boolean;
  /** Hostnames this link may report on. Empty = every site this host serves. */
  sites: string[];
};

/** One row of the queue, parsed back out of an issue. */
export type QueueRow = {
  number: number;
  url: string;
  type: ReportType;
  note: string;
  reviewer: string;
  page: string;
  element: string | null;
  viewport: string | null;
  device: string | null;
  shotPath: string | null;
  shotNote: string | null;
  samples: { kind: "image" | "link" | "path"; value: string; name?: string }[];
  createdAt: string;
  status: Status;
  bot: { text: string; tone: "bad" | "warn" | "good" | "plain" } | null;
  pr: { number: number; url: string; state: "open" | "merged" | "closed" } | null;
};

/* ── Clip: component capture for inspiration (0.5.0) ──
   A clip is not a report. It files no issue; it lands as a folder on the
   clips branch that a person or a coding agent rebuilds from. */

/** Orphan branch for clips. Same repo as reports unless IMREDLINE_CLIPS_REPO. */
export const CLIPS_BRANCH = "imredline-clips";
export const CLIP_HTML_MAX = 200_000;
export const CLIP_CSS_MAX = 200_000;
export const CLIP_ELEMENTS_MAX = 400;
export const CLIP_NOTE_MAX = 1000;

export type ClipToken = { value: string; count: number };
export type ClipTokens = {
  colors: (ClipToken & { hsl?: string; contrast?: number })[];
  fonts: ClipToken[];
  /** "size/line-height" in px, e.g. "56/1.05". */
  typeScale: ClipToken[];
  spacing: number[];
  radii: number[];
  shadows: ClipToken[];
  breakpoints: string[];
};

export type ClipAsset =
  | { kind: "image"; url: string; alt: string; rendered: [number, number]; natural: [number, number] }
  | { kind: "background"; url: string }
  | { kind: "font"; family: string; urls: string[] };

/** What the widget POSTs to /api/clip. */
export type ClipInput = {
  requestId: string;
  name: string;
  collection: string;
  note: string;
  source: { url: string; title: string };
  selector: string;
  bounds: { width: number; height: number };
  viewport?: Viewport;
  device?: Device;
  html: string;
  css: string;
  tokens: ClipTokens;
  assets: ClipAsset[];
  /** "full" when every stylesheet was readable, "partial" otherwise. */
  states: "full" | "partial";
  unreadable: string[];
  counts: { elements: number; images: number; fonts: number; stateRules: number; keyframes: number };
  screenshot?: string;
  shotError?: string;
  token?: string;
  website?: string;
};

/** One row of clips/index.json. */
export type ClipIndexEntry = {
  collection: string;
  slug: string;
  name: string;
  note: string;
  reviewer: string;
  source: { host: string; url: string; title: string };
  clippedAt: string;
  device: string | null;
  viewport: string | null;
  bounds: [number, number];
  states: "full" | "partial";
  counts: ClipInput["counts"];
  colors: string[];
  fonts: string[];
  screenshot: string | null;
  path: string;
};
