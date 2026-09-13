# IMRedline — feature inventory

13 September 2026. Every feature the existing copies have, with the file and line it lives at, and what happens to it in IMRedline v1. **Nothing is built until the owner signs this off.**

Decisions already made (13 Sept): v1 supports Next.js + plain Node only · GitHub is the only store (report = issue, pictures = branch) · name IMRedline · MIT · private repo until v1 · agents pick reports up from issues + the `tester-feedback` label, no MCP in v1.

## 1. The copies

Six copies across seven surfaces. Read in full on 13 Sept.

| # | Where | Files | Lines | Capture | Masks forms | Store | Since |
|---|---|---|---|---|---|---|---|
| 1 | **preserve-rec-skill-web** | `src/components/ReviewerMode.tsx`, `src/lib/github-feedback.ts`, `src/lib/feedback-schema.ts` | 423 + 93 + 60 | whole `document.body`, no crop fix | no | GitHub issues | 2026-06-05 — **the original** |
| 2 | **GateKeeper** | `prototype/feedback-widget.js` | — | red box stroked on canvas | no | GitHub issues + Telegram photo | 2026-06-29 |
| 3 | **eiplenergy-site** | `components/ReviewMode.tsx`, `ReviewQueue.tsx`, `ReviewAdminTools.tsx`, `lib/review.ts`, `lib/review-access.ts`, `app/api/review/*`, `app/review/page.tsx` | 1,831 | old crop (document-coordinate band) | **no** | GitHub issues | 2026-07-23 |
| 4 | **nutritionnest-rebuild** | same layout as EIPL | 1,688 | **subtree capture, no crop** — the best engine | **yes** (`9ef87e3`) | GitHub issues | 2026-08-15 |
| 5a | **pemawellness-site** (in-app) | same layout as EIPL | 1,573 | old crop | no | GitHub issues | 2026-08-17 |
| 5b | **pemawellness-site** (live Squarespace site, via GTM) | `public/live-review.js`, `lib/live-review-cors.ts` | 453 + 35 | old crop | no | same backend, **cross-origin** | 2026-08-24 |
| 6 | **Aradea + Pebble Beach** (Codex) | `public/review.js`, `review-queue.js`, `agent-access.js`, `lib/review.mjs`, `review-access.mjs`, `review-mirror.mjs`, `review-ledger.mjs`, `review-pages.mjs`, `agent-access-page.mjs` | ~1,300 | frame = nearest landmark, red box stroked on canvas | **yes** (from day one) | **Postgres**, GitHub is a mirror | 2026-09-11 |

Three of six run capture code already proven wrong (EIPL, PEMA ×2). Five of six do not mask form fields.

## 2. Features, grouped — and what v1 does with each

**Keep** = carried into v1 as-is. **Merge** = best version of two copies. **Change** = carried, but different under GitHub-only. **Drop** = not in v1, reason given. **Ask** = owner decision.

### A. Access and arming

| Feature | Best copy | Evidence | v1 |
|---|---|---|---|
| Reviewer opens `/?review=<token>` once; server validates and sets a year-long HttpOnly cookie; token stripped from the URL immediately | NN | `ReviewMode.tsx:134-141`, `review-access.ts:152-155` | Keep |
| Invariant: *if the button is visible, Send will work* — token checked on arrival, not at Send | NN | `ReviewMode.tsx:11-13`, `session/route.ts:8-11` | Keep |
| Readable hint cookie so ordinary visitors never make a "who am I" request | NN | `review-access.ts:34-37` | Keep |
| Server-set cookie (Safari caps script-written storage at 7 idle days) | NN, PEMA | `review-access.ts:9-10` | Keep |
| Nothing renders for a visitor without a token — no button, no overlay, no capture library | all | `ReviewMode.tsx:7-9, 24-26` | Keep |
| Admin token = one link arms the widget AND opens the queue | NN | `review-access.ts:14-16` | Keep |
| Three token sources in order: admin env → env list `name:secret` → database (minted links, SHA-256 only) | NN | `review-access.ts:12-24, 99-128` | **Change**: v1 has no database → admin env + env list + a **file** of minted links (hashes only) so minting still works without Postgres |
| Missing database degrades to env-only, never locks the owner out | NN | `review-access.ts:23-24` | Keep |
| Reviewer links **expire** (1–90 days, default 30) and can be scoped to one site or all | Aradea | `review.mjs:125-130`, `review-queue.js:55` | **Merge** into NN's model: add expiry + site scope to minted links |
| Revoked link stops working on that browser's next page load | NN, Aradea | `review-access.ts:249-260` | Keep |
| Dead-link toast tells the reviewer exactly once, at the moment they open it | NN | `ReviewMode.tsx:575-583` | Keep |
| "Exit review" pauses picking without signing out; state survives navigation via sessionStorage | Aradea | `review.js:10, 113, 139-140` | Keep |
| Sign-out route clears cookies | NN, Aradea | `session/route.ts:52-56`, `server.mjs:111` | Keep |
| Careers role (link that opens applicant CVs) | EIPL only | `ReviewAdminTools.tsx:17-41` | **Drop** — EIPL-specific, stays in EIPL |

