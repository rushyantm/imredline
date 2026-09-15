# main-part — clipped from www.pemawellness.com

> A component clipped for inspiration with IMRedline. Rebuild the *look and behaviour*; the words and pictures belong to the source and are here only so the layout reads.

- **source:** https://www.pemawellness.com/ — “Best Wellness Retreats in India for Healing \| Pema Wellness”
- **clipped:** 2026-09-15T14:04:53.830Z by rishi
- **collection:** inbox
- **element:** `main#main-content > div.flex-1.relative > div.mt-15.max-w-\[1360px\]`
- **size:** 1360×1494 px in a 1440x900 viewport (desktop · landscape)
- **captured:** 27 elements · 6 images · 2 fonts · 2 hover/focus rules · 0 keyframes
- **states:** complete — every stylesheet was readable

## Files

| file | what |
|---|---|
| `component.html` | the markup, cleaned: no scripts, no tracking attributes, classes rewritten to `.c1 .c2 …` (the original class names sit in a comment on first use in the CSS) |
| `component.css` | the computed styles folded into those classes, then hover/focus/active rules and keyframes where the browser could read them |
| `tokens.json` | colours, fonts, type scale, spacing, radii, shadows, breakpoints — the reusable part |
| `preview.html` | html + css in one file; open it in a browser |
| `screenshot.jpg` | what it looked like at capture time |
| `meta.json` | source, viewport, device, counts, widget version |

## Tokens

**Colours** (by use)

| colour | hsl | uses | contrast vs main background |
|---|---|---|---|
| `#4a778c` | hsl(199 31% 42%) | 5 | 4.87 |
| `#323333` | hsl(180 1% 20%) | 5 | 12.67 |

**Fonts:** Crimson Text ×7, ivyOra ×1
**Type scale (px size/line-height):** 20/1.4 ×7, 40/1 ×1
**Spacing (px):** 8 12 16 40 60
**Breakpoints that touched it:** `(hover: hover)`, `(min-width: 48rem)`, `(min-width: 64rem)`

## Assets (not copied — download only if you have the right to)

- image https://www.pemawellness.com/_next/image?url=%2Fimages%2Fhome%2Fhealing-sanctury-home-slider-1.webp&w=1920&q=75 — rendered 1280×540, natural 1440×2160, alt “Luxurious rooms overlooking the Indian Ocean”
- image https://www.pemawellness.com/_next/image?url=%2Fimages%2Fhome%2Fhealing-sanctury-home-slider-2.webp&w=1920&q=75 — rendered 1280×540, natural 1440×2160, alt “Naturopathic cuisine designed for your specific condition”
- image https://www.pemawellness.com/_next/image?url=%2Fimages%2Fhome%2Fhealing-sanctury-home-slider-3.webp&w=1920&q=75 — rendered 1280×540, natural 1440×573, alt “Hyper-personalised care with dedicated medical team”
- image https://www.pemawellness.com/_next/image?url=%2Fimages%2Fhome%2Fhealing-sanctury-home-slider-4.webp&w=1920&q=75 — rendered 1280×540, natural 1020×405, alt “100,000 square feet healing hub      with state-of-the-art facilities”
- image https://www.pemawellness.com/_next/image?url=%2Fimages%2Fhome%2Fhealing-sanctury-home-slider-5.webp&w=1920&q=75 — rendered 1280×540, natural 1020×405, alt “An oceanfront sanctuary on 28 acres,      where healing begins the moment you arrive”
- image https://www.pemawellness.com/_next/image?url=%2Fimages%2Fhome%2Fhealing-sanctury-home-slider-6.webp&w=1920&q=75 — rendered 1280×540, natural 1020×405, alt “Private beach access for ocean therapy and reflection”
- font Crimson Text (source not readable)
- font ivyOra (source not readable)

## How to rebuild this

1. Open `preview.html` next to `screenshot.jpg` and note what carries the feel: the type scale, the spacing rhythm, the one accent colour, the motion.
2. Rebuild it in the target site's own components and tokens. Map the colours in `tokens.json` onto the target palette — do not paste hex values.
3. Replace every word and picture. The copy and the images in `component.html` are the source site's.
4. Keep the hover/focus rules and the keyframes; they are in `component.css`.
5. Check it at the other viewport. This clip is one size; a phone clip of the same component is a separate folder.
