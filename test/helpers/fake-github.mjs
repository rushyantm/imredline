/*
  An in-memory GitHub for tests: just the endpoints IMRedline touches.
  Returns a `fetch` and the state it mutates, so a test can assert on the
  issue that was filed and the bytes that were uploaded.
*/
export function fakeGitHub({ repo = "acme/site", isPrivate = true, failCreate = false } = {}) {
  const state = { issues: [], contents: new Map(), branches: new Set(["main"]), calls: [], isPrivate, failCreate };
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
    if (method === "GET" && p === "/git/ref/heads/main") return json({ object: { sha: "abc123" } });
    if (method === "POST" && p === "/git/refs") {
      const name = body.ref.replace("refs/heads/", "");
      if (state.branches.has(name)) return json({ message: "exists" }, 422);
      state.branches.add(name);
      return json({ ref: body.ref }, 201);
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
