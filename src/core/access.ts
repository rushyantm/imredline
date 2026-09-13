/*
  Who may use review mode, and how that survives a browser restart.

  Three token sources, checked in order (NN's model, plus Aradea's expiry and
  site scope on minted links):

    IMREDLINE_ADMIN_TOKEN   the owner. One link arms the widget AND opens the
                            queue. Named by IMREDLINE_ADMIN_NAME.
    IMREDLINE_REVIEWERS     "name:secret,name:secret" — the env list. Never
                            expires; revoke = edit the env.
    reviewers.json          minted from the queue, in IMREDLINE_DATA_DIR. Only
                            the SHA-256 is stored, so a lost link is re-minted,
                            never recovered. Has expiry (1–90 days) and an
                            optional list of hostnames it may report on.

  The store being unreadable degrades to env-only. Losing a file must never
  lock the owner out of their own site.

  Cookies are server-set (Safari caps script-written storage at seven idle
  days; a Set-Cookie is not subject to that cap) and HttpOnly. A readable hint
  cookie lets the widget skip the "who am I" request for ordinary visitors.
*/

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, type Env } from "./env.js";
import type { Access } from "./types.js";

export const TOKEN_COOKIE = "imredline";
export const HINT_COOKIE = "imredline_on";
const YEAR = 60 * 60 * 24 * 365;

const sha256 = (t: string) => createHash("sha256").update(t.trim()).digest("hex");

/* Length-safe constant-time compare. timingSafeEqual throws on a length
   mismatch, which would itself leak the length, so compare digests. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  return timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"));
}

export function reviewerFromEnv(token: string, env: Env = process.env): string | null {
  for (const pair of config(env).reviewers.split(",")) {
    const i = pair.indexOf(":");
    if (i < 1) continue;
    if (sameSecret(pair.slice(i + 1), token)) return pair.slice(0, i).trim();
  }
  return null;
}

/** How many well-formed env entries exist. A count is not a secret, and it
 *  tells "your link is dead" apart from "nobody's link would work". */
export function reviewerCount(env: Env = process.env): number {
  const c = config(env);
  return c.reviewers.split(",").filter((p) => p.indexOf(":") >= 1).length + (c.adminToken ? 1 : 0);
}

export function envReviewerNames(env: Env = process.env): string[] {
  return config(env)
    .reviewers.split(",")
    .map((p) => (p.indexOf(":") >= 1 ? p.slice(0, p.indexOf(":")).trim() : ""))
    .filter(Boolean);
}

/* ── the file store ─────────────────────────────────────────────────────── */

