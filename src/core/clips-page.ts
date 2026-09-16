/*
  The clips gallery: a static shell like the queue page. Cards come from
  <base>/api/clips; each file comes through <base>/api/clip-asset. Internal
  tool, noindex, no site chrome. preview.html is shown in a sandboxed iframe
  (srcdoc, no scripts, no same-origin) so a clipped page can never run here.
*/

export function clipsPage(base: string, nonce = ""): string {
  const b = base.replace(/"/g, "");
  const n = nonce.replace(/[^A-Za-z0-9+/=_-]/g, "");
  const nonceAttr = n ? ` nonce="${n}"` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Clips — IMRedline</title>
<style${nonceAttr}>
  :root { color-scheme: light; }
  [hidden] { display: none !important; }
  body { margin: 0; background: #fff; color: #0c0d0d; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
  a { color: inherit; }
  .imc-wrap { max-width: 1080px; margin: 0 auto; padding: 48px 20px 96px; }
  .imc-wrap h1 { font-size: 26px; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
  .imc-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
  .imc-head a { font-size: 13px; color: rgba(12,13,13,.6); }
  .imc-sub { margin-top: 6px; color: rgba(12,13,13,.65); font-size: 14px; }
  .imc-warn { margin-top: 8px; font-size: 13px; color: #8a5a12; }
  .imc-error { margin-top: 12px; font-size: 13px; color: #b3261e; }
  .imc-gate { max-width: 560px; margin: 96px auto; text-align: center; }
  .imc-filters { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
  .imc-filters select, .imc-filters input { padding: 7px 10px; border: 1px solid rgba(12,13,13,.15); border-radius: 8px; font: inherit; font-size: 13px; }
  .imc-filters input { flex: 1; min-width: 160px; }
  .imc-grid { margin-top: 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
  .imc-card { border: 1px solid rgba(12,13,13,.12); border-radius: 12px; overflow: hidden; cursor: pointer; background: #fff; text-align: left; padding: 0; font: inherit; color: inherit; }
  .imc-card:hover { border-color: rgba(12,13,13,.35); }
  .imc-card img, .imc-card .imc-noshot { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: contain; object-position: center; background: #f4f4f4; padding: 8px; box-sizing: border-box; }
  .imc-card .imc-noshot { display: flex; align-items: center; justify-content: center; font-size: 12px; color: rgba(12,13,13,.4); }
  .imc-card-body { padding: 12px 14px 14px; }
  .imc-name { font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
  .imc-meta { margin-top: 4px; font-size: 12px; color: rgba(12,13,13,.55); overflow-wrap: anywhere; }
  .imc-swatches { margin-top: 10px; display: flex; gap: 4px; align-items: center; }
  .imc-swatch { width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(12,13,13,.12); }
  .imc-fonts { margin-top: 6px; font-size: 11px; color: rgba(12,13,13,.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .imc-chip { display: inline-block; padding: 1px 8px; border-radius: 999px; background: rgba(12,13,13,.06); font-size: 11px; margin-right: 6px; }
  .imc-chip--warn { background: rgba(183,121,31,.1); color: #8a5a12; }
  .imc-chip--good { background: rgba(0,120,80,.1); color: #0a6b4a; }
  .imc-audit { border-color: rgba(0,120,80,.35); }
  .imc-empty { margin-top: 40px; color: rgba(12,13,13,.55); }
  .imc-detail { margin-top: 24px; }
  .imc-back { padding: 5px 14px; border-radius: 999px; border: 1px solid rgba(12,13,13,.15); background: #fff; font: inherit; font-size: 12px; cursor: pointer; }
  .imc-detail h2 { font-size: 20px; margin: 16px 0 4px; }
  .imc-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
  .imc-actions button, .imc-actions a { padding: 6px 14px; border-radius: 999px; border: 0; background: #0c0d0d; color: #fff; font: inherit; font-size: 12px; cursor: pointer; text-decoration: none; }
  .imc-actions a.imc-ghost, .imc-actions button.imc-ghost { background: #fff; color: rgba(12,13,13,.7); border: 1px solid rgba(12,13,13,.15); }
  .imc-discard { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; }
  .imc-actions button:disabled { opacity: .5; cursor: default; }
  .imc-toast { position: fixed; bottom: 24px; left: 24px; right: 24px; width: fit-content; max-width: calc(100% - 80px); padding: 12px 16px; border-radius: 8px; background: #0c0d0d; color: #fff; font-size: 14px; overflow-wrap: anywhere; }
  .imc-frame { width: 100%; height: 520px; border: 1px solid rgba(12,13,13,.12); border-radius: 12px; background: #f4f4f4; }
  .imc-readme { margin-top: 20px; padding: 20px; border: 1px solid rgba(12,13,13,.12); border-radius: 12px; font-size: 14px; line-height: 1.55; }
  .imc-readme h1 { font-size: 20px; margin: 0 0 12px; }
  .imc-readme h2 { font-size: 15px; margin: 20px 0 8px; }
  .imc-readme blockquote { margin: 0 0 12px; padding-left: 12px; border-left: 3px solid rgba(12,13,13,.15); color: rgba(12,13,13,.7); }
  .imc-readme table { border-collapse: collapse; font-size: 13px; margin: 8px 0; max-width: 100%; }
  .imc-readme td, .imc-readme th { border: 1px solid rgba(12,13,13,.12); padding: 4px 8px; text-align: left; vertical-align: top; }
  .imc-readme code { font-family: ui-monospace, monospace; font-size: 12px; background: rgba(12,13,13,.05); padding: 1px 4px; border-radius: 3px; overflow-wrap: anywhere; }
  .imc-readme ul, .imc-readme ol { padding-left: 22px; }
  .imc-readme li { margin: 2px 0; overflow-wrap: anywhere; }
  .imc-readme p { margin: 8px 0; overflow-wrap: anywhere; }
  .imc-shot { max-width: 100%; border: 1px solid rgba(12,13,13,.12); border-radius: 12px; margin-top: 16px; }
  .imc-book { margin-top: 56px; padding: 20px; border: 1px solid rgba(12,13,13,.12); border-radius: 12px; font-size: 13px; }
  .imc-book h2 { font-size: 17px; font-weight: 600; margin: 0 0 6px; }
  .imc-book a.imc-drag { display: inline-block; margin: 10px 0; padding: 8px 16px; border-radius: 999px; background: #1f2937; color: #fff; font-weight: 600; text-decoration: none; cursor: grab; }
  .imc-book p { margin: 6px 0; color: rgba(12,13,13,.7); }
</style>
</head>
<body>
<div class="imc-wrap" id="imc" data-base="${b}"><h1>Clips</h1><p class="imc-sub">Loading…</p></div>
<script src="${b}/clips.js"${nonceAttr}></script>
</body>
</html>`;
}
