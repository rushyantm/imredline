# Clip — component capture for inspiration (spec, not built)

Status: **built in 0.5.0 (2026-09-15)**. The gesture, the capture, the folder,
the gallery and the bookmarklet below are shipped; the README is the user-facing
description. Still open: the audit skill (§ "The audit half") and the journey
recorder (v2). Departures from this draft, as built:

- Sizing properties (`width`, `height`, `min/max-*`, `grid-template-*`,
  `margin: auto`, offsets) are read from the **cascade** where stylesheets are
  readable, not from the used pixels — `90%` stays `90%`. Heuristics only when
  sheets are cross-origin.
- Box-sizing is hoisted to one rule when a reset sets it everywhere; Tailwind's
  `border: 0 solid` preflight and `transition` entries for custom properties
  are dropped as noise.
- The three open questions were taken at their defaults: same repo (override
  `IMREDLINE_CLIPS_REPO`), bookmarklet off unless `IMREDLINE_CLIP_ORIGINS=*`,
  gallery readable by every reviewer.
- A page that already runs the widget ignores the bookmarklet (the existing
  double-load guard); clip there with the site's own ✂ button.

## The idea in one line

Point at any component on any website, click, and it lands in your GitHub as a
folder any person or coding agent can rebuild from: clean HTML, real CSS, a
token sheet, a screenshot, and a README written as a prompt.

## Why (and what we are beating)

slicer.dev does this as a Chrome extension: hover, click, get React code or an
AI prompt; a separate "journey audit" records a flow and runs an AI UX review.
Paid monthly, 3 free copies, output lives in their app.

Clip is the same gesture inside the widget that already runs on every site we
review, with three differences that matter:

1. **No extension, no cap.** Same script tag, same GTM tag, plus a bookmarklet
   for sites we do not control. Access is the same reviewer link.
2. **Output is a folder in git, not a SaaS.** A coding agent building a new
   site reads the branch directly. Nothing to export.
3. **The AI half is yours.** The package captures; a skill in the owner's
   Claude does the audit, on the owner's tokens, with the owner's rules.

## The gesture

The bar gains a second button: **✂ Clip**, next to 🛠 Review. Arming Clip uses
the same overlay, the same hover outline, the same swallowed click. The
dialog that opens is different:

- Title: `Clip this` · a name field (pre-filled from the element: `nav`,
  `hero`, `pricing-card`) · a **collection** picker (free text, remembered;
  e.g. `pema-rebuild`, `nav-ideas`) · a one-line note · the device chip.
- Preview: the screenshot thumbnail (same capture engine as Review) and a
  first read of what was captured: `14 elements · 3 images · 2 fonts · hover
  rules: readable` or `hover rules: not readable (cross-origin stylesheet)`.
- **Widen** / **Narrow** buttons walk up and down the DOM, because the thing a
  person means is often the parent of what they clicked. The outline follows.
- Send. Toast: `Clipped as pema-rebuild/hero-01`.

Keyboard: `↑`/`↓` widen/narrow while pinned, Esc leaves, ⌘/Ctrl-Enter sends.

## What gets captured (client side, in the widget)

All of it happens in the page, so it works on any site the widget can load on.
Nothing is fetched from the server side — same rule as reports.

### 1. Markup

The element's subtree, cloned and cleaned:

- `script`, `noscript`, `iframe`, `object`, `template`, comments: removed.
- Attributes kept: `class`, `id` (renamed if it collides — see below), `href`,
  `src`, `srcset`, `alt`, `title`, `type`, `role`, `aria-*`, `for`, `name`,
  `placeholder`, `width`/`height` on media, `viewBox` and friends on SVG.
  Everything else (`data-*`, `on*`, tracking attributes, framework ids) dropped.
- Inline `style` attributes kept, then folded into the stylesheet below.
- Inline SVG kept whole. `<img>` / `<picture>` / CSS `url()` sources rewritten
  to absolute URLs.
- Form fields keep their placeholder, lose their value.
- Text is kept as-is. Clipping is for layout and style; the words are the
  source site's and the README says so.

### 2. Styles — computed, then folded into classes

`getComputedStyle` on every element in the subtree, plus the `::before` and
`::after` pseudo-elements, for a **curated property list** (layout, box, type,
colour, background, border, radius, shadow, transform, transition, animation,
filter, opacity, cursor, overflow, position, z-index, grid/flex, gap, and
`content` for pseudos). Values equal to the UA default for that tag are
dropped, so a `div` with nothing set contributes nothing.

Identical declaration sets are merged into one class (`.c1`, `.c2`, …). The
original class names are kept in a comment on the first use so the source is
recognisable (`/* was: hero__title text-4xl */`). Result: `component.css`,
usually 40–150 lines instead of the site's whole framework.

Viewport-dependent styles: the capture is at the current viewport. A phone
clip and a desktop clip of the same component are two clips; the README
cross-links them by name.

### 3. States and motion — best effort, honestly labelled

- **Hover / focus / active rules**: walk `document.styleSheets`, keep rules
  whose selector matches an element in the subtree and contains `:hover`,
  `:focus`, `:focus-visible`, `:active`, `:checked`, `:disabled`, or
  `[aria-expanded]`. Rewrite the selector to the clip's class names.