export type MintedRow = {
  id: string;
  name: string;
  sha256: string;
  sites: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function storePath(env: Env): string {
  return join(config(env).dataDir, "reviewers.json");
}

async function readStore(env: Env): Promise<MintedRow[]> {
  try {
    const raw = await readFile(storePath(env), "utf8");
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/* Atomic: write a temp file then rename, so a crash mid-write cannot leave a
   half-written list that takes every minted reviewer offline. Serialised
   through one promise chain because two mints in the same tick would each
   read the old list and the second would drop the first. */
let chain: Promise<unknown> = Promise.resolve();
function withStore<T>(env: Env, fn: (rows: MintedRow[]) => Promise<{ rows: MintedRow[]; out: T }>): Promise<T> {
  const run = chain.then(async () => {
    const rows = await readStore(env);
    const { rows: next, out } = await fn(rows);
    const path = storePath(env);
    await mkdir(config(env).dataDir, { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2));
    await rename(tmp, path);
    return out;
  });
  chain = run.catch(() => undefined);
  return run;
}

export function cleanName(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

const hostOk = (h: string) => /^[a-z0-9.-]{1,253}$/i.test(h);

/** Mint a link. Returns the plaintext token ONCE. */
export async function createReviewer(
  input: { name: string; days?: number; sites?: string[] },
  env: Env = process.env,
): Promise<{ id: string; token: string; expiresAt: string; sites: string[] }> {
  const name = cleanName(input.name);
  if (!name) throw new Error("A name is required.");
  const days = input.days == null ? 30 : Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("Choose between 1 and 90 days.");
  const sites = (input.sites || []).map((s) => s.trim().toLowerCase()).filter(hostOk).slice(0, 20);
  const token = randomBytes(24).toString("base64url");
  const id = randomBytes(8).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString();
  await withStore(env, async (rows) => ({
    rows: [
      ...rows,
      { id, name, sha256: sha256(token), sites, createdAt: now.toISOString(), expiresAt, lastUsedAt: null, revokedAt: null },
    ],
    out: null,
  }));
  return { id, token, expiresAt, sites };
}

export async function revokeReviewer(id: string, env: Env = process.env): Promise<boolean> {
  return withStore(env, async (rows) => {
    const row = rows.find((r) => r.id === id && !r.revokedAt);
    if (!row) return { rows, out: false };
    row.revokedAt = new Date().toISOString();
    return { rows, out: true };
  });
}

export type ReviewerRow = {
  id: string | null;
  name: string;
  source: "env" | "minted";
  sites: string[];
  createdAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  active: boolean;
};

export async function listReviewers(env: Env = process.env): Promise<ReviewerRow[]> {
  const now = Date.now();
  const minted = (await readStore(env))
    .filter((r) => !r.revokedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map<ReviewerRow>((r) => ({
      id: r.id,
      name: r.name,
      source: "minted",
      sites: r.sites,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      lastUsedAt: r.lastUsedAt,
      active: Date.parse(r.expiresAt) > now,
    }));
  const fromEnv = envReviewerNames(env).map<ReviewerRow>((name) => ({
    id: null,
    name,
    source: "env",
    sites: [],
    createdAt: null,
    expiresAt: null,
    lastUsedAt: null,
    active: true,
  }));
  return [...minted, ...fromEnv];
}

/** Resolve a raw token to an Access, or null. Never throws. */
export async function resolveToken(token: string | null | undefined, env: Env = process.env): Promise<Access | null> {
  const t = (token || "").trim();
  if (!t || t.length > 200) return null;
  const c = config(env);
  if (c.adminToken && sameSecret(t, c.adminToken)) return { name: c.adminName, admin: true, sites: [] };
  const fromEnv = reviewerFromEnv(t, env);
  if (fromEnv) return { name: fromEnv, admin: false, sites: [] };
  try {
    const h = sha256(t);
    const rows = await readStore(env);
    const row = rows.find((r) => r.sha256 === h && !r.revokedAt && Date.parse(r.expiresAt) > Date.now());
    if (!row) return null;
    /* Fire-and-forget: "last used" is a convenience on the list; a failed
       stamp must not fail the reviewer's page load. */
    void withStore(env, async (all) => {
      const live = all.find((r) => r.id === row.id);
      if (live) live.lastUsedAt = new Date().toISOString();
      return { rows: all, out: null };
    }).catch(() => undefined);
    return { name: row.name, admin: false, sites: row.sites };
  } catch {
    return null;
  }
}

/** May this reviewer file against this host? Admin and unscoped links: always. */
export function allowedSite(access: Access, host: string): boolean {
  if (access.admin || !access.sites.length) return true;
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return access.sites.some((s) => h === s || h.endsWith("." + s));
}

/* ── cookies (framework-free) ───────────────────────────────────────────── */

export function cookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function accessCookies(token: string, env: Env = process.env): string[] {
  const secure = config(env).secure ? "; Secure" : "";
  const attrs = `Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}`;
  return [`${TOKEN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; ${attrs}`, `${HINT_COOKIE}=1; ${attrs}`];
}

export function clearCookies(env: Env = process.env): string[] {
  const secure = config(env).secure ? "; Secure" : "";
  const gone = `Path=/; Max-Age=0; SameSite=Lax${secure}`;
  return [`${TOKEN_COOKIE}=; HttpOnly; ${gone}`, `${HINT_COOKIE}=; ${gone}`];
}
