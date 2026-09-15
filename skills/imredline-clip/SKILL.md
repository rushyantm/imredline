---
name: imredline-clip
description: Clip a component from ANY web page into the IMRedline clips gallery by address — including sites whose Content-Security-Policy refuses the ✂ bookmarklet (Linear, Apple, Stripe, most big-tech products). Opens the page in a headless Chrome that ignores the page's CSP, injects the owner's own IMRedline widget, pins the exact element, and sends the clip to the host's imredline-clips branch. Use when the user types /imredline-clip <url> [what], says "clip the hero from linear.app", "grab that pricing table from stripe.com", "save this component for inspiration", or the bookmarklet reported "This site blocks outside scripts".
---

# imredline-clip — clip by address

The ✂ bookmarklet works on any site that lets outside scripts in. Sites with a
strict Content-Security-Policy refuse it, and nothing client-side can get past
`default-src 'self'`. This skill is the way around: the page is opened by a
browser on the owner's Mac that is told to ignore the CSP, the host's own
widget is injected exactly as the bookmarklet would, and the clip lands in
the same gallery as every other clip.

The host is whichever IMRedline site has `IMREDLINE_CLIP_ORIGINS=*`. On this
machine that is **nutritionnest.com** (Railway service `nutritionnest-site`);
clips land on `rushyantm/nutritionnest-rebuild` branch `imredline-clips` and
show at `https://nutritionnest.com/imredline/clips`.

## Inputs

`/imredline-clip <url> [what]` where `[what]` is one of:

- nothing — list the candidates and ask which
- a few words of visible text — `"Intake and integrations"` (smallest element
  containing the text; usually needs `--widen` to reach the whole component)
- a CSS selector — from the list, or one the user gives
- a description — "the hero", "the pricing cards": run the list, choose the
  candidate whose text and size match, confirm with a dry run

Options the user may add in plain words: a name, a collection (default
`inspiration`), a note on why, mobile (`--viewport mobile`).

## Steps

Script lives next to this file. It needs Playwright (global on this Mac) and
the host's admin token, read from Railway in memory — **never print it,
never pass it on the command line.** `IMREDLINE_CLIP_TOKEN` in the environment
overrides Railway.

1. **List** when the target is vague or absent:
   ```bash
   node "$SKILL_DIR/scripts/clip-by-url.mjs" <url> --list
   ```
   Numbered rows: tag, stable classes, size, y-offset, first words, and a
   `--pick` selector. Choose by the user's words; when two fit, prefer the
   `section`/`header` over the inner `div`.

2. **Dry run** — always, before sending:
   ```bash
   node "$SKILL_DIR/scripts/clip-by-url.mjs" <url> --pick "<selector>" --dry-run --out "<scratchpad>/shots"
   node "$SKILL_DIR/scripts/clip-by-url.mjs" <url> --text "<words>" --widen 2 --dry-run --out "<scratchpad>/shots"
   ```
   Read the saved screenshot with the Read tool. Is it the whole component
   and only the component? Too small → `--widen N`; too much → `--narrow N`
   or pick a child from the list. The stats line says how many elements and
   whether hover rules were readable.

3. **Send**: same command without `--dry-run`, plus `--name`, `--collection`,
   `--note "<why the user wanted it>"`. The script prints `clipped:
   clips/<collection>/<slug>` and the gallery address.

4. **Report** in one breath: what was clipped, from where, the gallery link,
   and (if hover rules were only partly readable) that states are partial.
   Offer `/imredline-audit clips/<collection>/<slug>` when the user is judging
   the pattern, not just saving it.

## Limits, said plainly

- Pages behind a login, a bot wall (Cloudflare challenge) or a cookie gate
  that hides content: the list is empty or wrong. Say so; the owner can
  bookmarklet it from a logged-in tab if the site's CSP allows.
- Cross-origin stylesheets are unreadable to the extractor, so hover/focus
  states may be partial (the stats line says). Computed styles are exact.
- Animated and lazy-loaded parts capture in whatever state they are ~1 s
  after load. Add `--widen 0` and re-run for a different frame; there is no
  "wait for animation" switch.
- Clips of third-party sites are for study. The README in the clip carries
  the source address and date, not a licence.
