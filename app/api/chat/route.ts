import { runAgent } from "@/lib/agent/run";
import type { NewEvent } from "@/lib/inspector";
import { getSession, recordEvent } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs one agent turn and streams newline-delimited JSON back to the browser:
 *   {type:"event", event}   – token inspector entries, as they happen
 *   {type:"assistant", text} – agent replies
 *   {type:"done"} | {type:"error", message}
 */
export async function POST(req: Request) {
  const session = await getSession();
  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  const text = String(message ?? "").trim();
  if (!session.user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!text) return Response.json({ error: "Empty message." }, { status: 400 });

  const apiBase = new URL(req.url).origin;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (obj: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          open = false; // browser went away; keep running so state stays consistent
        }
      };
      const emit = (e: NewEvent) => send({ type: "event", event: recordEvent(session, e) });
      const say = (reply: string) => {
        session.transcript.push({ role: "assistant", text: reply });
        send({ type: "assistant", text: reply });
      };

      session.transcript.push({ role: "user", text });
      const checkpoint = session.messages.length;
      try {
        await runAgent({ session, emit, apiBase }, text, say);
        send({ type: "done" });
      } catch (err) {
        // Roll back a half-finished turn so the next request isn't malformed.
        session.messages.length = checkpoint;
        const msg = (err as Error).message;
        emit({ kind: "error", title: "Agent error", detail: msg });
        send({ type: "error", message: msg });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
