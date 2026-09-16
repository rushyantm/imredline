/*
  The IMRedline widget. One script tag on any site:

    <script src="/imredline/widget.js" defer></script>                same-origin
    <script src="https://host/imredline/widget.js" defer
            data-host="https://host"></script>                         third-party (PEMA mode)

  Nothing renders for an ordinary visitor. A reviewer opens ?imredline=<token>
  once; the server validates it and (same-origin) sets a year-long cookie, or
  (third-party) the token is kept in localStorage and re-validated on every
  page load. Either way the invariant holds: if the button is visible, Send
  will work.

  States: off → armed (overlay follows the cursor, next click is the pin)
          → pinned (dialog; the screenshot is taken in the background the
          moment the pin lands, never holding up typing) → send.
  Esc leaves any state. The capture engine is loaded only for a recognised
  reviewer, so a visitor never downloads it.

  Two tools share that machinery (0.5.0): 🛠 Review files a report; ✂ Clip
  captures a component for inspiration (see ../clip/extract.ts). Same arm,
  same overlay, same pin; a different dialog. A bookmarklet passes the token
  on the script tag (`data-token`) for sites nobody controls.
*/

import { capture, elementUnder, selectorFor } from "../capture/index.js";
import { extractClip, suggestName, type ExtractResult } from "../clip/extract.js";
import { DEFAULT_TYPE, NOTE_MAX, NOTE_MIN, type ClipIndexEntry, type Device, type ReportInput, type ReportType, type Sample } from "../core/types.js";
import { classifyDevice, deviceIcon, nextKind } from "./device.js";
import { canAdd, classifyAddress, sampleImage, withTimeout } from "./samples.js";
import { CSS } from "./styles.js";

