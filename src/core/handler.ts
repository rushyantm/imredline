/*
  One framework-free request handler. Next.js and plain Node both call
  `handle(request)`; it answers everything under IMREDLINE_BASE (default
  `/imredline`) and returns null for anything else.

    GET    <base>/widget.js | queue.js | html2canvas.js   static
    GET    <base>/queue                                   the queue page
    POST   <base>/api/session   {token}                   arm this browser
    GET    <base>/api/session                             who am I
    DELETE <base>/api/session                             sign out
    POST   <base>/api/report                              file a report
    PATCH  <base>/api/report/<n>  {status}                admin: open/done
    GET    <base>/api/queue                               reviewer: rows as JSON (read-only unless admin)
    GET    <base>/api/asset?path=shots/x.jpg              reviewer: image proxy
    GET/POST/DELETE <base>/api/reviewers                  admin: mint/revoke
    OPTIONS *                                             CORS preflight

  Third-party mode (PEMA): an origin listed in IMREDLINE_ORIGINS may call
  session and report cross-origin, with the token in the body. Everyone else
  gets no CORS headers and the browser refuses the response.
*/

import { randomUUID } from "node:crypto";
import {
  accessCookies,
  allowedSite,
  clearCookies,
  cookieValue,
  createReviewer,
  listReviewers,
  resolveToken,
  reviewerCount,
  revokeReviewer,
  sameSecret,
  TOKEN_COOKIE,
} from "./access.js";
import { assets, assetTypes } from "./assets.js";
import { config, githubReady, type Env } from "./env.js";
import { GitHub, type Fetch } from "./github.js";
import { formatIssue, parseIssue, prsByReport } from "./issue.js";
import { queuePage } from "./page.js";
import { REVIEW_LABEL, STATUSES, type Access, type QueueRow } from "./types.js";
import { imageData, parseReport, Reject, slug, viewportText } from "./validate.js";

export type HandlerOptions = {
  env?: Env;
  fetch?: Fetch;
  /** Called after a report is filed — a hook for a site to notify anything. */
  onReport?: (row: { number: number; url: string; reviewer: string; page: string }) => void;
  /** Bring your own token source — consulted AFTER the admin token, the env
   *  list and the minted-links file. A site that already keeps reviewer
   *  tokens somewhere (EIPL's Postgres table with a careers role) plugs it in
   *  here, so those links arm the widget and set the same cookie the site's
   *  own admin pages read. Return null for "not one of mine". */
  resolveToken?: (token: string) => Promise<ExtraAccess | null>;
};

export type ExtraAccess = { name: string; admin?: boolean; sites?: string[] };

const json = (data: unknown, status = 200, headers: Record<string, string> = {}, cookies: string[] = []) => {
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(JSON.stringify(data), { status, headers: h });
};

/* ── rate limit: in-memory, per instance, per hour. Enough to stop a loop. ── */
const buckets = new Map<string, { n: number; until: number }>();
function limited(key: string, max: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.until < now) {
    buckets.set(key, { n: 1, until: now + 3_600_000 });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
    return false;
  }
  b.n++;
  return b.n > max;
}
const ipOf = (req: Request) =>
  (req.headers.get("x-forwarded-for") || "").split(",")[0]!.trim() || req.headers.get("x-real-ip") || "local";

