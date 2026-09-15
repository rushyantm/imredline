# Audit — inbox/main-part-01

A "healing sanctuary" section: a serif display headline, one line of body copy, then a three-tab strip whose active tab swaps a full-width photograph beneath it, twice over. The feel comes from restraint — two colours, two families, generous 40px padding, and photographs doing the talking. Verdict: the pattern is worth reusing; the tab strip needs its states finished before it is.

**Reuse it?** with fixes — the photo-tab rhythm is strong, but the tabs are invisible to keyboard users and the photos are portrait originals cropped into a 2.4:1 slot.

## Fix before reuse

### Give the tabs a visible focus state
`.c6 <button>` and `.c8 <button>` — six tab buttons, none with a `:focus-visible` rule; the only cue for the active tab is a 1px underline (`border-bottom-color: #4a778c`). A keyboard user tabbing through the strip sees nothing move. Add `:focus-visible { outline: 2px solid #4a778c; outline-offset: 4px }` on the button and keep the underline for the active one. Severity: medium.

### Respect reduced motion on the photo swap
`.c10` / `.c11` — the photograph cross-fades over 0.7s with no `prefers-reduced-motion` rule. Wrap the transition in `@media (prefers-reduced-motion: no-preference)` and cut it to 0.3s; a 0.7s fade on a tab click reads as lag on the fourth click. Severity: medium.

### Ship landscape crops of the photographs
`https://www.pemawellness.com/_next/image?…slider-1.webp` and `…slider-2.webp` — natural 1440×2160 (portrait, 0.67) rendered in a 1280×540 slot (2.37). The browser throws away three quarters of each file and the crop is whatever `object-fit` lands on; the bed photo loses its ceiling, the pool loses its horizon. Export the six slides at 2560×1080 with the crop chosen by a person. Severity: low.

## What works — steal this

### One accent, one neutral
`#4a778c` (4.87:1 on white) for the headline and the active tab, `#323333` (12.67:1) for everything else. Nothing competes with the photographs. Reuse the rule, not the hex: one accent carries headline + active state, the neutral carries the rest.

### Display serif at line-height 1, body serif at 1.4
`ivyOra` 40/1 for the headline, `Crimson Text` 20/1.4 for the tabs and copy — two sizes only, and the tight display leading is what makes the 40px feel considered rather than large. The 60px top margin above the headline and 40px padding on the tab block are the whole spacing system.

### Tabs that are captions
The tab labels are full sentences ("Luxurious rooms overlooking the Indian Ocean"), so the strip doubles as the caption for the photo below it. Three per row, 8px gap, 1px underline on the active one. Cheap to build, and it explains the picture without a separate caption line.

## Facts checked
source https://www.pemawellness.com/ · 1360×1494 · states full · 73 words · 0 high / 3 medium / 3 low. Contrast, tap targets (tab buttons ≈73px tall), type scale, spacing rhythm (8 12 16 40 60 — all on the 4px grid), heading hierarchy, copy length, palette and semantics all came back clean. The `main-part` name is the widget's fallback for an unnamed `<div>` — rename to `healing-tabs` when re-clipping.
