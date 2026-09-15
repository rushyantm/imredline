/*
  The clips gallery client. Reads <base>/api/clips, renders cards (screenshot,
  name, collection, host, swatches, fonts), filters by collection and host,
  and opens one clip: README rendered, preview.html in a sandboxed iframe,
  buttons to copy the HTML, the CSS or the prompt.

  Auth: any reviewer cookie, or ?token= on the URL (which also arms this
  browser). Read-only for everyone — a clip is not work, there is nothing
  to flip. The bookmarklet appears only when the server says the owner
  switched it on (IMREDLINE_CLIP_ORIGINS=*).
*/

import type { ClipIndexEntry } from "../core/types.js";

(function main() {
  const root = document.getElementById("imc");
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
  const fileUrl = (p: string) => `${API}/clip-asset?path=${encodeURIComponent(p)}${auth("&")}`;
  async function fileText(p: string): Promise<string | null> {
    try {
      const res = await fetch(fileUrl(p), { credentials: "same-origin" });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  let clips: ClipIndexEntry[] = [];
  let repo = "";
  let branch = "";
  const filter = { collection: "", host: "", q: "" };

  function gate(msg: string) {
    root!.replaceChildren(h("div", "imc-gate"));
    root!.firstElementChild!.append(h("h1", undefined, "Clips"), h("p", "imc-sub", msg));
  }

  function card(c: ClipIndexEntry): HTMLElement {
    const b = h("button", "imc-card") as HTMLButtonElement;
    b.type = "button";
    if (c.screenshot) {
      const img = h("img") as HTMLImageElement;
      img.src = fileUrl(c.screenshot);
      img.alt = `${c.name} from ${c.source.host}`;
      img.loading = "lazy";
      b.append(img);
    } else b.append(h("div", "imc-noshot", "no screenshot"));
    const body = h("div", "imc-card-body");
    body.append(h("div", "imc-name", `${c.collection}/${c.slug}`));
    body.append(h("div", "imc-meta", `${c.source.host} · ${fmtDate(c.clippedAt)} · ${c.bounds[0]}×${c.bounds[1]}${c.device ? " · " + c.device.split(" · ")[0] : ""}`));
    if (c.colors.length) {
      const sw = h("div", "imc-swatches");
      for (const col of c.colors.slice(0, 6)) {
        const s = h("span", "imc-swatch");
        s.style.background = col;
        s.title = col;
        sw.append(s);
      }
      body.append(sw);
    }
    if (c.fonts.length) body.append(h("div", "imc-fonts", c.fonts.join(" · ")));
    if (c.states === "partial") body.append(h("span", "imc-chip imc-chip--warn", "states partial"));
    if (c.audited) body.append(h("span", "imc-chip imc-chip--good", "audited"));
    b.append(body);
    b.onclick = () => void openClip(c);
    return b;
  }

  /* A very small Markdown renderer: enough for the README this package
     writes (headings, blockquote, lists, tables, inline code, bold). */
  function renderMd(md: string): HTMLElement {
    const out = h("div", "imc-readme");
    const inline = (s: string): (string | HTMLElement)[] => {
      const parts: (string | HTMLElement)[] = [];
      const re = /`([^`]+)`|\*\*([^*]+)\*\*|(https?:\/\/[^\s)<>]+)/g;
      let last = 0;
      for (const m of s.matchAll(re)) {
        if (m.index! > last) parts.push(s.slice(last, m.index));
        if (m[1]) parts.push(h("code", undefined, m[1]));
        else if (m[2]) parts.push(h("strong", undefined, m[2]));
        else if (m[3]) {
          const a = h("a", undefined, m[3]) as HTMLAnchorElement;
          a.href = m[3];
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          parts.push(a);
        }
        last = m.index! + m[0].length;
      }
      if (last < s.length) parts.push(s.slice(last));
      return parts;
    };
    const lines = md.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      if (!line.trim()) {
        i++;
        continue;
      }
      const hm = /^(#{1,3})\s+(.*)$/.exec(line);
      if (hm) {
        const tag = (`h${hm[1]!.length}`) as "h1" | "h2" | "h3";
        const el = h(tag);
        el.append(...inline(hm[2]!));
        out.append(el);
        i++;
        continue;
      }
      if (line.startsWith("> ")) {
        const q = h("blockquote");
        q.append(...inline(line.slice(2)));
        out.append(q);
        i++;
        continue;
      }
      if (line.startsWith("|")) {
        const table = h("table");
        let first = true;
        while (i < lines.length && lines[i]!.startsWith("|")) {
          const row = lines[i]!;
          i++;
          if (/^\|\s*-+/.test(row)) continue;
          const tr = h("tr");
          for (const cell of row.replace(/^\||\|$/g, "").split(/(?<!\\)\|/)) {
            const td = h(first ? "th" : "td");
            td.append(...inline(cell.trim().replace(/\\\|/g, "|")));
            tr.append(td);
          }
          table.append(tr);
          first = false;
        }
        out.append(table);
        continue;
      }
      if (/^(-|\d+\.)\s/.test(line)) {
        const ordered = /^\d+\./.test(line);
        const list = h(ordered ? "ol" : "ul");
        while (i < lines.length && /^(-|\d+\.)\s/.test(lines[i]!)) {
          const li = h("li");
          li.append(...inline(lines[i]!.replace(/^(-|\d+\.)\s/, "")));
          list.append(li);
          i++;
        }
        out.append(list);
        continue;
      }
      const p = h("p");
      p.append(...inline(line));
      out.append(p);
      i++;
    }
    return out;
  }

  let listEl: HTMLElement | null = null;
  let subEl: HTMLElement | null = null;
  let filtersEl: HTMLElement | null = null;
  let detailEl: HTMLElement | null = null;

  async function openClip(c: ClipIndexEntry) {
    if (!detailEl) return;
    listEl!.hidden = true;
    filtersEl!.hidden = true;
    detailEl.hidden = false;
    detailEl.replaceChildren();
    const back = h("button", "imc-back", "← All clips") as HTMLButtonElement;
    back.type = "button";
    back.onclick = () => {
      detailEl!.hidden = true;
      listEl!.hidden = false;
      filtersEl!.hidden = false;
      history.replaceState({}, "", location.pathname + (token ? `?token=${encodeURIComponent(token)}` : ""));
    };
    detailEl.append(back, h("h2", undefined, `${c.collection}/${c.slug}`));
    const src = h("p", "imc-meta");
    const a = h("a", undefined, c.source.url) as HTMLAnchorElement;
    a.href = c.source.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    src.append("from ", a, ` · ${fmtDate(c.clippedAt)} by ${c.reviewer}${c.viewport ? " · " + c.viewport : ""}`);
    detailEl.append(src);
    const actions = h("div", "imc-actions");
    const err = h("p", "imc-error");
    const copyBtn = (label: string, file: string) => {
      const b = h("button", undefined, label) as HTMLButtonElement;
      b.type = "button";
      b.onclick = async () => {
        const text = await fileText(`${c.path}/${file}`);
        if (text == null) {
          err.textContent = `Could not load ${file}.`;
          return;
        }
        try {
          await navigator.clipboard.writeText(text);
          b.textContent = "Copied";
          setTimeout(() => (b.textContent = label), 1500);
        } catch {
          err.textContent = "The browser refused the clipboard — open the file and copy from there.";
        }
      };
      return b;
    };
    actions.append(copyBtn("Copy prompt", "README.md"), copyBtn("Copy HTML", "component.html"), copyBtn("Copy CSS", "component.css"), copyBtn("Copy tokens", "tokens.json"));
    if (c.audited) actions.append(copyBtn("Copy audit", "audit.md"));
    const gh = h("a", "imc-ghost", "Open on GitHub") as HTMLAnchorElement;
    gh.href = `https://github.com/${repo}/tree/${branch}/${c.path}`;
    gh.target = "_blank";
    gh.rel = "noreferrer";
    actions.append(gh);
    detailEl.append(actions, err);

    /* The preview: fetched as text, rendered in a sandbox with no scripts
       and no origin — a clipped page can never touch this one. */
    const frame = h("iframe", "imc-frame") as HTMLIFrameElement;
    frame.setAttribute("sandbox", "");
    frame.setAttribute("title", "preview");
    frame.setAttribute("loading", "lazy");
    detailEl.append(frame);
    const preview = await fileText(`${c.path}/preview.html`);
    frame.srcdoc = preview ?? "<p style='font:14px system-ui;padding:20px'>preview.html could not be loaded.</p>";
    if (c.screenshot) {
      const img = h("img", "imc-shot") as HTMLImageElement;
      img.src = fileUrl(c.screenshot);
      img.alt = "screenshot at capture time";
      detailEl.append(img);
    }
    const readme = await fileText(`${c.path}/README.md`);
    detailEl.append(readme ? renderMd(readme) : h("p", "imc-error", "README.md could not be loaded."));
    if (c.audited) {
      const audit = await fileText(`${c.path}/audit.md`);
      if (audit) {
        const box = renderMd(audit);
        box.classList.add("imc-audit");
        detailEl.append(box);
      }
    }
    history.replaceState({}, "", `${location.pathname}?clip=${encodeURIComponent(c.path)}${token ? `&token=${encodeURIComponent(token)}` : ""}`);
  }

  function render() {
    if (!listEl || !subEl) return;
    const shown = clips.filter(
      (c) =>
        (!filter.collection || c.collection === filter.collection) &&
        (!filter.host || c.source.host === filter.host) &&
        (!filter.q || `${c.name} ${c.slug} ${c.collection} ${c.note} ${c.source.host} ${c.source.title} ${c.fonts.join(" ")} ${c.reviewer}${c.audited ? " audited" : ""}`.toLowerCase().includes(filter.q)),
    );
    subEl.textContent = `${clips.length} clip${clips.length === 1 ? "" : "s"} on ${repo} · ${branch}. Every folder has the markup, the CSS, a token sheet and a README written as a prompt.`;
    listEl.replaceChildren(...(shown.length ? shown.map(card) : [h("p", "imc-empty", clips.length ? "Nothing matches this filter." : "No clips yet. On any site with the widget, press ✂ Clip and click a component.")]));
  }

  function bookmarklet(host: string, tok: string): HTMLElement {
    const sec = h("section", "imc-book");
    sec.append(h("h2", undefined, "Clip from any site"));
    sec.append(h("p", undefined, "Drag this to your bookmarks bar. On any page, click it: the ✂ Clip button appears, gated by your own review link. Sites with a strict Content-Security-Policy (Linear, Apple, Stripe…) refuse outside scripts; you get a message instead of the button."));
    const a = h("a", "imc-drag", "✂ IMRedline Clip") as HTMLAnchorElement;
    const js = `(()=>{var s=document.createElement('script');s.src=${JSON.stringify(host + BASE + "/widget.js")};s.dataset.host=${JSON.stringify(host)};s.dataset.base=${JSON.stringify(BASE)};s.dataset.token=${JSON.stringify(tok)};s.onerror=function(){alert('This site blocks outside scripts (Content-Security-Policy), so IMRedline cannot run here. Ask Claude to clip it by address instead.')};document.head.appendChild(s)})()`;
    a.href = "javascript:" + encodeURIComponent(js);
    a.onclick = (e) => e.preventDefault();
    sec.append(a);
    sec.append(h("p", undefined, "The bookmarklet carries your review token, the same secret your review link does. Treat it the same way."));
    return sec;
  }

  async function boot() {
    if (token) await api("/session", { method: "POST", json: { token } }).catch(() => undefined);
    const { res, data } = await api("/clips");
    if (res.status === 401) return gate("Open this page with your review link once (or with ?token=<your token>); after that the bare address works in this browser.");
    root!.replaceChildren();
    const head = h("div", "imc-head");
    head.append(h("h1", undefined, "Clips"));
    const q = h("a", undefined, "Review queue →") as HTMLAnchorElement;
    q.href = BASE + "/queue" + auth("?");
    head.append(q);
    root!.append(head);
    subEl = h("p", "imc-sub");
    root!.append(subEl);
    if (!res.ok) {
      subEl.textContent = String(data.error || `GitHub returned ${res.status}.`);
      return;
    }
    clips = (data.clips as ClipIndexEntry[]) || [];
    repo = String(data.repo || "");
    branch = String(data.branch || "imredline-clips");
    filtersEl = h("div", "imc-filters");
    const coll = h("select") as HTMLSelectElement;
    const hosts = h("select") as HTMLSelectElement;
    const opt = (sel: HTMLSelectElement, v: string, t: string) => {
      const o = h("option", undefined, t) as HTMLOptionElement;
      o.value = v;
      sel.append(o);
    };
    opt(coll, "", "All collections");
    for (const c of Array.from(new Set(clips.map((c) => c.collection))).sort()) opt(coll, c, c);
    opt(hosts, "", "All sites");
    for (const hst of Array.from(new Set(clips.map((c) => c.source.host))).sort()) opt(hosts, hst, hst);
    coll.onchange = () => {
      filter.collection = coll.value;
      render();
    };
    hosts.onchange = () => {
      filter.host = hosts.value;
      render();
    };
    const search = h("input") as HTMLInputElement;
    search.type = "search";
    search.placeholder = "Find a name, site, font or note";
    search.oninput = () => {
      filter.q = search.value.trim().toLowerCase();
      render();
    };
    filtersEl.append(coll, hosts, search);
    root!.append(filtersEl);
    listEl = h("div", "imc-grid");
    detailEl = h("div", "imc-detail");
    detailEl.hidden = true;
    root!.append(listEl, detailEl);
    render();
    if (data.bookmarklet && typeof data.token === "string" && data.token) root!.append(bookmarklet(location.origin, data.token));
    const want = params.get("clip");
    const hit = want ? clips.find((c) => c.path === want) : null;
    if (hit) void openClip(hit);
  }
  void boot();
})();
