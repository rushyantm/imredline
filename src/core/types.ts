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
