/*
  Plain Node `http` (Aradea's server.mjs shape). At the top of the request
  function:

    import { createNodeHandler } from "imredline/node";
    const imredline = createNodeHandler();
    ...
    if (await imredline(req, res)) return;

  Converts IncomingMessage → Request, runs the shared handler, writes the
  Response back. Returns false (and touches nothing) for URLs that are not
  IMRedline's.
*/

import type { IncomingMessage, ServerResponse } from "node:http";
import { handle, type HandlerOptions } from "../core/handler.js";
import { config } from "../core/env.js";

export function createNodeHandler(opts: HandlerOptions = {}) {
  return async function imredline(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const base = config(opts.env ?? process.env).base;
    const path = req.url || "/";
    if (path !== base && !path.startsWith(base + "/") && !path.startsWith(base + "?")) return false;

    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || "http";
    const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || req.headers.host || "localhost";
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) for (const x of v) headers.append(k, x);
      else if (typeof v === "string") headers.set(k, v);
    }
    if (!headers.has("x-forwarded-for") && req.socket?.remoteAddress) headers.set("x-real-ip", req.socket.remoteAddress);

    const method = (req.method || "GET").toUpperCase();
    let body: Buffer | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > 12 * 1024 * 1024) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Nothing was saved. Remove a sample image or the screenshot and try again." }));
          return true;
        }
        chunks.push(chunk as Buffer);
      }
      body = Buffer.concat(chunks);
    }

    const request = new Request(`${proto}://${host}${path}`, { method, headers, body: (body as BodyInit | undefined) ?? null });
    const response = await handle(request, opts);
    if (!response) return false;

    const out: Record<string, string | string[]> = {};
    const cookies = response.headers.getSetCookie?.() ?? [];
    response.headers.forEach((v, k) => {
      if (k.toLowerCase() !== "set-cookie") out[k] = v;
    });
    if (cookies.length) out["set-cookie"] = cookies;
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
    return true;
  };
}

export { handle } from "../core/handler.js";
