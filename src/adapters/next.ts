/*
  Next.js App Router. One file mounts everything:

    // app/imredline/[[...path]]/route.ts   (⚠️ no leading underscore — Next skips _folders)
    import { imredline } from "imredline/next";
    export const dynamic = "force-dynamic";
    export const { GET, POST, PATCH, DELETE, OPTIONS } = imredline();

  Then in the root layout:  <script src="/imredline/widget.js" defer />
  Node runtime only (the handler uses node:crypto and node:fs).
*/

import { handle, type HandlerOptions } from "../core/handler.js";

type RouteHandler = (req: Request) => Promise<Response>;

export function imredline(opts: HandlerOptions = {}): Record<"GET" | "POST" | "PATCH" | "DELETE" | "OPTIONS", RouteHandler> {
  const h: RouteHandler = async (req) => (await handle(req, opts)) ?? new Response("Not found", { status: 404 });
  return { GET: h, POST: h, PATCH: h, DELETE: h, OPTIONS: h };
}

export { handle } from "../core/handler.js";
