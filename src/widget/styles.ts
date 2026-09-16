/*
  Widget chrome. Prefix `imr-`, never `fb-`: cosmetic ad-blocker lists hide
  Facebook-shaped class names (learned on PEMA, commit 500d0b1), and this
  widget runs on pages whose extensions nobody controls. Everything is tagged
  data-imredline-ui so the capture engine leaves it out of every picture.
*/
export const CSS = `
.imr-bar{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
.imr-launch{padding:10px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:#1f2937;color:#fff;font:inherit;font-size:14px;font-weight:600;letter-spacing:.01em;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.28)}
.imr-launch:hover{filter:brightness(1.2)}
.imr-launch[aria-pressed="true"]{background:#e2483d}
.imr-clip{padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:#0f6e56;color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.28)}
.imr-clip:hover{filter:brightness(1.15)}
.imr-clip[aria-pressed="true"]{background:#e2483d}
.imr-overlay--clip{cursor:copy}
.imr-overlay--clip .imr-banner{background:#0f6e56}
.imr-dialog--clip::backdrop{background:rgba(0,0,0,.1)}
.imr-dialog--clip{width:400px}
.imr-wn{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:11px}
.imr-wn .imr-target{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.imr-fields{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
.imr-field{min-width:0;padding:7px 9px;border:1px solid #dcdcdc;border-radius:7px;font:inherit;font-size:13px;color:#0c0d0d;background:#fff}
.imr-note--short{min-height:48px}
.imr-cstats{margin:8px 0 0;font-size:11px;line-height:1.45;color:#6b6b6b}
.imr-cstats.is-error{color:#b3261e}
.imr-queue{padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:#0c0d0d;color:#fff;font-size:13px;font-weight:600;text-decoration:none;box-shadow:0 6px 24px rgba(0,0,0,.28)}
.imr-overlay{position:fixed;inset:0;z-index:2147483100;cursor:crosshair}
.imr-banner{position:fixed;top:0;left:0;right:0;padding:9px 16px;background:#e2483d;color:#fff;font-family:system-ui,sans-serif;font-size:13px;font-weight:600;text-align:center}
.imr-banner kbd{padding:1px 6px;border:1px solid rgba(255,255,255,.6);border-radius:4px;font-size:11px}
.imr-highlight{position:fixed;border:2px solid #e2483d;background:rgba(226,72,61,.12);border-radius:3px;pointer-events:none;z-index:2147483101}
.imr-dialog{position:fixed;margin:0;padding:0;border:0;border-radius:12px;width:380px;max-width:calc(100vw - 24px);background:#fff;color:#0c0d0d;font-family:system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.35);overflow:auto;z-index:2147483200}
.imr-dialog::backdrop{background:rgba(0,0,0,.35)}
.imr-form{padding:14px}
.imr-form *{box-sizing:border-box}
.imr-head{display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:700}
.imr-x{border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:#777;padding:0 4px}
.imr-types{display:flex;gap:6px;margin-top:10px}
.imr-type{flex:1;padding:6px 4px;border:1px solid #dcdcdc;border-radius:7px;background:#fff;font:inherit;font-size:12px;font-weight:600;color:#555;cursor:pointer}
.imr-type[aria-checked="true"]{background:#1f2937;border-color:#1f2937;color:#fff}
.imr-hint{margin:8px 0 0;font-size:12px;line-height:1.45;color:#6b6b6b}
.imr-note{width:100%;margin-top:8px;min-height:88px;padding:9px;border:1px solid #dcdcdc;border-radius:8px;font:inherit;font-size:14px;resize:vertical;color:#0c0d0d;background:#fff}
.imr-insp{margin:8px 0 0;padding:8px;border:1px solid #eee;border-radius:8px;min-width:0;font-size:12px}
.imr-insp legend{padding:0 4px;color:#555;font-weight:600}
.imr-insp-list,.imr-insp-paste{width:100%;min-width:0;padding:6px 8px;margin:0 0 6px;border:1px solid #dcdcdc;border-radius:6px;background:#fff;color:#333;font:inherit}
.imr-insp-preview{display:inline-block;vertical-align:middle}
.imr-insp-thumb{width:72px;height:44px;object-fit:cover;object-position:top;border:1px solid #dcdcdc;border-radius:4px}
.imr-insp-clear{margin-left:8px;border:0;background:none;color:#b3261e;font:inherit;cursor:pointer}
.imr-insp-status{margin:0;color:#b3261e;font-size:11px}
.imr-copy{margin-left:10px;padding:4px 8px;border:1px solid #aaa;border-radius:6px;background:#fff;color:#0c0d0d;font:inherit;cursor:pointer}
.imr-copy-text{display:block;margin-top:6px;width:260px;max-width:100%;font:inherit}
.imr-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;font-size:11px;color:#777}
.imr-chip{padding:2px 9px;border:1px solid #dcdcdc;border-radius:999px;background:#f6f6f6;font:inherit;font-size:11px;color:#444;cursor:pointer}
.imr-chip:hover{border-color:#999}
.imr-target{font-family:ui-monospace,monospace;font-size:11px;color:#999;overflow-wrap:anywhere}
.imr-shot{margin-top:8px;font-size:12px;color:#6b6b6b;display:flex;align-items:center;gap:8px}
.imr-shot img{width:64px;height:40px;object-fit:cover;object-position:top;border:1px solid #dcdcdc;border-radius:4px}
.imr-samples{margin-top:8px;border-top:1px solid #eee;padding-top:8px}
.imr-samples summary{font-size:12px;font-weight:600;color:#444;cursor:pointer}
.imr-samples-body{margin-top:6px;display:flex;flex-direction:column;gap:6px}
.imr-samples-body p{margin:0;font-size:11px;color:#777}
.imr-samples-body .imr-add{display:flex;gap:6px}
.imr-samples-body input[type=text]{flex:1;min-width:0;padding:6px 8px;border:1px solid #dcdcdc;border-radius:6px;font:inherit;font-size:12px}
.imr-small{padding:6px 10px;border:1px solid #dcdcdc;border-radius:6px;background:#fff;font:inherit;font-size:12px;cursor:pointer;color:#333}
.imr-small:disabled{opacity:.5;cursor:default}
.imr-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.imr-list li{display:flex;align-items:center;gap:6px;font-size:11px;color:#444}
.imr-list img{width:40px;height:28px;object-fit:cover;border-radius:3px;border:1px solid #dcdcdc}
.imr-list span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.imr-list button{border:0;background:none;color:#b3261e;font:inherit;font-size:11px;cursor:pointer}
.imr-drop{outline:2px dashed #e2483d;outline-offset:-2px}
.imr-actions{display:flex;gap:8px;margin-top:10px;align-items:center}
.imr-send,.imr-cancel{padding:8px 16px;border-radius:8px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.imr-send{border:0;background:#1f2937;color:#fff}
.imr-send:disabled{opacity:.5;cursor:default}
.imr-cancel{border:1px solid #dcdcdc;background:#fff;color:#555}
.imr-status{margin:8px 0 0;font-size:12px;color:#6b6b6b;min-height:1em}
.imr-status.is-error{color:#b3261e}
.imr-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.imr-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483300;padding:10px 18px;border-radius:999px;background:#0c0d0d;color:#fff;font-family:system-ui,sans-serif;font-size:13px;font-weight:600;box-shadow:0 8px 28px rgba(0,0,0,.3);max-width:calc(100vw - 32px)}
`;
