/*
  An in-memory GitHub for tests: just the endpoints IMRedline touches.
  Returns a `fetch` and the state it mutates, so a test can assert on the
  issue that was filed and the bytes that were uploaded.
*/
export function fakeGitHub({ repo = "acme/site", isPrivate = true, failCreate = false } = {}) {
  const state = { issues: [], contents: new Map(), branches: new Set(["main"]), calls: [], isPrivate, failCreate, failCommit: false, commits: [] };
  /* Git Data API state: a tip sha per branch, blobs, trees, commits. A tree
     is flattened straight into `contents` when its commit lands on a branch,
     so readAsset keeps working the same way for both APIs. */
  const git = { tips: new Map([["main", "abc123"]]), blobs: new Map(), trees: new Map([["tree-main", []]]), commits: new Map([["abc123", { tree: "tree-main", parents: [] }]]) };
  let seq = 0;
  const sha = (p) => `${p}${(++seq).toString(16).padStart(6, "0")}`;
  let next = 1;
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || "GET").toUpperCase();
    const p = u.pathname.replace(`/repos/${repo}`, "");
    state.calls.push(`${method} ${p}${u.search}`);
    if (!u.pathname.startsWith(`/repos/${repo}`)) return json({ message: "wrong repo" }, 404);
    const body = init.body ? JSON.parse(init.body) : null;

    if (method === "GET" && p === "") return json({ private: state.isPrivate });
    const refGet = /^\/git\/ref\/heads\/(.+)$/.exec(p);
    if (method === "GET" && refGet) {
      const name = decodeURIComponent(refGet[1]);
      if (!state.branches.has(name)) return json({ message: "Not Found" }, 404);
      return json({ object: { sha: git.tips.get(name) || "abc123" } });
    }
    if (method === "POST" && p === "/git/refs") {
      const name = body.ref.replace("refs/heads/", "");
      if (state.branches.has(name)) return json({ message: "exists" }, 422);
      state.branches.add(name);
      git.tips.set(name, body.sha);
      return json({ ref: body.ref }, 201);
    }
    const refPatch = /^\/git\/refs\/heads\/(.+)$/.exec(p);
    if (method === "PATCH" && refPatch) {
      const name = decodeURIComponent(refPatch[1]);
      const commit = git.commits.get(body.sha);
      if (!state.branches.has(name) || !commit) return json({ message: "bad sha" }, 422);
      git.tips.set(name, body.sha);
      for (const [path, blobSha] of git.trees.get(commit.tree) || []) state.contents.set(`${name}:${path}`, git.blobs.get(blobSha));
      state.commits.push({ branch: name, sha: body.sha, message: commit.message, files: (git.trees.get(commit.tree) || []).map(([path]) => path) });
      return json({ object: { sha: body.sha } });
    }
    if (method === "GET" && p.startsWith("/git/commits/")) {
      const c = git.commits.get(p.slice("/git/commits/".length));
      return c ? json({ sha: p.slice("/git/commits/".length), tree: { sha: c.tree } }) : json({ message: "no" }, 404);
    }
    if (method === "POST" && p === "/git/blobs") {
      if (state.failCommit) return json({ message: "boom" }, 500);
      const id = sha("blob");
      git.blobs.set(id, body.encoding === "base64" ? Buffer.from(body.content, "base64") : Buffer.from(body.content, "utf8"));
      return json({ sha: id }, 201);
    }
    if (method === "POST" && p === "/git/trees") {
      const base = git.trees.get(body.base_tree);
      if (!base) return json({ message: "bad base_tree" }, 404);
      const entries = new Map(base);
      for (const t of body.tree) entries.set(t.path, t.sha);
      const id = sha("tree");
      git.trees.set(id, [...entries]);
      return json({ sha: id }, 201);
    }
    if (method === "POST" && p === "/git/commits") {
      if (!git.trees.has(body.tree)) return json({ message: "bad tree" }, 404);
      const id = sha("commit");
      git.commits.set(id, { tree: body.tree, parents: body.parents, message: body.message });
      return json({ sha: id }, 201);
    }
    if (p.startsWith("/contents/")) {
      const path = decodeURIComponent(p.slice("/contents/".length));
      if (method === "PUT") {
        if (!state.branches.has(body.branch)) return json({ message: "branch not found" }, 404);
        state.contents.set(`${body.branch}:${path}`, Buffer.from(body.content, "base64"));
        return json({ content: { path } }, 201);
      }
      if (method === "GET") {
        const ref = u.searchParams.get("ref") || "main";
        const bytes = state.contents.get(`${ref}:${path}`);
        if (!bytes) return new Response("not found", { status: 404 });
        return new Response(bytes, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
      }
    }
    if (p === "/issues" && method === "GET") {
      const label = u.searchParams.get("labels");
      const list = state.issues.filter((i) => !label || i.labels.some((l) => l.name === label));
      return json([...list].sort((a, b) => b.number - a.number));
    }
    if (p === "/issues" && method === "POST") {
      if (state.failCreate) return json({ message: "boom" }, 500);
      const issue = {
        number: next++,
        html_url: `https://github.com/${repo}/issues/${next - 1}`,
        title: body.title,
        body: body.body,
        state: "open",
        created_at: new Date().toISOString(),
        labels: (body.labels || []).map((name) => ({ name })),
      };
      state.issues.push(issue);
      return json(issue, 201);
    }
    const m = /^\/issues\/(\d+)$/.exec(p);
    if (m && method === "PATCH") {
      const issue = state.issues.find((i) => i.number === Number(m[1]));
      if (!issue) return json({ message: "no" }, 404);
      if (body.state) issue.state = body.state;
      return json(issue);
    }
    return json({ message: `unhandled ${method} ${p}` }, 404);
  }
  return { fetch, state };
}

/** A real 1×1 PNG, as a data URL. */
export const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export const TEST_ENV = {
  IMREDLINE_ADMIN_TOKEN: "admin-secret-token",
  IMREDLINE_ADMIN_NAME: "rishi",
  IMREDLINE_REVIEWERS: "ravi:ravi-secret,Asha Rao:sri-secret",
  IMREDLINE_GITHUB_TOKEN: "ghp_test",
  IMREDLINE_GITHUB_REPO: "acme/site",
  IMREDLINE_SITE: "acme",
  NODE_ENV: "test",
};

/** A real 1×1 JPEG, as a data URL (clips store JPEG screenshots). */
export const JPG_1x1 =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgA//Z";