### B. Picking the element

| Feature | Best copy | Evidence | v1 |
|---|---|---|---|
| Overlay follows the cursor and outlines whatever is under it; the next click is swallowed and becomes the pin | all | `ReviewMode.tsx:221-283` | Keep |
| Resolve stacked, scroll-faded siblings to the one actually visible (the "wrong picture is showing" bug) | NN | `ReviewMode.tsx:230-249` | Keep, but generalised: NN keys on `.seq__rail-media`; v1 must use a data attribute (`data-imredline-stack`) not a site class |
| Keyboard picking: Tab to an element, Enter/Space pins it | Aradea | `review.js:125` | Keep |
| Focus-in outlines the focused element (screen-reader path) | Aradea | `review.js:124` | Keep |
| Short CSS path for the pinned element — breadcrumb, not a locator | NN, Aradea | `ReviewMode.tsx:79-98`; Aradea adds `:nth-of-type` and `CSS.escape`, `review.js:12` | **Merge**: Aradea's is safer (escaped, disambiguated) |
| Pin position, scroll and viewport frozen at pin time, not send time (phone keyboard shrinks the viewport) | NN | `ReviewMode.tsx:104-115` | Keep |
| Pin recorded as a **fraction of the frame** (0–1), not pixels, so it survives re-rendering | Aradea | `review.js:23` | Keep |
| Site can mark its own scroll-stage as the frame with `data-review-frame` | NN | `ReviewMode.tsx:405-412` | Keep, renamed `data-imredline-frame` |
| Review UI is never pickable (`data-review-ui` / id check) | all | `review.js:6` | Keep |

### C. Capture — the screenshot

The valuable part, and the part with the most scar tissue. **NN's engine is the base**; Aradea contributes masking, async capture and the canvas marker.

