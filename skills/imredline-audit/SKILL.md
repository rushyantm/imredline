---
name: imredline-audit
description: UX audit of a component clipped with IMRedline's ✂ Clip — reads the clip folder on the imredline-clips branch (markup, folded CSS, tokens, screenshot, README), runs the mechanical checks (contrast, tap targets, type scale, spacing rhythm, hierarchy, copy length, motion, state coverage, images, palette, semantics), writes a judged audit.md back into the folder, and can file one tester-feedback issue per finding on the site's repo. Use when the user types /imredline-audit <clip path | collection | repo>, says "audit this clip", "review the clips", "what's wrong with the hero I clipped", or wants a UX read of a component captured from any site.
---

# imredline-audit — judge a clipped component

IMRedline's ✂ Clip captures a component into a folder on the `imredline-clips`
branch: `clips/<collection>/<slug>/{README.md, component.html, component.css,
tokens.json, meta.json, preview.html, screenshot.jpg}`. The package captures;
this skill judges. Two halves:

1. **Facts** — `scripts/audit-clip.mjs facts` measures what the CSS, markup and
   tokens say. Deterministic, no opinions. Contrast ratios per text run on
   its real background, tap-target heights, type-scale ratios, spacing off the
   4px grid, heading order, words per run and characters per line, motion
   without `prefers-reduced-motion`, interactive elements with no focus style,
   images without alt or oversized, palette sprawl, div-soup and clickable divs.
2. **Judgement** — you look at `screenshot.jpg`, read the README's "why it was
   clipped" note and the tokens table, and write `audit.md`: what carries the
   feel, what to fix before this pattern is reused, what to steal outright.

The audit lands in the same folder, so whoever rebuilds from the clip sees the
verdict next to the source. The gallery shows an **audited** chip and renders
the audit under the README.

## Inputs

`/imredline-audit <what>` where `<what>` is one of:

- a clip path — `clips/pema-rebuild/hero-01`
- a collection — `pema-rebuild` (audit every un-audited clip in it, one file each)
- nothing — list the clips and ask which

The repo defaults to the site's `IMREDLINE_GITHUB_REPO`. When the owner has a
central swipe-file (`IMREDLINE_CLIPS_REPO`) they name it: `/imredline-audit
rushyantm/swipe clips/nav-ideas/nav-03`. Known repos on this machine:

| Repo | Site |
|---|---|
| `rushyantm/pemawellness-site` | PEMA rebuild + www.pemawellness.com (via the GTM shim) |
| `rushyantm/nutritionnest-rebuild` | nutritionnest.com |
| `rushyantm/eiplenergy-site` | www.eiplenergy.com |
| `rushyantm/imredline` | the package's own demo clips |

## Steps

Scripts live next to this file. `gh` must be signed in (it is, on the owner's
Mac). Never print tokens; the script never touches one.

1. **List** when the target is a collection or nothing:
   ```bash
   node "$SKILL_DIR/scripts/audit-clip.mjs" list <owner/repo> [collection]
   ```
   Rows: path · host · date · size · states · `audited` · note. Skip rows
   already `audited` unless the user asks for a re-audit.

2. **Facts** for one clip:
   ```bash
   node "$SKILL_DIR/scripts/audit-clip.mjs" facts <owner/repo> clips/<coll>/<slug>
   ```
   Markdown grouped by check with a severity per line (`high` = a person is
   blocked or the text is unreadable; `medium` = a real usability cost;
   `low` = polish). Add `--json` for the raw shape.

3. **Look.** Fetch and view the screenshot, the README and the CSS:
   ```bash
   gh api "repos/<owner/repo>/contents/clips/<coll>/<slug>/screenshot.jpg?ref=imredline-clips" -H "Accept: application/vnd.github.raw" > /tmp/clip-shot.jpg
   gh api "repos/<owner/repo>/contents/clips/<coll>/<slug>/README.md?ref=imredline-clips" -H "Accept: application/vnd.github.raw"
   gh api "repos/<owner/repo>/contents/clips/<coll>/<slug>/component.css?ref=imredline-clips" -H "Accept: application/vnd.github.raw"
   ```
   Read the picture with the Read tool. The facts say what is measurable; the
   picture says whether it matters. A 4.2:1 caption in a hero nobody reads is
   `low`; the same ratio on the only call to action is `high`.

4. **Write `audit.md`** to a temp file, in this shape (the publisher parses
   `### ` headings, so keep them):

   ```markdown
   # Audit — <collection>/<slug>

   <one paragraph: what this component is for, what carries the feel, the verdict in one line>

   **Reuse it?** yes / with fixes / no — <why, one sentence>

   ## Fix before reuse

   ### <finding title, imperative — "Raise the CTA contrast">
   `<selector from the facts, e.g. .c4 <a>>` — <what is wrong, the measured number, why it costs the user something, what to change>. Severity: high|medium|low.

   ### …

   ## What works — steal this

   ### <thing>
   <why it works, in terms a designer would use; which token or rule carries it>

   ## Facts checked
   <paste the facts block's one-line summary; list any check that came back clean>
   ```

   Rules for the judgement:
   - Every "Fix" finding names a selector or `tokens`/`markup`/`css`, one
     measured number where there is one, and a concrete change. No "consider".
   - Findings the facts flagged but the picture excuses get one line under
     "Facts checked" saying why ("infinite pulse is a 2s opacity fade on a
     subtitle — decorative, fine").
   - `states: partial` clips: say which findings are unverifiable rather than
     asserting them.
   - Text and images belong to the source site. The audit judges layout,
     type, colour, motion, structure — never the copy's meaning.
   - Under 400 words unless the component is genuinely complex.

5. **Publish:**
   ```bash
   node "$SKILL_DIR/scripts/audit-clip.mjs" publish <owner/repo> clips/<coll>/<slug> /tmp/audit.md
   ```
   Writes `audit.md` into the folder on `imredline-clips` (one commit) and
   stamps `audited` on the index entry so the gallery shows it.

   With `--issues <owner/site-repo> [--site <label>]` it also files **one
   `tester-feedback` issue per "### " heading under "Fix before reuse"** on
   that repo, in IMRedline's issue-body contract (reviewer `imredline-audit`,
   page = the clip's source page, element = the selector), so the site's queue
   and any auto-fix bot pick them up. Only do this when the clip came from a
   site the owner is fixing — never for a clip of someone else's site. Ask
   first unless the user said "file them".

6. **Report** in the owner's style: the verdict line, the count of fixes by
   severity, the two strongest "steal this" items, where the audit landed
   (repo, branch, path, gallery link `https://<host>/imredline/clips?clip=<path>`),
   and whether issues were filed.

## Not this skill

- Recording a flow across pages and auditing the journey (v2, needs a page
  recorder the widget does not have).
- Rewriting the component. The audit says what to change; the rebuild happens
  in the target site's own components with `/impeccable` or by hand.
- Auditing a live URL that has not been clipped. Clip it first (✂ Clip on a
  site with the widget, or the bookmarklet when `IMREDLINE_CLIP_ORIGINS=*`).
