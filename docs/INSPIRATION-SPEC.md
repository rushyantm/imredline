# Report with inspiration — 0.6.0

Status: spec, 2026-09-16. Builds on Clip (0.5.x). Owner's framing: "I pick this
section on my site, I don't like it. I go to a page I like, clip it, and the
report for my site carries that clip as the reference." Order of use is
**clip first, report second** — no round trip, no draft saved across sites.

## The user's path

1. On any page (own site, or a foreign one via the bookmarklet / `imredline-clip`
   skill) the reviewer presses ✂ Clip and clips. The toast reads
   `Clipped as <collection>/<slug>` and gains a **Copy link** button that copies
   `<host><base>/clips?clip=clips/<collection>/<slug>` (the gallery already
   opens a card from `?clip=`).
2. On the site to change, the reviewer presses 🛠 Review, picks the section,
   writes the note. The report dialog has a new **Inspiration** row under the
   note: a list of this site's clips (newest first, up to 20: name · collection
   · source host · date) and a text box "or paste a clip link". Picking one
   shows its screenshot thumbnail next to the row. Optional; nothing changes
   when it is left empty.
3. Send. The issue carries the reference. The queue shows it.

## Contract changes (the only ones)

### Report payload — `ReportInput.inspiration?`
```ts
inspiration?: { path: string; repo?: string; url?: string };
```
- `path` must match `^clips/[a-z0-9][a-z0-9-]{0,39}/[a-z0-9][a-z0-9-]{0,49}$`.
- `repo` optional `owner/repo` (`^[\w.-]+/[\w.-]+$`), only when the clip lives
  in another site's clips repo (the paste box accepts that site's gallery
  link; the widget derives `repo` from the `/api/clips` answer of *that* host
  when it can, else leaves it empty and keeps `url`).
- `url` optional, the gallery link as pasted (http/https only, ≤ 500 chars).
- Server validation in `validate.ts`: bad path → 400 with a cause; anything
  else about it is best-effort. When `repo` is empty or equals this site's clips
  repo, the server checks `clips/<path>/meta.json` exists on `imredline-clips`
  and answers 400 "That clip does not exist here" when it does not. A foreign
  `repo` is recorded, not verified.

### Issue body — one new field line + one reference block
After the `**device:**` line (same `- **key:** value` shape, optional):
```
- **inspiration:** `clips/<collection>/<slug>`            (same repo)
- **inspiration:** `clips/<collection>/<slug>` (owner/repo)  (foreign repo)
```
After the 📷 screenshot block, when present:
```
📎 inspiration: <gallery link>  — folder: https://github.com/<repo>/tree/imredline-clips/clips/<collection>/<slug>
> Inspiration only. Rebuild the idea with this site's own words, images and brand. Do not copy the source's text, images, logos, animation files or code.
```
`parseIssue` returns `inspiration: { path, repo, url, folder } | null`;
`repo` defaults to the issue's own repo. `formatIssue → parseIssue` must
round-trip it. Existing bodies without the line parse as before (`null`).

### QueueRow
`inspiration: { path: string; repo: string; url: string | null; folder: string } | null`.

### Queue UI
A card with inspiration shows a small **with reference** chip and, in the
detail view, the clip's screenshot (via `/api/clip-asset?path=<path>/screenshot.jpg`
when same repo; the pasted `url` as a link otherwise) and the folder link.

### Widget
- Review dialog: the Inspiration row (list + paste box + thumbnail + clear).
  The list comes from `GET /api/clips` (already reviewer-readable); when that
  call fails or returns nothing, only the paste box shows.
- Clip toast: **Copy link** (clipboard API; fall back to selecting the text).
- Class names: add new ones (`imr-insp`, `imr-insp-list`, `imr-insp-paste`,
  `imr-insp-thumb`, `imr-insp-clear`, `imr-copy`); **do not rename or remove
  any existing `imr-*`, `imq-*`, `imc-*` class** — three skills and the README
  media scripts drive the widget by them.

### Nothing else changes
No new env, no new route, no change to Clip's folder contract, to
`/api/clips`, to statuses, or to the reviewer/token model. Third-party
(cross-origin) reports carry `inspiration` the same way.

## Tests (must exist and pass)
- unit `issue.test.mjs`: round-trip with inspiration (same repo, foreign repo,
  with and without url); old bodies → `null`.
- unit `validate.test.mjs`: bad path → 400 cause; good path passes; foreign repo
  shape enforced; url scheme enforced.
- unit `handler.test.mjs`: report with a same-repo inspiration whose meta.json
  exists → filed, body has both blocks; missing clip → 400; foreign repo → filed
  unverified; queue row carries `inspiration`.
- browser `test/browser/clip.mjs` (extend, do not fork): clip → toast Copy link
  copies the gallery link; then Review → pick the clip in the list → send →
  the filed body has the `**inspiration:**` line; queue card shows the chip
  and the thumbnail loads (200).
- `npm run check`, `npm test`, `node test/browser/*.mjs` all green.

## Docs
- README: a short "Report with inspiration" paragraph under Clip; the issue-body
  block in README gains the line; env table unchanged.
- CONTRIBUTING "What is frozen": the issue-body contract now includes the
  `**inspiration:**` line and the 📎 block.
- `package.json` → 0.6.0, `WIDGET_VERSION` → "0.6.0" (and the pin in
  handler.test.mjs).

## Out of scope (later, as skills, not package code)
- The similarity score after a section is rebuilt from a clip (`/imredline-audit
  compare`): same assets, same words, same exact colours/fonts, same structure →
  score /10; the owner decides.
- Teaching `skills/imredline-fix/scripts/queue.mjs` the new line (owned by the
  docs session; it will be told).
