/*
  Every knob IMRedline reads, in one place. Names from FEATURE-INVENTORY §L.
  Read lazily on each call so a test can set process.env after import.
*/

export type Env = Record<string, string | undefined>;

export function config(env: Env = process.env) {
  const get = (k: string) => (env[k] || "").trim();
  return {
    adminToken: get("IMREDLINE_ADMIN_TOKEN"),
    adminName: get("IMREDLINE_ADMIN_NAME") || "owner",
    /** "name:secret,name:secret" */
    reviewers: get("IMREDLINE_REVIEWERS"),
    githubToken: get("IMREDLINE_GITHUB_TOKEN"),
    githubRepo: get("IMREDLINE_GITHUB_REPO"),
    /** Short site label. Becomes a `site:<label>` label on every issue. */
    site: get("IMREDLINE_SITE"),
    /** Third-party origins allowed to post (PEMA mode). Exact origins. */
    origins: get("IMREDLINE_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean),
    /** Where minted reviewer links (hashes only) live without a database. */
    dataDir: get("IMREDLINE_DATA_DIR") || ".imredline",
    /** "1" blanks form fields in screenshots. Off by owner ruling. */
    maskForms: get("IMREDLINE_MASK_FORMS") === "1",
    /** Mount path. Default `/_imredline`. */
    base: (get("IMREDLINE_BASE") || "/_imredline").replace(/\/+$/, ""),
    secure: (env.NODE_ENV || "").trim() === "production",
  };
}

export function githubReady(env: Env = process.env): boolean {
  const c = config(env);
  return Boolean(c.githubToken && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(c.githubRepo));
}