type Html2Canvas = (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;
declare global {
  interface Window {
    __imredline?: boolean;
    html2canvas?: Html2Canvas | { default: Html2Canvas };
  }
}

(function main() {
  if (typeof window === "undefined" || window.__imredline) return; // GTM double-fire guard
  window.__imredline = true;

  /* ── config from the script tag ── */
  const me = document.currentScript as HTMLScriptElement | null;
  const src = me?.src ? new URL(me.src, location.href) : null;
  const HOST = (me?.dataset.host || src?.origin || location.origin).replace(/\/+$/, "");
  const BASE = (me?.dataset.base || (src ? src.pathname.replace(/\/widget\.js$/, "") : "/imredline")).replace(/\/+$/, "");
  const API = HOST + BASE + "/api";
  const CROSS = HOST !== location.origin;
  /* Comma list, first is canonical. A site migrating from an older widget
     keeps its testers' existing `?review=` links alive by listing it too. */
  const PARAMS = (me?.dataset.param || "imredline").split(",").map((s) => s.trim()).filter(Boolean);
  const KEY = "imredline_token";
  const HINT = "imredline_on=1";

  const TYPES: { id: ReportType; label: string; hint: string }[] = [
    { id: "bug", label: "Bug", hint: "Broken — e.g. “the form doesn’t send.”" },
    { id: "change", label: "Change", hint: "Works, but should be different — a photo, a word, a number, a layout." },
    { id: "idea", label: "Idea", hint: "Something new — e.g. “add a brochure download here.”" },
  ];

  type Access = { name: string; admin: boolean; maskForms: boolean };
  const state = {
    access: null as Access | null,
    token: null as string | null,
    mode: "off" as "off" | "armed" | "pinned",
    tool: "review" as "review" | "clip",
    sending: false,
    samplesBusy: false,
  };
  type Draft = {
    requestId: string;
    type: ReportType;
    device: Device;
    selector: string;
    viewport: { width: number; height: number; dpr: number };
    shot: string | null;
    shotError: string;
    shotNote: string;
    samples: Sample[];
    inspiration: ReportInput["inspiration"];
    inspirationWork: Promise<void>;
    inspirationError: string;
    anchor: { x: number; y: number } | null;
  };
  let draft: Draft | null = null;
  type ClipDraft = {
    requestId: string;
    el: Element;
    /** What was clicked; Narrow walks back down towards it. */
    deepest: Element;
    narrowStack: Element[];
    device: Device;
    viewport: { width: number; height: number; dpr: number };
    shot: string | null;
    shotError: string;
    extract: ExtractResult | null;
    extractError: string;
    anchor: { x: number; y: number } | null;
  };
  let clipDraft: ClipDraft | null = null;
  let shotWork: Promise<void> = Promise.resolve();
  let version = 0;
  let hoverEl: Element | null = null;
  let styleEl: HTMLStyleElement | null = null;
  const els: Partial<Record<"bar" | "launch" | "clip" | "overlay" | "highlight" | "dialog" | "toast", HTMLElement>> = {};

  /* ── helpers ── */
  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    el.setAttribute("data-imredline-ui", "");
    return el;
  };
  const isUi = (n: Element | null) => Boolean(n && n.closest("[data-imredline-ui]"));
  /* The overlay itself is UI, and every click while armed lands ON it — so
     "is this click on our chrome" must mean the bar, the dialog or a toast,
     never the overlay. (First run of the e2e test: no pin ever fired.) */
  const isChrome = (n: Element | null) => Boolean(n && n.closest(".imr-bar, .imr-dialog, .imr-toast"));
  function styles() {
    if (styleEl) return;
    styleEl = document.createElement("style");
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
  }
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function toast(msg: string, copyLink?: string) {
    styles();
    els.toast?.remove();
    const t = h("div", "imr-toast", msg);
    t.setAttribute("role", "status");
    if (copyLink) {
      const copy = h("button", "imr-copy", "Copy link");
      copy.type = "button";
      copy.onclick = async () => {
        clearTimeout(toastTimer);
        try {
          await navigator.clipboard.writeText(copyLink);
          copy.textContent = "Copied";
          toastTimer = setTimeout(() => t.remove(), 6000);
        } catch {
          /* Clipboard access can be denied on the page being clipped. Keep
             the selected text visible so the reviewer can copy it by hand. */
          const text = h("input", "imr-copy-text");
          text.value = copyLink;
          text.readOnly = true;
          text.setAttribute("aria-label", "Clip link — copy this text");
          copy.replaceWith(text);
          text.focus();
          text.select();
        }
      };
      t.append(copy);
    }
    document.body.appendChild(t);
    els.toast = t;
    clearTimeout(toastTimer);
    /* 6s: this also carries "your link is dead", an instruction, not a receipt. */
    toastTimer = setTimeout(() => {
      t.remove();
      if (els.toast === t) delete els.toast;
    }, 6000);
  }
  async function api(path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ res: Response; data: Record<string, unknown> }> {
    const res = await fetch(API + path, {
      ...init,
      headers: { "Content-Type": "application/json" },
      body: init.json !== undefined ? JSON.stringify(init.json) : (init.body ?? null),
      credentials: CROSS ? "omit" : "same-origin",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, data };
  }
  const uuid = () =>
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 3) | 8).toString(16);
        });

  /* ── capture library: served by the host, loaded at pin time only ── */
  let libPromise: Promise<Html2Canvas> | null = null;
  function loadLibrary(): Promise<Html2Canvas> {
    const g = window.html2canvas;
    const fn = g && (typeof g === "function" ? g : g.default);
    if (fn) return Promise.resolve(fn);
    return (libPromise ||= new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = HOST + BASE + "/html2canvas.js";
      s.onload = () => {
        const g2 = window.html2canvas;
        const f2 = g2 && (typeof g2 === "function" ? g2 : g2.default);
        f2 ? ok(f2) : bad(new Error("screenshot library loaded but exposed nothing"));
      };
      s.onerror = () => {
        s.remove();
        libPromise = null;
        bad(new Error("could not load the screenshot library"));
      };
      document.head.appendChild(s);
    }));
  }

  /* ── arming ── */
  function disarm() {
    state.mode = "off";
    hoverEl = null;
    version++;
    draft = null;
    clipDraft = null;
    cui = null;
    els.overlay?.remove();
    els.highlight?.remove();
    delete els.overlay;
    delete els.highlight;
    if (els.dialog) {
      (els.dialog as HTMLDialogElement).close();
      els.dialog.remove();
      delete els.dialog;
    }
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onPinClick, true);
    document.removeEventListener("focusin", onFocus, true);
    document.removeEventListener("keydown", onPickKey, true);
    if (els.launch) {
      els.launch.textContent = "🛠 Review";
      els.launch.setAttribute("aria-pressed", "false");
    }
    if (els.clip) {
      els.clip.textContent = "✂ Clip";
      els.clip.setAttribute("aria-pressed", "false");
    }
  }

  function under(x: number, y: number): Element | null {
    return elementUnder(x, y, els.overlay ?? null);
  }
  function outline(el: Element | null) {
    if (!el || isUi(el)) return;
    hoverEl = el;
    if (!els.highlight) {
      els.highlight = h("div", "imr-highlight");
      document.body.appendChild(els.highlight);
    }
    const r = el.getBoundingClientRect();
    Object.assign(els.highlight.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  }
  function onMove(e: MouseEvent) {
    outline(under(e.clientX, e.clientY));
  }
  function onFocus(e: FocusEvent) {
    outline(e.target as Element);
  }
  function onPinClick(e: MouseEvent) {
    if (isChrome(e.target as Element)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = under(e.clientX, e.clientY) ?? hoverEl;
    pin(el, { x: e.clientX, y: e.clientY });
  }
  /* Keyboard picking (Aradea): Tab to a thing, Enter or Space pins it. */
  function onPickKey(e: KeyboardEvent) {
    if (state.mode !== "armed") return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      disarm();
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && document.activeElement && document.activeElement !== document.body && !isUi(document.activeElement)) {
      e.preventDefault();
      e.stopPropagation();
      const r = document.activeElement.getBoundingClientRect();
      pin(document.activeElement, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
  }
  function arm(tool: "review" | "clip" = "review") {
    if (!state.access) return;
    if (state.mode !== "off") disarm();
    state.mode = "armed";
    state.tool = tool;
    const btn = tool === "clip" ? els.clip! : els.launch!;
    btn.textContent = tool === "clip" ? "✕ Exit clip" : "✕ Exit review";
    btn.setAttribute("aria-pressed", "true");
    const o = h("div", "imr-overlay");
    if (tool === "clip") o.classList.add("imr-overlay--clip");
    o.setAttribute("aria-hidden", "true");
    const banner = h("div", "imr-banner");
    banner.append(
      tool === "clip" ? "Clip mode — click a component to capture it · " : "Review mode — click anything to report it · ",
      h("kbd", undefined, "Esc"),
      " to exit",
    );
    o.appendChild(banner);
    document.body.appendChild(o);
    els.overlay = o;
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onPinClick, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("keydown", onPickKey, true);
  }

  /* ── the pin → dialog ── */
  function pin(el: Element | null, anchor: { x: number; y: number }) {
    if (state.tool === "clip") return pinClip(el, anchor);
    state.mode = "pinned";
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onPinClick, true);
    document.removeEventListener("focusin", onFocus, true);
    document.removeEventListener("keydown", onPickKey, true);
    els.overlay?.remove();
    els.highlight?.remove();
    delete els.overlay;
    delete els.highlight;

    const v = ++version;
    draft = {
      requestId: uuid(),
      type: DEFAULT_TYPE,
      device: classifyDevice(),
      selector: el ? selectorFor(el) : "",
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      shot: null,
      shotError: "",
      shotNote: "",
      samples: [],
      inspiration: undefined,
      inspirationWork: Promise.resolve(),
      inspirationError: "",
      anchor,
    };
    const d = draft;
    openDialog(d);

    /* The dialog opens first. Capture runs behind it and never holds up
       typing; Send waits for it. Everything tagged data-imredline-ui is left
       out of the picture. */
    shotWork = (async () => {
      try {
        const r = await capture(el, {
          loadLibrary,
          maskForms: Boolean(state.access?.maskForms),
        });
        if (v !== version) return;
        d.shot = r.dataUrl;
        d.shotError = r.error || "";
        d.shotNote = r.note || "";
      } catch (e) {
        if (v !== version) return;
        d.shotError = (e instanceof Error && e.message) || "capture failed";
      } finally {
        if (v === version) renderShot(d);
      }
    })();
  }

  let ui: {
    dialog: HTMLDialogElement;
    note: HTMLTextAreaElement;
    send: HTMLButtonElement;
    status: HTMLElement;
    shot: HTMLElement;
    list: HTMLElement;
    sampleStatus: HTMLElement;
    address: HTMLInputElement;
    file: HTMLInputElement;
    upload: HTMLButtonElement;
    addAddr: HTMLButtonElement;
    deviceChip: HTMLButtonElement;
    hint: HTMLElement;
    types: HTMLButtonElement[];
    inspiration: HTMLFieldSetElement;
  } | null = null;

  const clipLink = (path: string) => `${HOST}${BASE}/clips?clip=${path}`;
  const clipAuth = () => CROSS && state.token ? `&token=${encodeURIComponent(state.token)}` : "";

  function inspirationRow(d: Draft): HTMLFieldSetElement {
    const row = h("fieldset", "imr-insp");
    row.append(h("legend", undefined, "Inspiration (optional)"));
    const list = h("select", "imr-insp-list");
    list.setAttribute("aria-label", "Choose inspiration");
    list.hidden = true;
    const empty = h("option", undefined, "Choose a clip…");
    empty.value = "";
    list.append(empty);
    const paste = h("input", "imr-insp-paste");
    paste.type = "text";
    paste.placeholder = "or paste a clip link";
    paste.setAttribute("aria-label", "or paste a clip link");
    paste.maxLength = 500;
    const preview = h("div", "imr-insp-preview");
    const clear = h("button", "imr-insp-clear", "Clear");
    clear.type = "button";
    clear.hidden = true;
    const status = h("p", "imr-insp-status");
    status.setAttribute("role", "status");
    row.append(list, paste, preview, clear, status);
    let clips: ClipIndexEntry[] = [];
    let repo = "";
    let revision = 0;

    const show = (path?: string) => {
      preview.replaceChildren();
      if (path) {
        const img = h("img", "imr-insp-thumb");
        img.src = `${API}/clip-asset?path=${encodeURIComponent(path + "/screenshot.jpg")}${clipAuth()}`;
        img.alt = "Inspiration screenshot";
        img.onerror = () => { img.remove(); place(); };
        preview.append(img);
      }
      clear.hidden = !d.inspiration && !paste.value;
      status.textContent = d.inspirationError;
      place();
    };
    clear.onclick = () => {
      revision++;
      d.inspiration = undefined;
      d.inspirationError = "";
      d.inspirationWork = Promise.resolve();
      paste.value = "";
      list.value = "";
      show();
    };
    list.onchange = () => {
      revision++;
      paste.value = "";
      d.inspirationError = "";
      d.inspirationWork = Promise.resolve();
      const clip = clips.find((c) => c.path === list.value);
      d.inspiration = clip ? { path: clip.path, ...(repo ? { repo } : {}), url: clipLink(clip.path) } : undefined;
      show(clip?.screenshot ? clip.path : undefined);
    };
    const readPaste = async () => {
      const rev = ++revision;
      list.value = "";
      d.inspiration = undefined;
      d.inspirationError = "";
      const value = paste.value.trim();
      if (!value) return show();
      let link: URL;
      let path: string;
      try {
        link = new URL(value);
        path = link.searchParams.get("clip") || "";
        if (!["http:", "https:"].includes(link.protocol) || !/\/clips\/?$/.test(link.pathname) ||
          !/^clips\/[a-z0-9][a-z0-9-]{0,39}\/[a-z0-9][a-z0-9-]{0,49}$/.test(path)) throw new Error();
      } catch {
        d.inspirationError = "Paste a gallery link with ?clip=clips/collection/name-01.";
        return show();
      }
      const local = link.origin === HOST && link.pathname.replace(/\/$/, "") === BASE + "/clips";
      d.inspiration = { path, url: value, ...(local && repo ? { repo } : {}) };
      show(local ? path : undefined);
      if (local) return;
      /* Ask only the pasted host, using its own cookies. Never forward this
         site's reviewer token to another site's API. CORS may refuse it. */
      const endpoint = new URL(link.pathname.replace(/\/clips\/?$/, "/api/clips"), link.origin);
      try {
        const res = await fetch(endpoint, { credentials: "include", signal: AbortSignal.timeout(4000) });
        const data: { repo?: unknown } = res.ok ? await res.json() : {};
        if (rev !== revision || draft !== d) return;
        if (typeof data.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(data.repo)) {
          d.inspiration = { path, url: value, repo: data.repo };
        }
      } catch { /* The pasted link survives when the other host cannot answer. */ }
    };
    paste.oninput = () => { d.inspirationWork = readPaste(); };
    paste.onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };

    void (async () => {
      try {
        const { res, data } = await api("/clips" + (CROSS && state.token ? `?token=${encodeURIComponent(state.token)}` : ""), { signal: AbortSignal.timeout(4000) });
        if (!res.ok || !Array.isArray(data.clips) || draft !== d) return;
        repo = typeof data.repo === "string" ? data.repo : "";
        clips = (data.clips as ClipIndexEntry[]).slice().sort((a, b) => b.clippedAt.localeCompare(a.clippedAt)).slice(0, 20);
        for (const clip of clips) {
          const date = new Date(clip.clippedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
          const opt = h("option", undefined, `${clip.name} · ${clip.collection} · ${clip.source.host} · ${date}`);
          opt.value = clip.path;
          list.append(opt);
        }
        list.hidden = !clips.length;
        place();
      } catch { /* With no list, the paste box is still useful. */ }
    })();
    return row;
  }

  function openDialog(d: Draft) {
    styles();
    const dialog = h("dialog", "imr-dialog") as HTMLDialogElement;
    dialog.setAttribute("aria-label", "Report this");
    const form = h("form", "imr-form");
    form.noValidate = true;

    const head = h("div", "imr-head");
    head.append(h("span", undefined, "Report this"));
    const x = h("button", "imr-x", "×") as HTMLButtonElement;
    x.type = "button";
    x.setAttribute("aria-label", "Cancel");
    x.onclick = () => cancel();
    head.append(x);

    const types = h("div", "imr-types");
    types.setAttribute("role", "radiogroup");
    const hint = h("p", "imr-hint");
    const typeBtns: HTMLButtonElement[] = TYPES.map((t) => {
      const b = h("button", "imr-type", t.label) as HTMLButtonElement;
      b.type = "button";
      b.setAttribute("role", "radio");
      b.onclick = () => {
        d.type = t.id;
        syncTypes();
      };
      types.append(b);
      return b;
    });
    const syncTypes = () => {
      typeBtns.forEach((b, i) => b.setAttribute("aria-checked", String(TYPES[i]!.id === d.type)));
      hint.textContent = TYPES.find((t) => t.id === d.type)?.hint || "";
    };

    const note = h("textarea", "imr-note") as HTMLTextAreaElement;
    note.placeholder = "What's wrong, or what would you change?";
    note.maxLength = NOTE_MAX;
    note.rows = 4;
    note.oninput = refreshSend;
    note.onkeydown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void send();
      }
    };

    /* Device chip: automatic guess, one tap flips it. */
    const row = h("div", "imr-row");
    const deviceChip = h("button", "imr-chip") as HTMLButtonElement;
    deviceChip.type = "button";
    deviceChip.title = "Which kind of screen this was seen on. Tap to change.";
    const syncDevice = () => {
      deviceChip.textContent = `${deviceIcon(d.device.kind)} ${d.device.kind} · ${d.device.orientation}`;
    };
    deviceChip.onclick = () => {
      d.device = { ...d.device, kind: nextKind(d.device.kind), corrected: true };
      syncDevice();
    };
    row.append(deviceChip);
    if (d.selector) row.append(h("span", "imr-target", "on " + d.selector));

    const shot = h("div", "imr-shot");

    /* Samples */
    const samples = h("details", "imr-samples");
    const summary = h("summary", undefined, "Attach a sample");
    const body = h("div", "imr-samples-body");
    body.append(h("p", undefined, `Show what you mean. Up to 5 samples, 3 of them images. Paste or drop a screenshot here.`));
    const addRow = h("div", "imr-add");
    const upload = h("button", "imr-small", "Add image") as HTMLButtonElement;
    upload.type = "button";
    const file = h("input") as HTMLInputElement;
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp";
    file.multiple = true;
    file.hidden = true;
    file.onchange = () => void addFiles([...(file.files || [])]);
    upload.onclick = () => file.click();
    addRow.append(upload, file);
    const addrRow = h("div", "imr-add");
    const address = h("input") as HTMLInputElement;
    address.type = "text";
    address.placeholder = "https://… or /Users/you/…";
    address.maxLength = 2048;
    address.autocomplete = "off";
    address.spellcheck = false;
    address.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addAddress();
      }
    };
    const addAddr = h("button", "imr-small", "Add") as HTMLButtonElement;
    addAddr.type = "button";
    addAddr.onclick = () => addAddress();
    addrRow.append(address, addAddr);
    const list = h("ul", "imr-list");
    list.setAttribute("aria-label", "Attached samples");
    const sampleStatus = h("p");
    sampleStatus.setAttribute("role", "status");
    body.append(addRow, addrRow, h("p", undefined, "A path saves the address only — the file itself is not uploaded."), list, sampleStatus);
    samples.append(summary, body);
    samples.ontoggle = place;
    samples.ondragover = (e) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        samples.classList.add("imr-drop");
      }
    };
    samples.ondragleave = () => samples.classList.remove("imr-drop");
    samples.ondrop = (e) => {
      samples.classList.remove("imr-drop");
      if (e.dataTransfer?.files.length) {
        e.preventDefault();
        void addFiles([...e.dataTransfer.files]);
      }
    };
    dialog.addEventListener("paste", (e) => {
      const files = [...(e.clipboardData?.items || [])]
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => Boolean(f));
      if (files.length) {
        e.preventDefault();
        samples.open = true;
        void addFiles(files);
      }
    });

    /* Honeypot */
    const hp = h("input", "imr-hp") as HTMLInputElement;
    hp.name = "website";
    hp.tabIndex = -1;
    hp.autocomplete = "off";
    hp.setAttribute("aria-hidden", "true");

    const actions = h("div", "imr-actions");
    const sendBtn = h("button", "imr-send", "Send") as HTMLButtonElement;
    sendBtn.type = "submit";
    const cancelBtn = h("button", "imr-cancel", "Cancel") as HTMLButtonElement;
    cancelBtn.type = "button";
    cancelBtn.onclick = () => cancel();
    actions.append(sendBtn, cancelBtn);
    const status = h("p", "imr-status");
    status.setAttribute("role", "status");

    const inspiration = inspirationRow(d);
    form.append(head, types, hint, note, inspiration, row, shot, samples, hp, actions, status);
    form.onsubmit = (e) => {
      e.preventDefault();
      void send();
    };
    dialog.append(form);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      cancel();
    });
    document.body.appendChild(dialog);
    els.dialog = dialog;
    ui = { dialog, note, send: sendBtn, status, shot, list, sampleStatus, address, file, upload, addAddr, deviceChip, hint, types: typeBtns, inspiration };

    syncTypes();
    syncDevice();
    renderShot(d);
    renderSamples();
    dialog.showModal();
    place();
    note.focus({ preventScroll: true });
    refreshSend();
  }

  /* Near the pin on desktop, centred on phones; respects the keyboard via
     visualViewport (Aradea). */
  function place() {
    const dlg = els.dialog as HTMLDialogElement | undefined;
    const anchor = draft?.anchor ?? clipDraft?.anchor ?? null;
    if (!dlg || !dlg.open || (!draft && !clipDraft)) return;
    const v = window.visualViewport;
    const width = v?.width || innerWidth;
    const height = v?.height || innerHeight;
    const ox = v?.offsetLeft || 0;
    const oy = v?.offsetTop || 0;
    const m = 12;
    dlg.style.maxHeight = Math.max(120, height - m * 2) + "px";
    const r = dlg.getBoundingClientRect();
    let x: number;
    let y: number;
    if (width < 700 || !anchor) {
      x = ox + (width - r.width) / 2;
      y = oy + Math.max(m, (height - r.height) / 2);
    } else {
      x = Math.max(ox + m, Math.min(anchor.x + 18, ox + width - r.width - m));
      y = Math.max(oy + m, Math.min(anchor.y + 18, oy + height - r.height - m));
    }
    dlg.style.left = Math.round(x) + "px";
    dlg.style.top = Math.round(y) + "px";
  }
  window.visualViewport?.addEventListener("resize", place);
  window.visualViewport?.addEventListener("scroll", place);
  window.addEventListener("resize", place);

  function renderShot(d: Draft) {
    if (!ui) return;
    ui.shot.replaceChildren();
    if (d.shot) {
      const img = h("img") as HTMLImageElement;
      img.src = d.shot;
      img.alt = "the selected area, marked in red";
      ui.shot.append(img, h("span", undefined, "Screenshot attached" + (d.shotNote ? " — " + d.shotNote : "")));
    } else if (d.shotError) {
      ui.shot.append(h("span", undefined, "No screenshot — " + d.shotError + ". Your note still goes."));
    } else {
      ui.shot.append(h("span", undefined, "Preparing the screenshot…"));
    }
  }

  function refreshSend() {
    if (!ui || !draft) return;
    ui.send.disabled = state.sending || state.samplesBusy || ui.note.value.trim().length < NOTE_MIN;
  }
  function sampleMsg(text: string, error = false) {
    if (!ui) return;
    ui.sampleStatus.textContent = text;
    ui.sampleStatus.style.color = error ? "#b3261e" : "";
  }
  function renderSamples() {
    if (!ui || !draft) return;
    const d = draft;
    ui.list.replaceChildren();
    for (const [i, s] of d.samples.entries()) {
      const li = h("li");
      if (s.kind === "image") {
        const img = h("img") as HTMLImageElement;
        img.src = s.data;
        img.alt = s.name;
        li.append(img);
      }
      li.append(h("span", undefined, s.kind === "image" ? s.name : `${s.kind === "link" ? "Link" : "File path"}: ${s.value}`));
      const rm = h("button", undefined, "Remove") as HTMLButtonElement;
      rm.type = "button";
      rm.setAttribute("aria-label", "Remove sample " + (i + 1));
      rm.disabled = state.sending || state.samplesBusy;
      rm.onclick = () => {
        if (state.sending || state.samplesBusy) return;
        d.samples.splice(i, 1);
        sampleMsg("Sample removed.");
        renderSamples();
      };
      li.append(rm);
      ui.list.append(li);
    }
    const n = d.samples.length;
    (ui.dialog.querySelector(".imr-samples summary") as HTMLElement).textContent = n ? `Samples (${n})` : "Attach a sample";
    ui.upload.disabled = state.sending || state.samplesBusy || Boolean(canAdd(d.samples, true));
    ui.addAddr.disabled = state.sending || state.samplesBusy || Boolean(canAdd(d.samples, false));
    refreshSend();
    place();
  }
  function addAddress(): boolean {
    if (!ui || !draft || state.sending || state.samplesBusy) return false;
    const raw = ui.address.value.trim();
    if (!raw) return true;
    try {
      const blocked = canAdd(draft.samples, false);
      if (blocked) throw new Error(blocked);
      const s = classifyAddress(raw);
      draft.samples.push(s);
      ui.address.value = "";
      sampleMsg(s.kind === "path" ? "File path added. The file itself has not been uploaded." : "Link added.");
      renderSamples();
      return true;
    } catch (e) {
      sampleMsg((e as Error).message, true);
      ui.address.focus();
      return false;
    }
  }
  async function addFiles(files: File[]) {
    if (!ui || !draft || state.sending || state.samplesBusy) return;
    const d = draft;
    const v = version;
    state.samplesBusy = true;
    renderSamples();
    sampleMsg("Preparing the image…");
    try {
      for (const f of files) {
        if (v !== version) return;
        const blocked = canAdd(d.samples, true);
        if (blocked) throw new Error(blocked);
        const s = await withTimeout(sampleImage(f), 15_000, "The image took too long. Try a smaller copy.");
        if (v !== version) return;
        d.samples.push(s);
      }
      if (v === version) sampleMsg("Image added.");
    } catch (e) {
      if (v === version) sampleMsg((e as Error).message, true);
    } finally {
      if (v === version) {
        state.samplesBusy = false;
        ui.file.value = "";
        renderSamples();
      }
    }
  }

  function cancel() {
    if (state.sending) return;
    disarm();
  }
  function setStatus(text: string, error = false) {
    if (!ui) return;
    ui.status.textContent = text;
    ui.status.classList.toggle("is-error", error);
  }

  /* ── send ── */
  async function send() {
    if (!ui || !draft || state.sending || state.samplesBusy) return;
    const d = draft;
    const text = ui.note.value.trim();
    if (text.length < NOTE_MIN) return;
    if (ui.address.value.trim() && !addAddress()) return;
    state.sending = true;
    ui.send.disabled = true;
    ui.send.textContent = "Sending…";
    ui.note.readOnly = true;
    ui.inspiration.disabled = true;
    setStatus(draft.shot || draft.shotError ? "Sending…" : "Finishing the screenshot…");
    try {
      await d.inspirationWork;
      if (d.inspirationError) throw new Error(d.inspirationError);
      await shotWork;
      const page = CROSS ? location.host + location.pathname : location.pathname;
      const { res, data } = await api("/report", {
        method: "POST",
        json: {
          requestId: d.requestId,
          type: d.type,
          note: text,
          page,
          selector: d.selector || undefined,
          viewport: d.viewport,
          device: d.device,
          screenshot: d.shot || undefined,
          shotError: d.shot ? undefined : d.shotError || undefined,
          shotNote: d.shot ? d.shotNote || undefined : undefined,
          samples: d.samples,
          inspiration: d.inspiration,
          token: CROSS ? state.token : undefined,
          website: (ui.dialog.querySelector(".imr-hp") as HTMLInputElement).value || undefined,
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(String(data.error || "Could not send — try again."));
      const n = data.number;
      toast(
        data.duplicate
          ? `Already filed as #${n}.`
          : `Filed as #${n}${data.hasShot ? "" : " (no screenshot)"}${data.samplesLost ? ` — ${data.samplesLost} sample image(s) failed to upload` : ""}`,
      );
      state.sending = false;
      disarm();
    } catch (e) {
      /* Q3 (owner ruling): the draft stays. Same requestId on retry, so a
         timeout that actually landed is found, not filed twice. */
      const timeout = (e as Error).name === "TimeoutError";
      setStatus((timeout ? "The reply took too long. Try Send again; it will not file twice." : (e as Error).message) + " Your note is still here.", true);
    } finally {
      state.sending = false;
      if (ui) {
        ui.send.textContent = "Send";
        ui.note.readOnly = false;
        ui.inspiration.disabled = false;
        renderSamples();
      }
    }
  }

  /* ══════════════ Clip ══════════════ */
  let cui: {
    dialog: HTMLDialogElement;
    name: HTMLInputElement;
    coll: HTMLInputElement;
    note: HTMLTextAreaElement;
    target: HTMLElement;
    stats: HTMLElement;
    shot: HTMLElement;
    send: HTMLButtonElement;
    widen: HTMLButtonElement;
    narrow: HTMLButtonElement;
    status: HTMLElement;
    deviceChip: HTMLButtonElement;
    nameTouched: boolean;
  } | null = null;
  const COLL_KEY = "imredline_collection";

  function pinClip(el: Element | null, anchor: { x: number; y: number }) {
    if (!el || el === document.body || el === document.documentElement) {
      toast("Click a component, not the page.");
      return;
    }
    state.mode = "pinned";
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onPinClick, true);
    document.removeEventListener("focusin", onFocus, true);
    document.removeEventListener("keydown", onPickKey, true);
    els.overlay?.remove();
    delete els.overlay;
    let start: Element = el;
    while (start && !(start instanceof HTMLElement) && start.parentElement) start = start.parentElement;
    clipDraft = {
      requestId: uuid(),
      el: start,
      deepest: start,
      narrowStack: [],
      device: classifyDevice(),
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      shot: null,
      shotError: "",
      extract: null,
      extractError: "",
      anchor,
    };
    openClipDialog(clipDraft);
    refreshClip();
  }

  /** Re-extract and re-shoot for the current element. Cheap enough to run
   *  on every Widen/Narrow; the shot is versioned so a stale one never lands. */
  function refreshClip() {
    const d = clipDraft;
    if (!d || !cui) return;
    const v = ++version;
    outline(d.el);
    const r = extractClip(d.el);
    if ("error" in r) {
      d.extract = null;
      d.extractError = r.error;
    } else {
      d.extract = r;
      d.extractError = "";
    }
    cui.target.textContent = "on " + selectorFor(d.el);
    /* The suggested name follows Widen/Narrow until the reviewer types one. */
    if (!cui.nameTouched) cui.name.value = suggestName(d.el);
    cui.widen.disabled = !d.el.parentElement || d.el.parentElement === document.body;
    cui.narrow.disabled = !d.el.firstElementChild;
    renderClipStats(d);
    d.shot = null;
    d.shotError = "";
    renderClipShot(d);
    shotWork = (async () => {
      try {
        const res = await capture(d.el, {
          loadLibrary,
          frameElement: true,
          marker: false,
          maxScale: Math.min(2, devicePixelRatio || 1),
          areaBudget: 2_400_000,
          maskForms: false,
        });
        if (v !== version) return;
        d.shot = res.dataUrl;
        d.shotError = res.error || "";
      } catch (e) {
        if (v !== version) return;
        d.shotError = (e instanceof Error && e.message) || "capture failed";
      } finally {
        if (v === version) renderClipShot(d);
      }
    })();
  }

  function widen() {
    const d = clipDraft;
    if (!d) return;
    const up = d.el.parentElement;
    if (!up || up === document.body || up === document.documentElement) return;
    d.narrowStack.push(d.el);
    d.el = up;
    refreshClip();
  }
  function narrow() {
    const d = clipDraft;
    if (!d) return;
    let next = d.narrowStack.pop() ?? null;
    if (!next) {
      /* Below where we started: the child on the way to what was clicked,
         else the biggest child. */
      for (let n: Element | null = d.deepest; n && n !== d.el; n = n.parentElement) if (n.parentElement === d.el) next = n;
      if (!next || next === d.el) {
        let best: Element | null = null;
        let area = 0;
        for (const c of Array.from(d.el.children)) {
          if (isUi(c)) continue;
          const b = c.getBoundingClientRect();
          if (b.width * b.height > area) {
            area = b.width * b.height;
            best = c;
          }
        }
        next = best;
      }
    }
    if (!next) return;
    d.el = next;
    refreshClip();
  }

  function openClipDialog(d: ClipDraft) {
    styles();
    const dialog = h("dialog", "imr-dialog imr-dialog--clip") as HTMLDialogElement;
    dialog.setAttribute("aria-label", "Clip this");
    const form = h("form", "imr-form");
    form.noValidate = true;
    const head = h("div", "imr-head");
    head.append(h("span", undefined, "✂ Clip this"));
    const x = h("button", "imr-x", "×") as HTMLButtonElement;
    x.type = "button";
    x.setAttribute("aria-label", "Cancel");
    x.onclick = () => cancel();
    head.append(x);

    const wn = h("div", "imr-wn");
    const widenBtn = h("button", "imr-small", "↑ Widen") as HTMLButtonElement;
    widenBtn.type = "button";
    widenBtn.title = "Take the parent — the thing you mean is often bigger than what you clicked";
    widenBtn.onclick = widen;
    const narrowBtn = h("button", "imr-small", "↓ Narrow") as HTMLButtonElement;
    narrowBtn.type = "button";
    narrowBtn.title = "Go back down";
    narrowBtn.onclick = narrow;
    const target = h("span", "imr-target");
    wn.append(widenBtn, narrowBtn, target);

    const fields = h("div", "imr-fields");
    const name = h("input", "imr-field") as HTMLInputElement;
    name.placeholder = "name — e.g. hero, pricing-card";
    name.maxLength = 40;
    name.autocomplete = "off";
    name.spellcheck = false;
    name.value = suggestName(d.el);
    name.setAttribute("aria-label", "Clip name");
    const coll = h("input", "imr-field") as HTMLInputElement;
    coll.placeholder = "collection — e.g. pema-rebuild";
    coll.maxLength = 40;
    coll.autocomplete = "off";
    coll.spellcheck = false;
    coll.setAttribute("aria-label", "Collection");
    try {
      coll.value = localStorage.getItem(COLL_KEY) || "";
    } catch {}
    fields.append(name, coll);

    const note = h("textarea", "imr-note imr-note--short") as HTMLTextAreaElement;
    note.placeholder = "Why this one? (optional)";
    note.maxLength = 1000;
    note.rows = 2;

    const row = h("div", "imr-row");
    const deviceChip = h("button", "imr-chip") as HTMLButtonElement;
    deviceChip.type = "button";
    deviceChip.title = "Which kind of screen this was clipped on. Tap to change.";
    const syncDevice = () => {
      deviceChip.textContent = `${deviceIcon(d.device.kind)} ${d.device.kind} · ${d.device.orientation}`;
    };
    deviceChip.onclick = () => {
      d.device = { ...d.device, kind: nextKind(d.device.kind), corrected: true };
      syncDevice();
    };
    row.append(deviceChip);
    const stats = h("p", "imr-cstats");
    stats.setAttribute("role", "status");
    const shot = h("div", "imr-shot");

    const actions = h("div", "imr-actions");
    const sendBtn = h("button", "imr-send", "Clip") as HTMLButtonElement;
    sendBtn.type = "submit";
    const cancelBtn = h("button", "imr-cancel", "Cancel") as HTMLButtonElement;
    cancelBtn.type = "button";
    cancelBtn.onclick = () => cancel();
    actions.append(sendBtn, cancelBtn);
    const status = h("p", "imr-status");
    status.setAttribute("role", "status");

    form.append(head, wn, fields, note, row, stats, shot, actions, status);
    form.onsubmit = (e) => {
      e.preventDefault();
      void sendClip();
    };
    dialog.append(form);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      cancel();
    });
    dialog.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void sendClip();
        return;
      }
      const inText = (e.target as HTMLElement).tagName === "TEXTAREA";
      if (!inText && e.key === "ArrowUp") {
        e.preventDefault();
        widen();
      } else if (!inText && e.key === "ArrowDown") {
        e.preventDefault();
        narrow();
      }
    });
    document.body.appendChild(dialog);
    els.dialog = dialog;
    name.oninput = () => {
      if (cui) cui.nameTouched = true;
    };
    cui = { dialog, name, coll, note, target, stats, shot, send: sendBtn, widen: widenBtn, narrow: narrowBtn, status, deviceChip, nameTouched: false };
    syncDevice();
    dialog.showModal();
    place();
    name.focus({ preventScroll: true });
    name.select();
  }

  function renderClipStats(d: ClipDraft) {
    if (!cui) return;
    const r = d.extract;
    if (!r) {
      cui.stats.textContent = d.extractError ? "⚠ " + d.extractError : "";
      cui.stats.classList.toggle("is-error", Boolean(d.extractError));
      cui.send.disabled = true;
      return;
    }
    cui.stats.classList.remove("is-error");
    const c = r.counts;
    cui.stats.textContent =
      `${r.bounds.width}×${r.bounds.height} · ${c.elements} element${c.elements === 1 ? "" : "s"} · ${c.images} image${c.images === 1 ? "" : "s"} · ${c.fonts} font${c.fonts === 1 ? "" : "s"} · ` +
      (r.states === "full" ? `hover rules: readable (${c.stateRules})` : `hover rules: partly readable (${r.unreadable.length} sheet${r.unreadable.length === 1 ? "" : "s"} cross-origin)`);
    cui.send.disabled = state.sending;
    place();
  }
  function renderClipShot(d: ClipDraft) {
    if (!cui) return;
    cui.shot.replaceChildren();
    if (d.shot) {
      const img = h("img") as HTMLImageElement;
      img.src = d.shot;
      img.alt = "the component";
      cui.shot.append(img, h("span", undefined, "Screenshot ready"));
    } else if (d.shotError) cui.shot.append(h("span", undefined, "No screenshot — " + d.shotError + ". The clip still goes."));
    else cui.shot.append(h("span", undefined, "Preparing the screenshot…"));
    place();
  }
  function setClipStatus(text: string, error = false) {
    if (!cui) return;
    cui.status.textContent = text;
    cui.status.classList.toggle("is-error", error);
  }

  async function sendClip() {
    const d = clipDraft;
    if (!cui || !d || state.sending || !d.extract) return;
    const r = d.extract;
    const name = cui.name.value.trim() || suggestName(d.el);
    const coll = cui.coll.value.trim();
    try {
      localStorage.setItem(COLL_KEY, coll);
    } catch {}
    state.sending = true;
    cui.send.disabled = true;
    cui.send.textContent = "Clipping…";
    cui.widen.disabled = true;
    cui.narrow.disabled = true;
    setClipStatus(d.shot || d.shotError ? "Sending…" : "Finishing the screenshot…");
    try {
      await shotWork;
      const { res, data } = await api("/clip", {
        method: "POST",
        json: {
          requestId: d.requestId,
          name,
          collection: coll,
          note: cui.note.value.trim(),
          source: { url: location.href, title: document.title },
          selector: r.selector,
          bounds: r.bounds,
          viewport: d.viewport,
          device: d.device,
          html: r.html,
          css: r.css,
          tokens: r.tokens,
          assets: r.assets,
          states: r.states,
          unreadable: r.unreadable,
          counts: r.counts,
          screenshot: d.shot || undefined,
          shotError: d.shot ? undefined : d.shotError || undefined,
          token: CROSS ? state.token : undefined,
        },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(String(data.error || "Could not clip — try again."));
      toast(
        data.duplicate
          ? `Already clipped as ${data.collection}/${data.slug}.`
          : `Clipped as ${data.collection}/${data.slug}${data.hasShot ? "" : " (no screenshot)"}`,
        clipLink(String(data.path)),
      );
      state.sending = false;
      disarm();
    } catch (e) {
      const timeout = (e as Error).name === "TimeoutError";
      setClipStatus((timeout ? "The reply took too long. Try again; it will not land twice." : (e as Error).message) + " Nothing was lost.", true);
    } finally {
      state.sending = false;
      if (cui) {
        cui.send.textContent = "Clip";
        cui.send.disabled = false;
        cui.widen.disabled = false;
        cui.narrow.disabled = !d.el.firstElementChild;
      }
    }
  }

  /* ── button bar ── */
  function showBar() {
    if (els.bar) return;
    styles();
    const bar = h("div", "imr-bar");
    /* Every reviewer gets the Queue link — the page is read-only for them. */
    if (state.access) {
      const q = h("a", "imr-queue", "Queue") as HTMLAnchorElement;
      q.href = HOST + BASE + "/queue" + (CROSS && state.token ? "?token=" + encodeURIComponent(state.token) : "");
      q.target = "_blank";
      q.rel = "noopener";
      bar.append(q);
    }
    const clip = h("button", "imr-clip", "✂ Clip") as HTMLButtonElement;
    clip.type = "button";
    clip.setAttribute("aria-pressed", "false");
    clip.title = "Capture a component for inspiration — markup, styles, tokens, screenshot";
    clip.onclick = () => (state.mode === "off" || state.tool !== "clip" ? arm("clip") : cancel());
    bar.append(clip);
    const launch = h("button", "imr-launch", "🛠 Review") as HTMLButtonElement;
    launch.type = "button";
    launch.setAttribute("aria-pressed", "false");
    launch.onclick = () => (state.mode === "off" || state.tool !== "review" ? arm("review") : cancel());
    bar.append(launch);
    document.body.appendChild(bar);
    els.bar = bar;
    els.launch = launch;
    els.clip = clip;
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && state.mode === "pinned" && !state.sending) {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      },
      true,
    );
    /* "Exit review" pauses; picking-on is remembered across pages so a
       reviewer walking the site does not re-arm on every load. */
    try {
      const was = sessionStorage.getItem("imredline_armed");
      if (was === "1" || was === "review") arm("review");
      else if (was === "clip") arm("clip");
    } catch {}
    const remember = () => {
      try {
        sessionStorage.setItem("imredline_armed", state.mode === "off" ? "0" : state.tool);
      } catch {}
    };
    window.addEventListener("pagehide", remember);
  }

  /* ── boot: establish access once per page load ── */
  async function validate(token: string, fromLink: boolean) {
    try {
      const { res, data } = await api("/session", { method: "POST", json: { token } });
      if (res.ok && data.ok) {
        state.access = { name: String(data.name), admin: Boolean(data.admin), maskForms: Boolean(data.maskForms) };
        state.token = token;
        if (CROSS) {
          try {
            localStorage.setItem(KEY, token);
          } catch {}
        }
        showBar();
        return;
      }
      if (CROSS) {
        try {
          localStorage.removeItem(KEY);
        } catch {}
      }
      /* Only a just-clicked link deserves a toast — a stale stored token is
         every ordinary day for a revoked reviewer, and an ordinary visitor
         must get silence. */
      if (fromLink) toast(String(data.error || "That review link is no longer valid."));
    } catch {
      if (fromLink) toast("Could not reach the review server — try that link again.");
    }
  }
  async function whoami() {
    try {
      const { res, data } = await api("/session");
      if (res.ok && data.ok) {
        state.access = { name: String(data.name), admin: Boolean(data.admin), maskForms: Boolean(data.maskForms) };
        showBar();
      }
    } catch {}
  }
  function boot() {
    /* The bookmarklet carries the token on the script tag: there is no link
       to click on a site nobody controls. */
    const attrToken = me?.dataset.token;
    if (attrToken) {
      void validate(attrToken, true);
      return;
    }
    const url = new URL(location.href);
    const param = PARAMS.find((p) => url.searchParams.get(p));
    const fromUrl = param ? url.searchParams.get(param) : null;
    if (fromUrl && param) {
      /* Strip the token from the address bar immediately — valid or not, it
         must not survive into a shared link, a bookmark or a screenshot. */
      url.searchParams.delete(param);
      history.replaceState({}, "", url.pathname + url.search + url.hash);
      void validate(fromUrl, true);
      return;
    }
    if (CROSS) {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(KEY);
      } catch {}
      if (stored) void validate(stored, false);
      return;
    }
    /* An admin landing on the queue with ?token= arms this browser too. */
    const adminToken = url.searchParams.get("token");
    if (adminToken && location.pathname.startsWith(BASE)) {
      void validate(adminToken, false);
      return;
    }
    if (document.cookie.includes(HINT)) void whoami();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
