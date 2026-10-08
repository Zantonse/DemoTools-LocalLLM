import { getSession } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Inspector events after a timestamp – lets the UI follow activity from MCP agents. */
export async function GET(req: Request) {
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  const session = await getSession();
  return Response.json({ events: session.events.filter((e) => e.ts > after), mcpClient: session.mcp?.client ?? null });
}
