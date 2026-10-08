import { handle, isToolCall, sessionForKey, type JsonRpcRequest } from "@/lib/mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function unauthorized() {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unknown MCP key. Copy a fresh one from the demo app (🔌 Connect agent)." } },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="acme-billing-mcp"' } },
  );
}

/** Streamable HTTP: one JSON-RPC message (or batch) per POST. */
export async function POST(req: Request) {
  const session = sessionForKey(req.headers.get("authorization"));
  if (!session) return unauthorized();

  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const messages = Array.isArray(body) ? body : [body];
  const apiBase = new URL(req.url).origin;
  const wantsStream = (req.headers.get("accept") ?? "").includes("text/event-stream");

  // Tool calls can wait minutes for a phone approval, so stream them as SSE
  // with keepalives instead of holding a silent HTTP response open.
  if (wantsStream && messages.some(isToolCall)) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const write = (s: string) => {
          try {
            controller.enqueue(encoder.encode(s));
          } catch {
            // client went away
          }
        };
        const keepalive = setInterval(() => write(": keepalive\n\n"), 10_000);
        try {
          for (const m of messages) {
            const res = await handle(m, session, apiBase);
            if (res) write(`event: message\ndata: ${JSON.stringify(res)}\n\n`);
          }
        } finally {
          clearInterval(keepalive);
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
  }

  const results = (await Promise.all(messages.map((m) => handle(m, session, apiBase)))).filter(Boolean);
  if (!results.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? results : results[0]);
}

/** No server-initiated stream; clients fall back to request/response. */
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, DELETE" } });
}

export function DELETE() {
  return new Response(null, { status: 200 });
}
