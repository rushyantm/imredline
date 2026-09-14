# IMRedline

Point at anything on a live website, say what's wrong, and it lands as a GitHub issue — screenshot, pinned element, device, attachments and all — where a person or an AI agent picks it up and fixes it.

One package. Installs the same way on every site. Reviewers need no account. GitHub is the whole backend: Issues are the queue, labels are the status, an orphan branch holds the pictures. Nothing else to host.

**Status: pre-release, private.** Extracted from four production copies (Nutrition Nest, EIPL Energy, PEMA Wellness, Aradea / Pebble Beach). Public at v1.

Community-supported. MIT.

## What a reviewer does

1. Opens the private link you give them once (`https://yoursite.com/?imredline=…`). A small **🛠 Review** button appears on every page, in that browser, until the link expires or is revoked.
2. Clicks Review, then clicks anything on the page. A dialog opens; the screenshot of that area is taken in the background with a red box on what they pinned.
3. Picks **Bug / Change / Idea**, writes a note, optionally attaches samples (paste or drop images, a link, a file path), checks the **phone / tablet / desktop** chip the widget guessed, and hits Send.
4. It becomes a GitHub issue labelled `tester-feedback`. Your queue at `/imredline/queue` shows it; so does GitHub.

## Install

```
npm install imredline
```

### Next.js (App Router)

```ts
// app/imredline/[[...path]]/route.ts
import { imredline } from "imredline/next";
export const dynamic = "force-dynamic";
export const { GET, POST, PATCH, DELETE, OPTIONS } = imredline();
```

```tsx
// app/layout.tsx — anywhere in <body>
<script src="/imredline/widget.js" defer />
```

Node runtime only (the handler uses `node:crypto` and `node:fs`).

### Plain Node `http`

```js
import { createNodeHandler } from "imredline/node";
const imredline = createNodeHandler();

http.createServer(async (req, res) => {
  if (await imredline(req, res)) return;   // handled everything under /imredline
  // …your routes
});
```

Add the same `<script src="/imredline/widget.js" defer>` to your pages.

### A site you don't host (Squarespace, an old CMS, a page behind GTM)

Run IMRedline on any Node host you do control, list the other site's origin, and drop one tag into that site (a GTM Custom HTML tag works):

```
IMREDLINE_ORIGINS=https://www.pebblebeachvizag.com
```

```html
<script src="https://your-imredline-host.com/imredline/widget.js" defer
        data-host="https://your-imredline-host.com"></script>
```

Reports carry `host/path` so the issue says which site they came from. The token lives in that site's `localStorage` and is re-validated on every page load.

## Configure

| Variable | Purpose |
|---|---|
| `IMREDLINE_ADMIN_TOKEN` | You. One link arms the widget **and** opens the queue. |
| `IMREDLINE_ADMIN_NAME` | Optional. Your name on reports (default `owner`). |
| `IMREDLINE_REVIEWERS` | `name:secret,name:secret` — reviewer links that never expire. |
| `IMREDLINE_GITHUB_TOKEN` | Fine-grained PAT with **Contents R/W + Issues R/W** on one repo. |
| `IMREDLINE_GITHUB_REPO` | `owner/repo` — the site's own repo. |
| `IMREDLINE_SITE` | Optional label → `site:<label>` on every issue. Useful when one repo takes several sites. |
| `IMREDLINE_ORIGINS` | Third-party origins allowed to post, comma-separated. Empty = same-origin only. |
| `IMREDLINE_DATA_DIR` | Where minted reviewer links (SHA-256 only) live. Default `.imredline`. On Railway, point it at a volume or minted links vanish on redeploy; env reviewers are unaffected. |
| `IMREDLINE_MASK_FORMS` | `1` blanks form fields in screenshots. Default off — testers need to see what they typed. Anything with `data-imredline-private` is always blanked. |
| `IMREDLINE_BASE` | Mount path. Default `/imredline`. |

Without the GitHub variables every write returns 503 and the widget says so. It ships dormant and loud, never silently dropping reports.

## The queue

`/imredline/queue?token=<admin token>` once; after that the bare URL works in that browser. Any reviewer can open it too — through the **Queue** button on the widget, or with their own link's token — and sees every report and screenshot **read-only**. Open / Done is the issue's open / closed state — one call, nothing can half-apply; only the admin can flip it. The grey chip is whatever an auto-fix bot has labelled the issue (`triaged:ok`, `pr-open`, `merged`, `deployed`, `implement-failed`…); IMRedline only reads those labels, never writes them.

**Reviewer links** are minted there: name, how long the link lasts (1–90 days), optionally which site it may report on. The link is shown once; only its hash is stored. Revoke takes effect on that browser's next page load.

## The issue body is a contract

```
<!-- imredline:<uuid> -->
**CHANGE** reported from the site.

> the reviewer's note, one line

<details><summary>context</summary>

- **reviewer:** Asha
- **page:** `/rooms`
- **element:** `section#rooms > img#room-img`
- **viewport:** 390x844 @3x
- **device:** phone · portrait · touch

</details>

📷 `shots/2026-09-13T10-00-00-000Z-Asha.jpg` on `imredline-assets` — renders on the queue.

**Samples to guide this change**

🖼 `samples/…-1.jpg` on `imredline-assets` — sample image "reference.png"
🔗 sample link supplied by the reviewer — a reference, not fetched:
```text
https://…
```
```

Fields never move; new ones are added as new lines. An agent that reads the issue gets: the exact element, the screen size and **which kind of device** to look at, the picture on the assets branch, and the reviewer's samples. The note and every link or path are quoted as text — a report is context, not permission to change code.

The UUID on the first line makes a retry safe: a Send that timed out but landed is found, not filed twice.

## Marking up your site (optional)

| Attribute | Effect |
|---|---|
| `data-imredline-frame` | "Photograph this box when anything inside it is pinned" — for sticky scroll stages whose nearest landmark is the whole page. |
| `data-imredline-stack` | Children are stacked, scroll-faded siblings; pin the one actually visible, not the transparent one on top. |
| `data-imredline-animated` | Bake this element's current animation frame into the screenshot. |
| `data-imredline-private` | Always blanked in screenshots, whatever the masking switch says. |
| `data-imredline-ui` | Never photographed, never pickable. The widget's own chrome uses it. |

## What it does not do (yet)

- **Store anything itself.** If GitHub is down, Send shows a clear error and keeps the draft in the dialog; the reviewer tries again. A database-backed queue that never loses a report is v2.
- **Delete pictures.** They are commits on the `imredline-assets` branch; git keeps them. If that matters, keep the repo private (the queue warns when it isn't).
- **Native apps.** IMRedline needs a DOM. An iOS / Android SDK that files into the same issue format is a separate future project.

## Develop

```
npm run build          # tsc + esbuild bundles + baked assets
npm run test:unit      # node --test (26)
npm run test:browser   # render-and-look in system Chrome: capture fixture (13) + full widget e2e (40)
```

The browser tests write pictures to `test/output/`. Open them. No unit test can tell a wrong screenshot from a right one.

## Support and contributing

Community-supported: no company, no SLA. Issues and pull requests are read when
there is time. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run the tests,
what is welcome, and what is frozen (the issue-body contract, the mount path,
the env names). Security reports go through GitHub's private vulnerability
reporting, not a public issue.
