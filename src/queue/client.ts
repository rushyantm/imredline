/*
  The queue page's client. Reads <base>/api/queue, renders cards, flips
  Done/Reopen straight on GitHub (a rejected write leaves the row unchanged
  and says why), and manages reviewer links.

  Auth: any reviewer cookie, or ?token= on the URL. A ?token= also arms this
  browser through the session route so the next visit needs nothing. A plain
  reviewer gets the list and the pictures READ-ONLY: status as a chip, no
  Done/Reopen, no reviewer panel. The server enforces that; this file only
  hides what would fail.
*/

import type { QueueRow } from "../core/types.js";

type Reviewer = {
  id: string | null;
  name: string;
  source: "env" | "minted";
  sites: string[];
  createdAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  active: boolean;
};

(function main() {
  const root = document.getElementById("imq");
  if (!root) return;
  const BASE = root.dataset.base || "/imredline";
  const API = BASE + "/api";
  const params = new URLSearchParams(location.search);
  const token = params.get("token") || "";
  const auth = (sep: "?" | "&") => (token ? `${sep}token=${encodeURIComponent(token)}` : "");

  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");
  async function api(path: string, init: RequestInit & { json?: unknown } = {}) {
    const res = await fetch(API + path + (path.includes("?") ? auth("&") : auth("?")), {
      ...init,
      headers: { "Content-Type": "application/json" },
      body: init.json !== undefined ? JSON.stringify(init.json) : null,
      credentials: "same-origin",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, data };
  }

  let rows: QueueRow[] = [];
  let repo = "";
  let clipsRepo = "";
  let admin = false;
  const filter = { status: "open", type: "", q: "" };

  function gate(msg: string) {
    root!.replaceChildren(h("div", "imq-gate"));
    root!.firstElementChild!.append(h("h1", undefined, "Review queue"), h("p", "imq-sub", msg));
  }

  function shotUrl(p: string) {
    return `${API}/asset?path=${encodeURIComponent(p)}${auth("&")}`;
  }

  function zoom(src: string) {
    const z = h("div", "imq-zoom");
    const img = h("img") as HTMLImageElement;
    img.src = src;
    img.alt = "full size";
    z.append(img);
    z.onclick = () => z.remove();
    document.body.append(z);
  }

  function card(r: QueueRow): HTMLElement {
    const c = h("div", "imq-card");
    if (r.status === "discarded") c.classList.add("imq-card--discarded");
    if (r.shotPath) {
      const img = h("img", "imq-shot") as HTMLImageElement;
      img.src = shotUrl(r.shotPath);
      img.alt = `screenshot for #${r.number}`;
      img.loading = "lazy";
      img.onclick = () => zoom(shotUrl(r.shotPath!));
      c.append(img);
    } else c.append(h("div", "imq-noshot", "no screenshot"));

    const body = h("div", "imq-body");
    const meta = h("div", "imq-meta");
    meta.append(h("span", `imq-type imq-type--${r.type}`, r.type));
    const link = h("a", undefined, `#${r.number}`) as HTMLAnchorElement;
    link.href = r.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    meta.append(link, h("span", undefined, r.reviewer), h("span", "imq-date", fmtDate(r.createdAt)));
    body.append(meta, h("p", "imq-note", r.note));

    const where = h("p", "imq-where");
    if (r.device) where.append(h("span", "imq-device", r.device));
    where.append(r.page + (r.element ? ` · ${r.element}` : "") + (r.viewport ? ` · ${r.viewport}` : ""));
    body.append(where);
    if (r.shotNote) body.append(h("p", "imq-where", "⚠️ " + r.shotNote));

    if (r.inspiration) {
      const ref = r.inspiration;
      const detail = h("details", "imq-insp");
      detail.append(h("summary", "imq-chip imq-insp-chip", "with reference"));
      const content = h("div", "imq-insp-detail");
      if (ref.repo === clipsRepo) {
        const img = h("img", "imq-insp-thumb");
        img.src = `${API}/clip-asset?path=${encodeURIComponent(ref.path + "/screenshot.jpg")}${auth("&")}`;
        img.alt = "Inspiration screenshot";
        img.loading = "lazy";
        img.onclick = () => zoom(img.src);
        img.onerror = () => img.replaceWith(h("span", "imq-insp-missing", "reference discarded"));
        content.append(img);
      }
      const addLink = (url: string, label: string) => {
        const a = h("a", undefined, label);
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        content.append(a);
      };
      if (ref.url) addLink(ref.url, "Open inspiration");
      addLink(ref.folder, "Open clip folder");
      detail.append(content);
      body.append(detail);
    }

    if (r.samples.length) {
      const ul = h("ul", "imq-samples");
      for (const s of r.samples) {
        const li = h("li");
        if (s.kind === "image") {
          const img = h("img") as HTMLImageElement;
          img.src = shotUrl(s.value);
          img.alt = s.name || "sample image";
          img.loading = "lazy";
          img.onclick = () => zoom(shotUrl(s.value));
          li.append(img, h("span", undefined, s.name || "sample"));
        } else if (s.kind === "link") {
          const a = h("a", undefined, s.value) as HTMLAnchorElement;
          a.href = s.value;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          li.append(h("span", undefined, "🔗"), a);
        } else li.append(h("span", undefined, "📁 not uploaded:"), h("code", undefined, s.value));
        ul.append(li);
      }
      body.append(ul);
    }

    const actions = h("div", "imq-actions");
    if (!admin || r.status === "discarded") actions.append(h("span", "imq-chip imq-chip--" + (r.status === "done" ? "good" : "plain"), r.status));
    if (admin) {
      const change = async (next: QueueRow["status"], why?: string) => {
        const controls = actions.querySelectorAll("button, input");
        controls.forEach((el) => (el as HTMLButtonElement | HTMLInputElement).disabled = true);
        setError(null);
        try {
          const { res, data } = await api(`/report/${r.number}`, { method: "PATCH", json: { status: next, ...(why !== undefined ? { why } : {}) } });
          if (res.ok) {
            r.status = next;
            render();
            if (data.warning) setError(`#${r.number}: ${data.warning}.`);
          } else setError(`#${r.number}: ${data.error || res.status}`);
        } catch {
          setError(`#${r.number}: Could not reach the server. Reload to check its status.`);
        } finally {
          controls.forEach((el) => (el as HTMLButtonElement | HTMLInputElement).disabled = false);
        }
      };
      const btn = h("button", "imq-status" + (r.status !== "open" ? " is-done" : ""), r.status === "discarded" ? "Restore" : r.status === "done" ? "Reopen" : "Done");
      btn.type = "button";
      btn.onclick = () => void change(r.status === "open" ? "done" : "open");
      actions.append(btn);
      if (r.status === "open") {
        const box = h("span", "imq-discard");
        const discard = h("button", "imq-status is-done", "Discard");
        discard.type = "button";
        const reset = () => box.replaceChildren(discard);
        discard.onclick = () => {
          const why = h("input", "imq-discard-why");
          why.type = "text";
          why.placeholder = "Why (optional)";
          why.setAttribute("aria-label", "Why discard this report (optional)");
          why.maxLength = 300;
          const yes = h("button", "imq-status", "✓");
          yes.type = "button";
          yes.setAttribute("aria-label", "Confirm discard");
          yes.onclick = () => void change("discarded", why.value.trim());
          const no = h("button", "imq-status is-done", "✕");
          no.type = "button";
          no.setAttribute("aria-label", "Cancel discard");
          no.onclick = () => { reset(); discard.focus(); };
          box.replaceChildren(h("span", undefined, "Discard?"), why, yes, no);
          why.focus();
        };
        reset();
        actions.append(box);
      }
    }
    if (r.bot) actions.append(h("span", `imq-chip imq-chip--${r.bot.tone}`, r.bot.text));
    if (r.pr) {
      const a = h("a", "imq-pr", `PR #${r.pr.number} · ${r.pr.state}`) as HTMLAnchorElement;
      a.href = r.pr.url;
      a.target = "_blank";
      a.rel = "noreferrer";
      actions.append(a);
    }
    body.append(actions);
    c.append(body);
    return c;
  }

  let errorEl: HTMLElement | null = null;
  function setError(msg: string | null) {
    if (!errorEl) return;
    errorEl.textContent = msg || "";
  }

  let listEl: HTMLElement | null = null;
  let subEl: HTMLElement | null = null;
  function render() {
    if (!listEl || !subEl) return;
    const shown = rows.filter(
      (r) =>
        (filter.status === "all" || r.status === filter.status) &&
        (!filter.type || r.type === filter.type) &&
        (!filter.q || `${r.note} ${r.page} ${r.reviewer} ${r.element || ""} #${r.number}`.toLowerCase().includes(filter.q)),
    );
    subEl.textContent = `${rows.filter((r) => r.status === "open").length} open · ${rows.filter((r) => r.status === "done").length} done · ${rows.filter((r) => r.status === "discarded").length} discarded of ${rows.length}`;
    listEl.replaceChildren(...(shown.length ? shown.map(card) : [h("p", "imq-empty", rows.length ? "Nothing matches this filter." : "No reports yet.")]));
  }

  function adminPanel(): HTMLElement {
    const sec = h("section", "imq-admin");
    const head = h("div", "imq-admin__head");
    const count = h("span");
    const manage = h("button", "imq-manage", "Manage") as HTMLButtonElement;
    manage.type = "button";
    head.append(h("h2", undefined, "Reviewer links"), count, manage);
    const panel = h("div");
    panel.hidden = true;
    const err = h("p", "imq-error");
    const fresh = h("div");
    const list = h("ul", "imq-people");
    const form = h("form", "imq-mint");
    const name = h("input") as HTMLInputElement;
    name.placeholder = "Name — e.g. Asha";
    name.maxLength = 40;
    name.required = true;
    const days = h("select") as HTMLSelectElement;
    for (const d of [30, 7, 90]) {
      const o = h("option", undefined, `Link lasts ${d} days`) as HTMLOptionElement;
      o.value = String(d);
      days.append(o);
    }
    const site = h("input", "wide") as HTMLInputElement;
    site.placeholder = "Site the link opens (default: this one) — e.g. https://pebblebeachvizag.com";
    const submit = h("button", "wide", "Create link") as HTMLButtonElement;
    submit.type = "submit";
    form.append(name, days, site, submit);
    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      err.textContent = "";
      let origin = location.origin;
      const sites: string[] = [];
      if (site.value.trim()) {
        try {
          const u = new URL(site.value.trim());
          origin = u.origin;
          sites.push(u.hostname);
        } catch {
          err.textContent = "That site address isn't a full URL.";
          submit.disabled = false;
          return;
        }
      }
      const { res, data } = await api("/reviewers", { method: "POST", json: { name: name.value.trim(), days: Number(days.value), sites } });
      submit.disabled = false;
      if (!res.ok) {
        err.textContent = String(data.error || res.status);
        return;
      }
      const url = `${origin}/?imredline=${data.token}`;
      fresh.replaceChildren();
      const box = h("div", "imq-fresh");
      box.append(h("strong", undefined, `Review link for ${String(data.name)} — copy it now, it isn't shown again.`));
      box.append(h("code", undefined, url));
      const copy = h("button", undefined, "Copy") as HTMLButtonElement;
      copy.type = "button";
      copy.onclick = () => void navigator.clipboard.writeText(url).then(() => (copy.textContent = "Copied"));
      box.append(copy, h("p", undefined, `They open it once. The 🛠 button then appears on every page in that browser until ${fmtDate(String(data.expiresAt))}.`));
      fresh.append(box);
      name.value = "";
      site.value = "";
      void load();
    };
    panel.append(err, fresh, list, form);
    sec.append(head, panel);
    manage.onclick = () => {
      panel.hidden = !panel.hidden;
      manage.textContent = panel.hidden ? "Manage" : "Hide";
    };

    async function load() {
      const { res, data } = await api("/reviewers");
      if (!res.ok) return;
      const people = (data.reviewers as Reviewer[]) || [];
      count.textContent = `${people.filter((p) => p.active).length} active · a link works in one browser until it expires or is revoked`;
      list.replaceChildren(
        ...people.map((p) => {
          const li = h("li");
          li.append(h("strong", undefined, p.name));
          if (p.source === "env") li.append(h("small", undefined, "from env — revoke in IMREDLINE_REVIEWERS"));
          else {
            li.append(
              h(
                "small",
                undefined,
                `${p.active ? "expires" : "EXPIRED"} ${fmtDate(p.expiresAt)} · last used ${fmtDate(p.lastUsedAt)}${p.sites.length ? " · " + p.sites.join(", ") : ""}`,
              ),
            );
            const rv = h("button", "imq-revoke", "Revoke") as HTMLButtonElement;
            rv.type = "button";
            rv.onclick = async () => {
              if (rv.dataset.confirm !== "1") {
                rv.dataset.confirm = "1";
                rv.textContent = "Confirm revoke";
                return;
              }
              const { res: r2, data: d2 } = await api(`/reviewers?id=${p.id}`, { method: "DELETE" });
              if (r2.ok) void load();
              else err.textContent = `${p.name}: ${d2.error || r2.status} — still active.`;
            };
            li.append(rv);
          }
          return li;
        }),
      );
    }
    void load();
    return sec;
  }

  async function boot() {
    /* A ?token= arms this browser so the bare URL works next time. */
    if (token) await api("/session", { method: "POST", json: { token } }).catch(() => undefined);
    const { res, data } = await api("/queue");
    if (res.status === 401) return gate("Open this page with your review link once (or with ?token=<your token>); after that the bare address works in this browser.");
    root!.replaceChildren();
    root!.append(h("h1", undefined, "Review queue"));
    subEl = h("p", "imq-sub");
    root!.append(subEl);
    admin = Boolean(data.admin);
    if (!res.ok) {
      subEl.textContent = String(data.error || `GitHub returned ${res.status}.`);
      if (admin) root!.append(adminPanel());
      return;
    }
    rows = data.rows as QueueRow[];
    repo = String(data.repo || "");
    clipsRepo = repo;
    if (rows.some((r) => r.inspiration)) {
      try {
        const clips = await api("/clips");
        if (clips.res.ok && typeof clips.data.repo === "string") clipsRepo = clips.data.repo;
      } catch { /* Report cards still render when the clip list is unavailable. */ }
    }
    for (const w of (data.warnings as string[]) || []) root!.append(h("p", "imq-warn", w));
    const filters = h("div", "imq-filters");
    const status = h("select") as HTMLSelectElement;
    for (const [v, t] of [
      ["open", "Open"],
      ["done", "Done"],
      ["discarded", "Discarded"],
      ["all", "All"],
    ]) {
      const o = h("option", undefined, t) as HTMLOptionElement;
      o.value = v!;
      status.append(o);
    }
    status.onchange = () => {
      filter.status = status.value;
      render();
    };
    const type = h("select") as HTMLSelectElement;
    for (const [v, t] of [
      ["", "All types"],
      ["bug", "Bug"],
      ["change", "Change"],
      ["idea", "Idea"],
    ]) {
      const o = h("option", undefined, t) as HTMLOptionElement;
      o.value = v!;
      type.append(o);
    }
    type.onchange = () => {
      filter.type = type.value;
      render();
    };
    const q = h("input") as HTMLInputElement;
    q.type = "search";
    q.placeholder = "Find a note, page, name or #";
    q.oninput = () => {
      filter.q = q.value.trim().toLowerCase();
      render();
    };
    const repoLink = h("a", undefined, repo) as HTMLAnchorElement;
    repoLink.href = `https://github.com/${repo}/issues?q=label%3Atester-feedback`;
    repoLink.target = "_blank";
    repoLink.rel = "noreferrer";
    filters.append(status, type, q, repoLink);
    root!.append(filters);
    errorEl = h("p", "imq-error");
    root!.append(errorEl);
    listEl = h("div", "imq-list");
    root!.append(listEl);
    render();
    if (admin) root!.append(adminPanel());
  }
  void boot();
})();
