/*
  The queue page: a static shell. Everything on it comes from
  <base>/api/queue once the client script has the admin token (cookie or
  ?token=). Internal tool: flat styling, noindex, no site chrome.
*/

/** `nonce`: a site running a nonce-based CSP (strict-dynamic) passes the
 *  request's nonce so the queue script is allowed once the policy is enforced.
 *  The handler reads it from an `x-nonce` request header — the convention a
 *  Next.js proxy uses to hand its per-request nonce to the layout. */
export function queuePage(base: string, nonce = ""): string {
  const b = base.replace(/"/g, "");
  const n = nonce.replace(/[^A-Za-z0-9+/=_-]/g, "");
  const nonceAttr = n ? ` nonce="${n}"` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Review queue — IMRedline</title>
<style${nonceAttr}>
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #0c0d0d; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
  .imq-wrap { max-width: 920px; margin: 0 auto; padding: 48px 20px 96px; }
  .imq-wrap h1 { font-size: 26px; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
  .imq-sub { margin-top: 6px; color: rgba(12,13,13,.65); font-size: 14px; }
  .imq-warn { margin-top: 8px; font-size: 13px; color: #8a5a12; }
  .imq-error { margin-top: 12px; font-size: 13px; color: #b3261e; }
  .imq-gate { max-width: 560px; margin: 96px auto; text-align: center; }
  .imq-filters { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; align-items: center; }
  .imq-filters select, .imq-filters input { padding: 7px 10px; border: 1px solid rgba(12,13,13,.15); border-radius: 8px; font: inherit; font-size: 13px; }
  .imq-filters input { flex: 1; min-width: 160px; }
  .imq-list { margin-top: 20px; display: flex; flex-direction: column; gap: 14px; }
  .imq-card { display: flex; gap: 16px; padding: 16px; border: 1px solid rgba(12,13,13,.12); border-radius: 12px; }
  @media (max-width: 640px) { .imq-card { flex-direction: column; } }
  .imq-shot, .imq-noshot { width: 160px; height: 96px; flex: none; border-radius: 8px; }
  .imq-shot { object-fit: cover; object-position: top; border: 1px solid rgba(12,13,13,.1); cursor: zoom-in; }
  .imq-noshot { display: flex; align-items: center; justify-content: center; border: 1px dashed rgba(12,13,13,.15); font-size: 12px; color: rgba(12,13,13,.4); }
  .imq-body { min-width: 0; flex: 1; }
  .imq-meta { display: flex; flex-wrap: wrap; align-items: center; column-gap: 12px; row-gap: 4px; font-size: 14px; color: rgba(12,13,13,.7); }
  .imq-type { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .imq-type--bug { color: #c0392b; } .imq-type--change { color: #b7791f; } .imq-type--idea { color: #6b21a8; }
  .imq-date { margin-left: auto; font-size: 12px; color: rgba(12,13,13,.45); }
  .imq-note { margin: 8px 0 0; white-space: pre-wrap; font-size: 15px; line-height: 1.55; }
  .imq-where { margin: 8px 0 0; font-family: ui-monospace, monospace; font-size: 11px; color: rgba(12,13,13,.5); overflow-wrap: anywhere; }
  .imq-device { display: inline-block; padding: 1px 8px; border-radius: 999px; background: rgba(12,13,13,.06); font-family: system-ui, sans-serif; font-size: 11px; margin-right: 6px; }
  .imq-samples { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; }
  .imq-samples li { display: flex; align-items: center; gap: 6px; max-width: 100%; }
  .imq-samples img { width: 72px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(12,13,13,.1); cursor: zoom-in; }
  .imq-samples code { font-size: 11px; overflow-wrap: anywhere; }
  .imq-insp { margin-top: 10px; font-size: 12px; }
  .imq-insp-chip { display: inline-block; cursor: pointer; }
  .imq-insp-detail { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px; }
  .imq-insp-thumb { width: 96px; height: 64px; object-fit: cover; object-position: top; border: 1px solid rgba(12,13,13,.12); border-radius: 6px; cursor: zoom-in; }
  .imq-actions { margin-top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .imq-status { padding: 5px 14px; border-radius: 999px; border: 0; background: #0c0d0d; color: #fff; font-size: 12px; cursor: pointer; }
  .imq-status.is-done { background: #fff; color: rgba(12,13,13,.6); border: 1px solid rgba(12,13,13,.15); }
  .imq-status:disabled { opacity: .5; cursor: default; }
  .imq-chip, .imq-pr { padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(12,13,13,.12); background: rgba(12,13,13,.05); font-size: 11px; color: rgba(12,13,13,.6); text-decoration: none; }
  .imq-chip--bad { border-color: rgba(179,38,30,.4); background: rgba(179,38,30,.08); color: #b3261e; }
  .imq-chip--warn { border-color: rgba(183,121,31,.4); background: rgba(183,121,31,.08); color: #8a5a12; }
  .imq-chip--good { border-color: rgba(0,120,80,.4); background: rgba(0,120,80,.08); color: #0a6b4a; }
  .imq-zoom { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.72); cursor: zoom-out; }
  .imq-zoom img { max-width: 100%; max-height: 100%; border-radius: 8px; }
  .imq-admin { margin-top: 56px; padding: 20px; border: 1px solid rgba(12,13,13,.12); border-radius: 12px; }
  .imq-admin h2 { font-size: 17px; font-weight: 600; margin: 0; }
  .imq-admin__head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .imq-admin__head span { font-size: 13px; color: rgba(12,13,13,.55); }
  .imq-manage { margin-left: auto; padding: 4px 12px; border-radius: 999px; border: 1px solid rgba(12,13,13,.15); background: #fff; font-size: 12px; cursor: pointer; }
  .imq-fresh { margin-top: 16px; padding: 16px; border: 1px solid rgba(0,78,66,.25); border-radius: 8px; background: rgba(0,78,66,.05); font-size: 13px; }
  .imq-fresh code { display: block; margin: 8px 0; padding: 6px 8px; background: #fff; border-radius: 4px; font-size: 12px; overflow-wrap: anywhere; }
  .imq-fresh button, .imq-mint button, .imq-revoke { padding: 5px 12px; border: 0; border-radius: 999px; background: #0c0d0d; color: #fff; font-size: 12px; cursor: pointer; }
  .imq-revoke { margin-left: auto; background: #fff; color: rgba(12,13,13,.6); border: 1px solid rgba(12,13,13,.15); }
  .imq-people { margin: 16px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .imq-people li { display: flex; flex-wrap: wrap; align-items: center; column-gap: 12px; row-gap: 4px; padding-bottom: 8px; border-bottom: 1px solid rgba(12,13,13,.08); font-size: 14px; }
  .imq-people small { font-size: 12px; color: rgba(12,13,13,.5); }
  .imq-mint { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .imq-mint input, .imq-mint select { padding: 8px 10px; border: 1px solid rgba(12,13,13,.15); border-radius: 8px; font: inherit; font-size: 14px; }
  .imq-mint .wide { grid-column: 1 / -1; }
  .imq-mint button { padding: 8px 16px; }
  .imq-empty { margin-top: 40px; color: rgba(12,13,13,.55); }
</style>
</head>
<body>
<div class="imq-wrap" id="imq" data-base="${b}"><h1>Review queue</h1><p class="imq-sub">Loading…</p></div>
<script src="${b}/queue.js"${nonceAttr}></script>
</body>
</html>`;
}
