/*
  GitHub is the whole backend. Issues are the queue, labels are the bot's
  status, an orphan branch holds the pictures. Nothing else is hosted.

  The token is a fine-grained PAT with Contents R/W + Issues R/W on ONE repo.
  ⚠️ Fine-grained tokens treat "Pull requests" as a SEPARATE permission — so
  PRs are read through the ISSUES endpoint (each PR is an issue object with a
  `pull_request` sub-object). Do not "simplify" that to /pulls; it 403s in
  production while working locally against a broad token.
*/

import { ASSETS_BRANCH, REVIEW_LABEL } from "./types.js";
import { config, type Env } from "./env.js";
import { marker, type GhIssue } from "./issue.js";

export type Fetch = typeof fetch;

export class GitHub {
  private repo: string;
  private token: string;
  constructor(
    env: Env = process.env,
    private fetchImpl: Fetch = fetch,
    /** Another repo under the same token — the clips swipe-file. */
    repoOverride?: string,
  ) {
    const c = config(env);
    this.repo = repoOverride || c.githubRepo;
    this.token = c.githubToken;
  }

  get repoName(): string {
    return this.repo;
  }

  async api(path: string, init: { method?: string; body?: unknown; accept?: string } = {}): Promise<Response> {
    return this.fetchImpl(`https://api.github.com/repos/${this.repo}${path}`, {
      method: init.method || "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: init.accept || "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "imredline",
      },
      body: init.body ? JSON.stringify(init.body) : null,
      cache: "no-store",
      /* A hung GitHub call must not hold a render or an upload open forever. */
      signal: AbortSignal.timeout(10_000),
    });
  }

  /** Is the repo private? null when it could not be determined. Used for a
   *  warning in the queue, never as a block — a public repo is a legitimate
   *  choice for an open-source project's own queue. */
  async isPrivate(): Promise<boolean | null> {
    try {
      const r = await this.api("");
      if (!r.ok) return null;
      return Boolean(((await r.json()) as { private?: boolean }).private);
    } catch {
      return null;
    }
  }

  /**
   * Put an image on the assets branch. Returns its path, or null on failure —
   * a lost picture must never cost the report.
   *
   * The branch is created on first use off main's tip (the Contents API cannot
   * create a branch). 422 on the create = a race, retry anyway.
   */
  async uploadAsset(dir: "shots" | "samples", name: string, ext: "png" | "jpg", b64: string): Promise<string | null> {
    const path = `${dir}/${name}.${ext}`;
    const put = () =>
      this.api(`/contents/${path}`, {
        method: "PUT",
        body: { message: `imredline ${dir} ${name}`, content: b64, branch: ASSETS_BRANCH },
      });
    try {
      let res = await put();
      if (res.status === 404) {
        const main = await this.api("/git/ref/heads/main");
        if (!main.ok) return null;
        const sha = ((await main.json()) as { object?: { sha?: string } })?.object?.sha;
        if (!sha) return null;
        const made = await this.api("/git/refs", { method: "POST", body: { ref: `refs/heads/${ASSETS_BRANCH}`, sha } });
        if (!made.ok && made.status !== 422) return null;
        res = await put();
      }
      return res.ok ? path : null;
    } catch {
      return null;
    }
  }

  /** Raw bytes of a file on a branch (assets branch by default), for the
   *  reviewer-gated proxies. */
  async readAsset(path: string, branch: string = ASSETS_BRANCH): Promise<ArrayBuffer | null> {
    try {
      const res = await this.api(`/contents/${path}?ref=${branch}`, { accept: "application/vnd.github.raw" });
      return res.ok ? await res.arrayBuffer() : null;
    } catch {
      return null;
    }
  }

  /** Tip of a branch, creating it off main when missing. Null when neither
   *  can be had. */
  async branchTip(branch: string): Promise<string | null> {
    try {
      const ref = await this.api(`/git/ref/heads/${branch}`);
      if (ref.ok) return ((await ref.json()) as { object?: { sha?: string } })?.object?.sha ?? null;
      if (ref.status !== 404) return null;
      const main = await this.api("/git/ref/heads/main");
      if (!main.ok) return null;
      const sha = ((await main.json()) as { object?: { sha?: string } })?.object?.sha;
      if (!sha) return null;
      const made = await this.api("/git/refs", { method: "POST", body: { ref: `refs/heads/${branch}`, sha } });
      if (made.ok) return sha;
      if (made.status !== 422) return null;
      const again = await this.api(`/git/ref/heads/${branch}`);
      return again.ok ? (((await again.json()) as { object?: { sha?: string } })?.object?.sha ?? null) : null;
    } catch {
      return null;
    }
  }

  /**
   * Several files, ONE commit (Git Data API: blobs → tree → commit → ref).
   * A clip is seven files and an index; seven Contents-API commits per clip
   * would make the branch history unreadable for the agent that reads it.
   * Returns the new commit sha, or null — nothing half-lands: the ref only
   * moves once every blob and the tree exist.
   */
  async commitFiles(
    branch: string,
    message: string,
    files: { path: string; content: string; encoding?: "utf-8" | "base64" }[],
  ): Promise<string | null> {
    try {
      const parent = await this.branchTip(branch);
      if (!parent) return null;
      const commit = await this.api(`/git/commits/${parent}`);
      if (!commit.ok) return null;
      const baseTree = ((await commit.json()) as { tree?: { sha?: string } })?.tree?.sha;
      if (!baseTree) return null;
      const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
      for (const f of files) {
        const blob = await this.api("/git/blobs", { method: "POST", body: { content: f.content, encoding: f.encoding ?? "utf-8" } });
        if (!blob.ok) return null;
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: ((await blob.json()) as { sha: string }).sha });
      }
      const treeRes = await this.api("/git/trees", { method: "POST", body: { base_tree: baseTree, tree } });
      if (!treeRes.ok) return null;
      const treeSha = ((await treeRes.json()) as { sha: string }).sha;
      const newCommit = await this.api("/git/commits", { method: "POST", body: { message, tree: treeSha, parents: [parent] } });
      if (!newCommit.ok) return null;
      const sha = ((await newCommit.json()) as { sha: string }).sha;
      const moved = await this.api(`/git/refs/heads/${branch}`, { method: "PATCH", body: { sha } });
      return moved.ok ? sha : null;
    } catch {
      return null;
    }
  }

  /** A retry after a timeout must not file twice. The marker is the first
   *  line of every body; look through the recent reports for it.
   *  ⚠️ The list endpoint lags a just-created issue by a second or two
   *  (measured on production 2026-09-13: an immediate re-POST filed a twin).
   *  The widget retries only after a 30 s timeout, so the lag never reaches a
   *  reviewer; anything scripting this API should wait a few seconds first. */
  async findByMarker(requestId: string): Promise<GhIssue | null> {
    try {
      const res = await this.api(`/issues?labels=${REVIEW_LABEL}&state=all&per_page=100&sort=created&direction=desc`);
      if (!res.ok) return null;
      const items = (await res.json()) as GhIssue[];
      const head = marker(requestId);
      return items.find((i) => !i.pull_request && typeof i.body === "string" && i.body.startsWith(head)) ?? null;
    } catch {
      return null;
    }
  }

  async createIssue(title: string, body: string, labels: string[]): Promise<GhIssue> {
    const res = await this.api("/issues", { method: "POST", body: { title, body, labels } });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as GhIssue;
  }

  async setState(number: number, state: "open" | "closed"): Promise<boolean> {
    const res = await this.api(`/issues/${number}`, { method: "PATCH", body: { state } });
    return res.ok;
  }

  /** Reports + the unlabelled listing that carries the bot's PRs, in parallel. */
  async listReports(): Promise<{ reports: GhIssue[]; all: GhIssue[] | null; status: number }> {
    const [res, allRes] = await Promise.all([
      this.api(`/issues?labels=${REVIEW_LABEL}&state=all&per_page=100&sort=created&direction=desc`),
      this.api(`/issues?state=all&per_page=100&sort=created&direction=desc`),
    ]);
    if (!res.ok) return { reports: [], all: null, status: res.status };
    const reports = ((await res.json()) as GhIssue[]).filter((i) => !i.pull_request);
    const all = allRes.ok ? ((await allRes.json()) as GhIssue[]) : null;
    return { reports, all, status: 200 };
  }
}
