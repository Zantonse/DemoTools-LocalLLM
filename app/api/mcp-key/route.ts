import { randomBytes } from "node:crypto";
import { config } from "@/lib/config";
import { getSession, store } from "@/lib/store";

/** Returns (creating if needed) the MCP key that links an external agent to this session. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session.user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { rotate } = (await req.json().catch(() => ({}))) as { rotate?: boolean };
  if (!session.mcp || rotate) {
    if (session.mcp) store.mcpKeys.delete(session.mcp.key);
    session.mcp = { key: `mcp_demo_${randomBytes(18).toString("base64url")}` };
    store.mcpKeys.set(session.mcp.key, session.id);
  }
  const origin = config.baseUrl || new URL(req.url).origin;
  return Response.json({ url: `${origin}/api/mcp`, key: session.mcp.key, client: session.mcp.client ?? null });
}