export async function handle(req: Request, opts: HandlerOptions = {}): Promise<Response | null> {
  const env = opts.env ?? process.env;
  const c = config(env);
  const url = new URL(req.url);
  if (url.pathname !== c.base && !url.pathname.startsWith(c.base + "/")) return null;
  const path = url.pathname.slice(c.base.length) || "/";
  const method = req.method.toUpperCase();

  /* CORS for listed third-party origins only. */
  const origin = req.headers.get("origin");
  const sameOrigin = !origin || origin === url.origin;
  const cors: Record<string, string> =
    origin && !sameOrigin && c.origins.includes(origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          Vary: "Origin",
        }
      : {};
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const crossOrigin = Boolean(origin && !sameOrigin);

  /* ── static ── */
  if (method === "GET" && (path === "/widget.js" || path === "/queue.js" || path === "/html2canvas.js")) {
    const name = path.slice(1);
    const body = assets[name];
    if (!body) return new Response("asset missing — run the package build", { status: 503 });
    return new Response(body, {
      headers: { "Content-Type": assetTypes[name]!, "Cache-Control": "public, max-age=300" },
    });
  }
  if (method === "GET" && (path === "/" || path === "/queue")) {
    return new Response(queuePage(c.base, req.headers.get("x-nonce") || ""), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  }

  const cookieToken = cookieValue(req.headers.get("cookie"), TOKEN_COOKIE);
  const queryToken = url.searchParams.get("token");
  const resolve = async (t: string | null | undefined): Promise<Access | null> => {
    const own = await resolveToken(t, env);
    if (own || !opts.resolveToken || !t || t.length > 200) return own;
    try {
      const extra = await opts.resolveToken(t.trim());
      return extra ? { name: String(extra.name).slice(0, 40) || "reviewer", admin: Boolean(extra.admin), sites: extra.sites ?? [] } : null;
    } catch {
      return null;
    }
  };
  const who = async (bodyToken?: string): Promise<Access | null> =>
    (await resolve(cookieToken)) ?? (await resolve(bodyToken)) ?? (await resolve(queryToken));
  const readJson = async () => {
    try {
      return (await req.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  try {
    /* ── session ── */
    if (path === "/api/session") {
      if (method === "POST") {
        if (limited(`session:${ipOf(req)}`, 30)) return json({ error: "Too many attempts. Try again later." }, 429, cors);
        const body = await readJson();
        const token = typeof body?.token === "string" ? body.token : "";
        const access = await resolve(token);
        if (!access) {
          return json({ error: "That review link is no longer valid — ask for a new one." }, 401, cors, crossOrigin ? [] : clearCookies(env));
        }
        return json(
          { ok: true, name: access.name, admin: access.admin, sites: access.sites, maskForms: c.maskForms },
          200,
          cors,
          crossOrigin ? [] : accessCookies(token.trim(), env),
        );
      }
      if (method === "GET") {
        const access = await who();
        if (!access) return json({ error: "Not a reviewer." }, 401, cors, clearCookies(env));
        return json({ ok: true, name: access.name, admin: access.admin, sites: access.sites, maskForms: c.maskForms }, 200, cors);
      }
      if (method === "DELETE") return json({ ok: true }, 200, cors, clearCookies(env));
    }

    /* ── file a report ── */
    if (path === "/api/report" && method === "POST") {
      if (!githubReady(env)) return json({ error: "Review backend not configured (IMREDLINE_GITHUB_TOKEN / IMREDLINE_GITHUB_REPO)." }, 503, cors);
      if (limited(`report:${ipOf(req)}`, 120)) return json({ error: "Too many reports from this connection. Try again in an hour." }, 429, cors);
      const raw = await readJson();
      const input = parseReport(raw);
      const access = await who(input.token);
      if (!access) {
        return json(
          {
            error: reviewerCount(env)
              ? "Your review access has expired — open your review link again."
              : "No reviewers are configured on the server (IMREDLINE_ADMIN_TOKEN and IMREDLINE_REVIEWERS are both empty).",
          },
          401,
          cors,
        );
      }
      /* Which site is this? Third-party mode sends host/path; same-origin
         sends /path and the request host is the site. */
      const host = input.page.startsWith("/") ? url.host : input.page.split("/")[0]!;
      if (!allowedSite(access, host)) return json({ error: "Your review link does not cover this site." }, 403, cors);

      const gh = new GitHub(env, opts.fetch);
      const twin = await gh.findByMarker(input.requestId);
      if (twin) return json({ ok: true, number: twin.number, url: twin.html_url, duplicate: true, hasShot: /📷/.test(twin.body || "") }, 200, cors);

      const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(access.name)}`;
      let shotPath: string | null = null;
      let shotError = input.shotError ?? null;
      if (input.screenshot) {
        const img = imageData(input.screenshot);
        if (!img) shotError = "screenshot too large or not an image";
        else {
          shotPath = await gh.uploadAsset("shots", stamp, img.ext, img.b64);
          if (!shotPath) shotError = "screenshot upload failed";
        }
      }
      const samples: { name: string; path: string }[] = [];
      const links: { kind: "link" | "path"; value: string }[] = [];
      let samplesLost = 0;
      let n = 0;
      for (const s of input.samples ?? []) {
        if (s.kind === "image") {
          const img = imageData(s.data);
          const p = img ? await gh.uploadAsset("samples", `${stamp}-${++n}`, img.ext, img.b64) : null;
          if (p) samples.push({ name: s.name, path: p });
          else samplesLost++;
        } else links.push({ kind: s.kind, value: s.value });
      }

      const draft = formatIssue({
        requestId: input.requestId,
        type: input.type,
        note: input.note,
        page: input.page,
        reviewer: access.name,
        selector: input.selector ?? null,
        viewport: viewportText(input.viewport),
        device: input.device ?? null,
        shotPath,
        shotError,
        shotNote: input.shotNote ?? null,
        samples,
        links,
      });
      const labels = [REVIEW_LABEL];
      if (c.site) labels.push(`site:${c.site.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40)}`);
      let issue;
      try {
        issue = await gh.createIssue(draft.title, draft.body, labels);
      } catch (e) {
        console.error("[imredline] issue create failed:", (e as Error).message);
        return json({ error: "Could not file the report — GitHub did not accept it. Your note is still here; try again." }, 502, cors);
      }
      opts.onReport?.({ number: issue.number, url: issue.html_url, reviewer: access.name, page: input.page });
      return json(
        { ok: true, number: issue.number, url: issue.html_url, hasShot: Boolean(shotPath), samplesSaved: samples.length + links.length, samplesLost },
        201,
        cors,
      );
    }

    /* ── everything below needs a signed-in reviewer, same-origin.
       Reading the queue and its pictures is for ANY reviewer — someone who
       files reports deserves to see where they went. Everything that WRITES
       (Done/Reopen, mint, revoke) stays admin-only, further down. ── */
    const me = await who();
    const admin = Boolean(me?.admin) || Boolean(queryToken && c.adminToken && sameSecret(queryToken, c.adminToken));
    if (!me && !admin) {
      if (path.startsWith("/api/")) return json({ error: "Not authorised." }, 401);
      return null;
    }

    if (path === "/api/queue" && method === "GET") {
      if (!githubReady(env)) return json({ error: "GitHub isn't configured — set IMREDLINE_GITHUB_TOKEN and IMREDLINE_GITHUB_REPO.", rows: [], admin }, 503);
      const gh = new GitHub(env, opts.fetch);
      const { reports, all, status } = await gh.listReports();
      if (status !== 200) return json({ error: `GitHub returned ${status}, so the report list can't load.`, rows: [], admin }, 502);
      const prs = all ? prsByReport(all) : new Map<number, QueueRow["pr"]>();
      const rows = reports.map((i) => parseIssue(i, prs)).sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1));
      const warnings: string[] = [];
      if (!all) warnings.push("PR links are off — GitHub refused the issue listing. Everything else is unaffected.");
      else if (all.length >= 100) warnings.push("Past 100 issues — PR links on the oldest reports may be missing.");
      const priv = await gh.isPrivate();
      if (priv === false) warnings.push("This repo is PUBLIC — every report, screenshot and sample is visible to anyone. Fine for an open-source project; not for a client site.");
      return json({ ok: true, repo: gh.repoName, site: c.site, rows, warnings, admin, canMint: admin });
    }

    if (path === "/api/asset" && method === "GET") {
      const p = url.searchParams.get("path") || "";
      /* Path-jail: only the two asset directories, no traversal. */
      if (!/^(shots|samples)\/[A-Za-z0-9._-]+\.(png|jpe?g)$/.test(p)) return new Response("Bad path", { status: 400 });
      if (!githubReady(env)) return new Response("Not configured", { status: 503 });
      const buf = await new GitHub(env, opts.fetch).readAsset(p);
      if (!buf) return new Response("Not found", { status: 404 });
      /* Sniff the bytes; never trust the extension (NN had JPEGs in .png names). */
      const head = new Uint8Array(buf.slice(0, 4));
      const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
      return new Response(buf, {
        headers: { "Content-Type": isPng ? "image/png" : "image/jpeg", "Cache-Control": "private, max-age=300" },
      });
    }

    /* ── admin-only from here ── */
    if (!admin) {
      if (path.startsWith("/api/")) return json({ error: "Not authorised." }, 401);
      return null;
    }

    if (path.startsWith("/api/report/") && method === "PATCH") {
      const num = path.slice("/api/report/".length);
      if (!/^\d+$/.test(num)) return json({ error: "Bad issue." }, 400);
      if (!githubReady(env)) return json({ error: "Not configured." }, 503);
      const body = await readJson();
      const status = String(body?.status || "");
      if (!(STATUSES as readonly string[]).includes(status)) return json({ error: "Unknown status." }, 400);
      /* One call. Open/closed IS the status; nothing can half-apply. */
      const ok = await new GitHub(env, opts.fetch).setState(Number(num), status === "done" ? "closed" : "open");
      return ok ? json({ ok: true, status }) : json({ error: "GitHub refused the change — row unchanged." }, 502);
    }

    if (path === "/api/reviewers") {
      if (method === "GET") return json({ ok: true, reviewers: await listReviewers(env), canMint: true });
      if (method === "POST") {
        const body = await readJson();
        try {
          const sites = Array.isArray(body?.sites) ? (body!.sites as unknown[]).map(String) : [];
          const made = await createReviewer({ name: String(body?.name || ""), days: body?.days == null ? 30 : Number(body.days), sites }, env);
          return json({ ok: true, ...made, name: String(body?.name || "").trim().slice(0, 40) }, 201);
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      }
      if (method === "DELETE") {
        const id = url.searchParams.get("id") || "";
        if (!/^[a-f0-9]{16}$/.test(id)) return json({ error: "Bad id." }, 400);
        return (await revokeReviewer(id, env)) ? json({ ok: true }) : json({ error: "Already revoked." }, 404);
      }
    }

    return path.startsWith("/api/") ? json({ error: "Not found." }, 404) : null;
  } catch (e) {
    if (e instanceof Reject) return json({ error: e.message }, e.status, cors);
    console.error("[imredline]", (e as Error).message);
    return json({ error: "Something went wrong on the server." }, 500, cors);
  }
}

/** A request id the widget can use; exported so tests share one generator. */
export const newRequestId = () => randomUUID();