| Feature | Best copy | Evidence | v1 |
|---|---|---|---|
| **Capture the pinned element's subtree, never the page plus a crop.** Two crop-based fixes both photographed the wrong section because the clone lays out at a different height than the page | NN | `ReviewMode.tsx:352-374` | Keep — this is the core |
| Frame = nearest landmark (`section, header, footer, main, nav, article, aside`), then **climb until big enough** (≥240×44, ≥120k px²) — a tag list alone bit twice | NN | `ReviewMode.tsx:375-418` | Keep |
| Aradea's cap: if the frame is taller than 6000px, fall back to the element | Aradea | `review.js:20` | **Merge** as a ceiling on NN's climb |
| Scale budgets the **area** (~1.26 MP), not the long edge — a wide monitor produced several times the pixels of a laptop | NN, Aradea | `ReviewMode.tsx:423-428`, `review.js:28` | Keep |
| Walk up for the first real background so a subtree doesn't flatten to black | NN, Aradea | `ReviewMode.tsx:430-436`, `review.js:22` | Keep |
| **Red marker: stroke it on the canvas after capture, not a DOM node before** — a DOM marker drifts, `outline` and `inset box-shadow` photograph as nothing | Aradea (canvas) vs NN (DOM node) | `review.js:38-40` vs `ReviewMode.tsx:301-350` | **Merge → Aradea's canvas stroke**, with NN's white halo behind the red so it reads on any background (`review.js:40` already does 7px white + 3px red) |
| **Mask every form field in the clone** — `input, textarea, select, [contenteditable], [data-review-private]` blanked, greyed, placeholder removed. Runs FIRST in `onclone`, before any early return | NN (after `9ef87e3`), Aradea | `ReviewMode.tsx:469-498`, `review.js:30-35` | Keep — the privacy floor, renamed `data-imredline-private` |
| Bake live computed opacity/transform of scroll-driven animations into the clone, then switch animation off (the clone doesn't run `animation-timeline`) | NN | `ReviewMode.tsx:459-512` | Keep, but generalised: NN also force-includes `.seq__thumb, .seq__panel, .seq__tick`; v1 keys on `animation-name !== none` plus `data-imredline-animated` |
| Aradea's blunter version: inject `* { animation:none; transition:none; caret-color:transparent }` | Aradea | `review.js:36` | **Merge** as the fallback when the live/clone trees don't pair up (NN returns early there) |
| Ignore the widget's own chrome in the capture | all | `ReviewMode.tsx:454-458`, `review.js:29` | Keep |
| **JPEG, re-encoded downward until it fits** (0.85 → 0.35); PNG made a photographic hero blow the size cap and file with no picture | NN, Aradea | `ReviewMode.tsx:514-534`, `review.js:41` | Keep |
| **Capture runs in the background** — dialog opens and focuses the textarea first; 12-second timeout; a version counter discards a late capture from an abandoned draft; Send awaits outstanding capture | Aradea | `review.js:46-53` | Keep — NN captures synchronously inside Send and the reviewer waits |
| Reviewer can **see, remove or keep** the screenshot before sending | Aradea | `review.js:44, 115`, `review-pages.mjs:8` | Keep |
| Note-only report when capture fails — "the words carry the meaning" | all | `route.ts:5-7` | Keep |
| `shotNote` explains the framing ("the shot is the surrounding `<section>`, red box marks the pin") | NN | `ReviewMode.tsx:438-443` | Keep |
| Capture library lazy-loaded only at first capture; vendored `html2canvas-pro` (MIT), never a CDN | NN (npm), Aradea (vendored UMD + SHA-256) | `ReviewMode.tsx:446`, `review.js:16`, `REVIEW-QUEUE-2026-09-11.md` | Keep — v1 vendors it inside the package with the licence |
| Frame the clone's coordinate space to the origin + crop a viewport band | EIPL, PEMA | EIPL `ReviewMode.tsx` (diff) | **Drop** — proven wrong on 2026-08-18, superseded by subtree capture |
| Snapshot whole `document.body` | preserve-rec | `ReviewerMode.tsx:12-13` | **Drop** — thin evidence, superseded |
| Telegram photo of the screenshot to the owner | GateKeeper | `prototype/feedback-widget.js` | **Drop** for v1 — GateKeeper-specific delivery; can return as an optional notifier later |

### D. The report form

| Feature | Best copy | Evidence | v1 |
|---|---|---|---|
| Types: Bug / Fix / Copy / Idea with a one-line hint each | all | `ReviewMode.tsx:32-37`, `review.js:7` | Keep. Aradea also has Content / Design / Missing information — **Ask** (see §4) |
| **Default type is Fix**, not Bug — fixes outnumbered bugs 3:1 on EIPL and the default is what an untouched report files as | NN | `ReviewMode.tsx:117-119` | Keep |
| Note required; 8-char minimum (Aradea) / 2000-char max (NN) / 4000 (Aradea) | — | `review.js:14`, `route.ts:21` | **Merge**: min 8, max 4000 |
| ⌘/Ctrl-Enter sends; Esc cancels at any state | NN | `ReviewMode.tsx:661-663, 208-219` | Keep |
| Dialog placed near the pin on desktop, centred on phones; respects `visualViewport` (keyboard) | Aradea | `review.js:13, 119-121` | Keep |
| Native `<dialog>` with proper `cancel` handling | Aradea | `review-pages.mjs:8`, `review.js:138` | Keep |
| Honeypot field | Aradea, NN inquiry | `review-pages.mjs:8`, `review.mjs:63` | Keep |
| Send disabled while capture or samples are busy | Aradea | `review.js:14` | Keep |
| Draft survives a failed send — note, samples and retry id stay; Cancel discards | Aradea | `review.js:135` | Keep |
| Toast with the issue number on success | NN | `ReviewMode.tsx:563` | Keep |

### E. Attachments ("samples") — Codex's addition, all from Aradea

| Feature | Evidence | v1 |
|---|---|---|
| "Attach a sample" panel inside the report dialog | `review-pages.mjs:8`, `review.js:56-60` | Keep |
| Up to **5 samples per report, of which up to 3 images** | `review.js:69-70, 77, 98` | Keep |
| Images by file picker, **paste** (clipboard), or **drag-and-drop** | `review.js:106-112` | Keep |
| PNG/JPG/WebP, ≤10 MB in; decoded and **redrawn in the browser to JPEG on white, ≤1800px long edge** — strips metadata, makes a review copy, originals not kept | `review.js:84-93` | Keep |
| 40 MP decode ceiling; 15-second per-image timeout | `review.js:89, 99` | Keep |
| **Links** (`http`/`https` only, no embedded credentials) and **file paths** (`/`, `~/`, `./`, `C:\`, UNC, `file:///`) as text — validated, never fetched, never read | `review.js:73-83`, `review.mjs:30-51` | Keep — paths are labelled "file not uploaded" everywhere they appear |
| Uncommitted link/path field is added on Send rather than silently lost | `review.js:128` | Keep |
| Remove individual samples before sending | `review.js:68` | Keep |
| Server re-validates every sample; images verified as real PNG/JPEG by magic bytes and dimensions | `review.mjs:15-51` | Keep |
| Samples stored with the report in one transaction; retries can't duplicate them | `review.mjs:77-82` | **Change**: GitHub-only → sample images go to the assets branch next to the screenshot; links/paths go in the issue body as literal fenced text (Aradea's `literal()` helper, `review-mirror.mjs:10-14`) |
| Samples shown in the queue under "Samples to guide this change"; images render, links are links, paths are `<code>` | `review-queue.js:18-26` | Keep |
| Samples require a named reviewer — anonymous public reports can't attach | `review.mjs:69` | Keep |

### F. Submission and storage

| Feature | Best copy | Evidence | v1 |
|---|---|---|---|
| POST becomes a GitHub issue labelled `tester-feedback`; screenshot uploaded to an orphan `feedback-assets` branch first; if the upload fails the issue is still filed carrying the reason | NN | `route.ts:1-8, 67-86`, `review.ts:113-142` | Keep — branch renamed `imredline-assets` |
| Branch created on first use off `main`; 422 on race = fine | NN | `review.ts:127-140` | Keep |
| File extension from the data URL's mime, never a constant (JPEGs once wore `.png` names) | NN | `review.ts:104-107` | Keep |
| Reviewer name **slugified** in the filename — a space broke the path-jail forever | NN | `route.ts:75-82` | Keep |
| Issue body is machine-written with fixed fields (`**reviewer:**`, `**page:**`, `**element:**`, `**viewport:**`, `> note`, `📷 path`) — the queue parses exactly what it wrote | NN | `review.ts:145-186`, `page.tsx:45-86` | Keep. **This body format is a contract** — the auto-fix loop's triage reads it and the queue regex-parses it. Additions go in new fields; existing ones don't move |
| Only `tester-feedback` is applied by the widget; the bot owns every other label | NN | `route.ts:100-106`, `[number]/route.ts:10-13` | Keep |
| Per-request UUID; a retry returns the original report instead of filing twice | Aradea | `review.js:48`, `review.mjs:66-79` | **Change**: GitHub-only → `<!-- imredline:<uuid> -->` marker at the top of the body; before creating, search existing issues for the marker (Aradea's `existingIssue`, `review-mirror.mjs:88-99`) |
| Signed page context (HMAC of route+brand+actor+host, 24h) — a report can't claim a page it wasn't on | Aradea | `review.mjs:60-61` | Keep |
| **Report saved even when GitHub is down** — Postgres commits first, GitHub is a queued job with backoff, lease, retry and "needs attention" | Aradea | `review-mirror.mjs` | **Drop by decision Q2** — with GitHub as the only store there is nothing to save to. v1 behaviour = NN's: clear error, the draft stays in the dialog, reviewer retries. See §4 |
| Rate limit on the POST | Aradea | `server.mjs:92` | Keep (in-memory; per-instance) |
| Size ceiling on the whole body with a message that says which thing to shrink | Aradea | `server.mjs:25` | Keep |
| Ships dormant and loud: without the GitHub vars every route returns 503 and the widget says so | NN | `review.ts:17-19`, `route.ts:26-28` | Keep |
| Cross-origin POST from an allow-listed third-party origin, token in the body instead of a cookie | PEMA | `live-review-cors.ts`, `route.ts` (PEMA) | Keep — see §J |

### G. The queue

| Feature | Best copy | Evidence | v1 |
|---|---|---|---|
| `/review` reads `tester-feedback` issues straight off GitHub; queue and GitHub can never disagree | NN | `page.tsx:1-9, 133-136` | Keep, at `/_imredline/queue` |
| Screenshot thumbnails proxied through the server with the PAT (private repo won't serve to an `<img>`), path-jailed, bytes sniffed for mime | NN | `shot/route.ts` | Keep |
| Click a thumbnail to zoom | NN | `ReviewQueue.tsx:51, 156-161` | Keep |
| **Open first**, newest first within status | NN | `page.tsx:172-176` | Keep |
| Two statuses: open / done = issue open / closed. One call, nothing can half-apply | NN | `[number]/route.ts:1-14` | Keep. Aradea has four — **Ask** (§4) |
| Done / Reopen writes to GitHub; a rejected write leaves the row unchanged and says why | NN | `ReviewQueue.tsx:57-77` | Keep |
| Bot lifecycle chips read from the bot's own labels: `implement-failed` (needs a human, checked first), `deployed`, `merged`, `pr-open`, `plan-approved`, `triaged:skip`, `triaged:ok` | NN | `page.tsx:31-43, 66-70` | Keep |
| Linked PR per report (from issue titles `(feedback #N)`), with open/merged/closed state — fetched via the **issues** endpoint, not `/pulls`, because fine-grained PATs treat Pull requests as a separate permission | NN | `page.tsx:123-166` | Keep — the comment at `page.tsx:126-132` is load-bearing |
| Warns when PR links are off or truncated past 100 issues | NN | `page.tsx:141-155, 185-195` | Keep |
| Filters: site, status, type, free text; 50 per page; URL carries the filter | Aradea | `review-queue.js:30, 35-39` | **Change**: site → label; type → title prefix; text → GitHub search; status → open/closed. Pagination via GitHub's `per_page`/`page` |
| Team note + change history per report | Aradea | `review-queue.js:42, 49-50`, `review.mjs:115` | **Change** → issue comments (note) and issue events (history). Free on GitHub |
| Stale-write guard (revision + 409) | Aradea | `review.mjs:111-112` | **Drop** — GitHub has no compare-and-set on labels; open/closed writes are idempotent anyway |
| Queue open read-only to non-admin reviewers | PEMA | `review-access.ts:179-189` (PEMA), `ReviewQueue.tsx` `readOnly` | Keep as an option (`IMREDLINE_QUEUE_REVIEWERS=read`) |
| Header/footer hidden over the queue via a server-rendered CSS rule | NN | `page.tsx:12-18` | Keep |
| Admin "Team workspace" tab mounting the same queue | Aradea | `review-pages.mjs:12` | **Drop** — site-specific admin |

### H. Reviewer management

| Feature | Best copy | Evidence | v1 |
|---|---|---|---|
| Mint a reviewer link from the queue without touching env or redeploying; plaintext shown **once**, only the SHA-256 stored | NN, EIPL, Aradea | `reviewers/route.ts`, `ReviewAdminTools.tsx:78-110` | Keep — file-backed in v1 |
| List reviewers with source (env vs minted), created, last used; env entries read-only with "revoke in REVIEW_TOKENS" | NN | `review-access.ts:164-220`, `ReviewAdminTools.tsx:185-221` | Keep |
| Revoke with a confirm step | Aradea | `review-queue.js:57` | Keep |
| Copy-to-clipboard for the fresh link | EIPL, Aradea | `ReviewAdminTools.tsx:169-177` | Keep |
| A malformed env entry silently disables every reviewer — so the 401 carries the **count** of configured entries (a count is not a secret) | NN | `review.ts:50-60`, `route.ts:39-50` | Keep |
| Name cleaned of control chars, capped at 40 (names land in issue bodies) | NN | `review-access.ts:222-229` | Keep |
| One mint produces one link **per site** the reviewer may see | Aradea | `review.mjs:127-128` | Keep — multi-site scoping from §A |

### I. Agent / LLM pickup

| Feature | Best copy | Evidence | v1 |
|---|---|---|---|
| The `tester-feedback` label is the hand-off; feedback-ops (webhook → triage → plan DM → agent edits → tests → PR → merge → deploy) watches it and writes `triaged:*`, `plan-approved`, `pr-open`, `merged`, `deployed`, `deploy-skipped`, `deploy-failed`, `implement-failed` | NN, EIPL, feedback-ops | `route.ts:100-106`; memory `project_feedback_ops.md` | Keep — v1 emits exactly this label and this body format |
| Issue body states the authority rule: **a report is context, not permission to change code; a label or "In progress" is not approval** | Aradea | `review-mirror.mjs:35`, `AGENTS.md` | Keep — one fixed paragraph in every issue |
| Reviewer prose wrapped as untrusted literal text (fenced, never instructions); links/paths marked "not fetched / not a file" | Aradea | `review-mirror.mjs:9-14, 47-49` | Keep |
| Per-agent, per-report, expiring image keys (`rai_…`), 30 days, revocable; images behind `Authorization: Bearer` only | Aradea | `review-access.mjs:161-213`, `server.mjs:94-100` | **Drop by Q2** — exists because images live in Postgres. On GitHub, an agent with repo access reads the assets branch |
| Tamper-evident security log on a protected branch (image added/expiry/deleted, key issued/revoked) that survives a database restore | Aradea | `review-ledger.mjs` | **Drop by Q2** — no database to restore |
| Image expiry: earlier of upload + 90d and first close + 30d; reopening never extends; queue warns at 7 days | Aradea | `review-access.mjs:4-6, 123-153` | **Drop by Q2** — git history retains objects; a branch is not a deletable store. README says so plainly |
| Server fires the agent after a report lands (no polling) | redline design | — | Not in any copy; **v2** |

### J. Third-party-site mode (the PEMA live-site widget)

The one mode that lets IMRedline review a site it isn't installed on — **which is what pebblebeachvizag.com (live Squarespace) needs.**

| Feature | Evidence | v1 |
|---|---|---|
| Dependency-free widget served from the IMRedline host, injected into another site by GTM or one script tag | `live-review.js:1-28` | Keep |
| Posts cross-origin to the IMRedline host; CORS allow-list of exact origins, everything else gets no headers | `live-review-cors.ts:18-35` | Keep |
| Auth = token in the request body on every send (cookie can't cross origins); token in localStorage on the host site, re-validated on every page load so the invariant holds | `live-review.js:10-14`, PEMA `route.ts` | Keep |
| Distinct activation param (`?pemareview=`) so it can never collide with the site's own flow | `live-review.js:15-16` | Keep, `?imredline=` |
| Class prefix chosen to dodge cosmetic ad-blocker lists (`fb-` looked like Facebook) | `live-review.js:17-20` | Keep, `imr-` |
| `pagePath` carries host + path so the issue title says which site | `live-review.js:24-25` | Keep |
| GTM double-fire guard | `live-review.js:31-32` | Keep |
| Capture library loaded from the IMRedline host at Send time only | `live-review.js:21-23` | Keep |

### K. Privacy and security (cross-cutting)

| Feature | Evidence | v1 |
|---|---|---|
| Form masking in the clone (see §C) | | Keep |
| Constant-time token compare on hashed digests; a brute-force attempt is logged, the value never is | NN `review.ts:62-79`, `review-access.ts:53-62` | Keep |
| Token never in the URL after arrival; `?token=` on the queue kept only for old bookmarks | NN `ReviewMode.tsx:136-149` | Keep |
| Screenshot proxy: `Cache-Control: private`, path-jail, mime by magic bytes | NN `shot/route.ts:23-57` | Keep |
| Every user-supplied string capped and control-chars stripped before it reaches an issue | NN `route.ts:63-69`, Aradea `review.mjs:10, 39` | Keep |
| Never fetch a link a reviewer typed; never read a path a reviewer typed | Aradea `review.mjs:30` | Keep |
| GitHub timeout 10s so a hung call can't hold a render open | NN `review.ts:95-98` | Keep |
| Only-private-repo check before writing an issue | Aradea `review-mirror.mjs:137-141` | Keep as a **warning**, not a block — a public repo is a legitimate choice for an open-source project's own queue |

### L. Environment (v1)

| Var | From | Purpose |
|---|---|---|
| `IMREDLINE_ADMIN_TOKEN` | `REVIEW_ADMIN_TOKEN` | Owner. Arms widget + opens queue |
| `IMREDLINE_ADMIN_NAME` | `REVIEW_ADMIN_NAME` | Optional |
| `IMREDLINE_REVIEWERS` | `REVIEW_TOKENS` | `name:secret,name:secret` |
| `IMREDLINE_GITHUB_TOKEN` | `GITHUB_FEEDBACK_TOKEN` | Fine-grained PAT: Contents R/W + Issues R/W on **one** repo |
| `IMREDLINE_GITHUB_REPO` | `GITHUB_FEEDBACK_REPO` | `owner/repo` — this site's own repo |
| `IMREDLINE_SITE` | Aradea `SITE_BRAND` | Label + title prefix for multi-site queues |
| `IMREDLINE_ORIGINS` | PEMA `LIVE_ORIGINS` | Comma list of third-party origins allowed to post (§J). Empty = same-origin only |
| `IMREDLINE_DATA_DIR` | new | Where minted reviewer links (hashes) live when there is no database |

## 3. What v1 is, in one paragraph

NN's capture engine + Aradea's masking, canvas marker and background capture + Aradea's attachments + NN's GitHub store, queue and bot-label chips + PEMA's third-party-site mode + reviewer minting with expiry and site scope, in one package that mounts at `/_imredline/…` on Next.js and plain Node.

## 4. Decisions still open — one at a time, after sign-off

1. **Report types.** NN: Bug/Fix/Copy/Idea. Aradea adds Content/Design/Missing information. Four or seven?
2. **Statuses.** NN: open/done (two; a third was offered on EIPL and used 0 times in 48 reports). Aradea: open/in-progress/needs-decision/resolved. On GitHub the extra two would be labels. Two or four?
3. **When GitHub is down.** Under GitHub-only, a report can't be saved anywhere. v1 = clear error, draft kept in the dialog, reviewer retries (NN today). Aradea's queued-and-never-lost behaviour returns only with the database store (v2). Accept for v1?

## 5. Not verified

- GateKeeper's `prototype/feedback-widget.js` was located, not read; its features are taken from memory (Phase A: screenshot + Telegram photo, canvas-stroked marker). It contributes nothing v1 needs.
- preserve-rec-skill's `feedback-schema.ts` (60 lines) was not read; its `ReviewerMode.tsx` header was.
- No line numbers were verified for PEMA's in-app `ReviewMode.tsx` beyond the diff against NN; it is the old EIPL engine with `fb-` class names.