- **Keyframes**: `element.getAnimations()` on the subtree; for each, the
  `@keyframes` rule by name from readable stylesheets.
- **Transitions** come through the computed `transition` property already.
- Cross-origin stylesheets throw on `.cssRules`. The clip records
  `states: partial` and lists which sheets were unreadable. Computed styles
  never fail, so the resting look is always complete.

### 4. Tokens

From the computed styles of the subtree, de-duplicated and sorted by use
count:

```
colors      #4A778C ×12, #F7F2EE ×4 …   (also as HSL, with contrast vs the most-used background)
fonts       "Crimson Text" serif ×9, Jost ×3
type scale  56/1.05, 40/1.1, 20/1.5, 16/1.6, 11/1 (size/line-height, px)
spacing     4 8 12 16 24 32 48 64        (every padding/margin/gap value seen)
radii       4 8 999
shadows     0 6px 24px rgba(0,0,0,.28)
breakpoints (from readable media rules that touched the subtree)
```

Written as `tokens.json` and repeated in the README as a table. This is the
part a designer or an agent actually reuses.

### 5. Assets

- Raster images: URL list with rendered size, natural size and `alt`. The
  bytes are **not** copied — copyright, size, and the server-never-fetches
  rule. The README says "download if you have the right to."
- Fonts: family names and, where a readable `@font-face` exists, the source
  URLs. Same rule, not copied.
- The screenshot of the element (JPEG, ≤ 1800px on the long side, same
  pipeline as Review) **is** stored — it is the visual record.

### 6. Context

`meta.json`: source URL, page title, clip time, viewport, device, dpr, the
selector path, element bounds, the widget version, and the collection name.

## Where it lands

Branch **`imredline-clips`** on the same repo as reports (override with
`IMREDLINE_CLIPS_REPO` so many sites can feed one swipe file). Path:

```
clips/<collection>/<slug>/
  README.md        the prompt: what it is, where from, tokens table, how to rebuild
  component.html   cleaned markup, class names rewritten
  component.css    folded computed styles + state rules + keyframes
  tokens.json
  meta.json
  screenshot.jpg
  preview.html     component.html + component.css in one file, opens in a browser
```

`<slug>` = the clip name + `-NN`. `clips/index.json` at the branch root is
regenerated on every clip (name, collection, source host, tokens summary,
screenshot path). One issue per clip is **not** filed — clips are not work.

Size guard: markup over 200 KB or more than 400 elements is refused with a
message ("pick something smaller — Narrow"). Same rate limit as reports.

## The gallery

`/imredline/clips` (admin and reviewers, read-only like the queue): cards with
screenshot, name, collection, host, colour swatches, font names; filter by
collection and host; click → the README rendered, `preview.html` in an
iframe, buttons to copy the HTML, the CSS, or the prompt.

## The bookmarklet (any site)

Generated on the gallery page for the signed-in reviewer:

```
javascript:(()=>{const s=document.createElement('script');s.src='https://<host>/imredline/widget.js';s.dataset.host='https://<host>';s.dataset.param='imredline';document.head.append(s)})()
```

The first run asks for the token (same `?imredline=` flow, stored in that
site's localStorage as today). `IMREDLINE_ORIGINS` gains a wildcard mode for
clips only: `IMREDLINE_CLIP_ORIGINS=*` allows the clip and session routes from
any origin; reports stay on the allow-list. CSP-strict sites will refuse the
script; the toast says so.

## The audit half (a skill, not package code)

`/imredline-audit <clip|url|collection>` in the owner's Claude Code:

1. Reads the clip folder(s) from the branch.
2. Runs the owner's own checklist (contrast vs WCAG, tap targets, type scale
   consistency, spacing rhythm, hierarchy, copy length, motion and
   reduced-motion, state coverage) against `tokens.json`, `component.css` and
   the screenshot.
3. Writes findings back as `audit.md` in the clip folder, each pinned to a
   selector, and optionally opens one `tester-feedback` issue per finding on
   the target site so the existing fix loop picks them up.

Journey audit (record a flow across pages, clip each screen, audit the flow)
is v2: it needs a page-to-page recorder the widget does not have yet.

## Security and scope

- The token that reviews is the token that clips. Clip does not widen access.
- Server never fetches a URL from a clip. Only the screenshot bytes travel.
- Clip refuses inside `data-imredline-private` regions, same as capture.
- Published clips of third-party sites are for study. The README carries
  the source URL and the date; it does not carry a licence it cannot grant.

## Versioning

0.5.0. New routes: `POST /api/clip`, `GET /api/clips`, `GET /clips`,
`GET /api/clip-asset`. The issue-body contract is untouched. Env additions
are optional with safe defaults.

## Open questions for the owner

1. Same repo for clips, or one central swipe-file repo? (Default: same.)
2. Bookmarklet on by default, or only when `IMREDLINE_CLIP_ORIGINS=*`?
   (Default: off.)
3. Should the gallery be public to reviewers, or admin-only? (Default:
   reviewers, read-only, same as the queue.)
