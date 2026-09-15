/*
  Static files the handler serves: the widget bundle, the queue client and
  html2canvas. This source file is a STUB — `scripts/build.mjs` overwrites
  dist/core/assets.js with the real contents after bundling, so the package
  never reads the filesystem at runtime (Next.js bundles server code and
  `import.meta.url` is not a file path there).
*/
export const assets: Record<string, string> = {};
export const assetTypes: Record<string, string> = {
  "widget.js": "text/javascript; charset=utf-8",
  "queue.js": "text/javascript; charset=utf-8",
  "clips.js": "text/javascript; charset=utf-8",
  "html2canvas.js": "text/javascript; charset=utf-8",
};
