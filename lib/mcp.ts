import { parseArgs, runTool, TOOL_INFO } from "./agent/tools";
import type { NewEvent } from "./inspector";
import { recordEvent, store, type Session } from "./store";

/**
 * A minimal MCP server (Streamable HTTP transport, JSON-RPC 2.0) exposing the
 * billing tools to external agents such as Hermes Agent, Claude Desktop or
 * Cursor. Each tool call goes through exactly the same Okta flow as the
 * built-in agent: token exchange per call, CIBA approval for high-value refunds.
 *
 * The bearer key only links the MCP client to a signed-in demo session (a
 * stand-in for MCP's OAuth sign-in). It grants no access on its own.
 */

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "acme-billing", title: "Acme Billing (Okta-protected)", version: "0.1.0" };

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

export function sessionForKey(header: string | null): Session | undefined {
  const key = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  const id = key ? store.mcpKeys.get(key) : undefined;
  return id ? store.sessions.get(id) : undefined;
}

const ok = (id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

export function isToolCall(req: JsonRpcRequest) {
  return req.method === "tools/call";
}

export async function handle(req: JsonRpcRequest, session: Session, apiBase: string): Promise<JsonRpcResponse | null> {
  const emit = (e: NewEvent) => recordEvent(session, { ...e, tags: [...new Set(["mcp", ...(e.tags ?? [])])] });

  switch (req.method) {
    case "initialize": {
      const requested = String(req.params?.protocolVersion ?? "");
      const client = req.params?.clientInfo as { name?: string; version?: string } | undefined;
      const clientName = client?.name ? `${client.name}${client.version ? ` ${client.version}` : ""}` : "MCP client";
      if (session.mcp) session.mcp.client = clientName;
      emit({
        kind: "info",
        title: `External agent connected over MCP: ${clientName}`,
        detail: "It can call the billing tools, but every call still goes through Okta: scoped token exchange, and phone approval for big refunds.",
      });
      return ok(req.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Acme Billing tools. Account ids look like ACC-200, order ids like ORD-2001. " +
          `Refunds above ${store.settings.approvalThreshold} USD wait for the user's approval on their phone; report the outcome and do not retry a denied refund.`,
      });
    }
    case "ping":
      return ok(req.id, {});
    case "tools/list":
      return ok(req.id, {
        tools: TOOL_INFO.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
      });
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      if (!TOOL_INFO.some((t) => t.name === name)) return fail(req.id, -32602, `Unknown tool: ${name}`);
      const toolResult = (text: string, isError = false) => ok(req.id, { content: [{ type: "text", text }], isError });
      if (!session.user) return toolResult("The demo user is signed out. Sign in to the demo web app, then try again.", true);

      const parsed = parseArgs(name, JSON.stringify(req.params?.arguments ?? {}));
      emit({
        kind: "info",
        title: `${session.mcp?.client ?? "MCP agent"} called ${name}`,
        detail: parsed.ok ? JSON.stringify(parsed.args) : parsed.error,
      });
      if (!parsed.ok) return toolResult(parsed.error, true);
      try {
        const text = await runTool({ session, emit, apiBase }, name, parsed.args);
        return toolResult(text, /"error"/.test(text) && !/"refund"/.test(text));
      } catch (err) {
        emit({ kind: "error", title: `Tool ${name} failed`, detail: (err as Error).message });
        return toolResult((err as Error).message, true);
      }
    }
    default:
      // Notifications (no id) need no response; unknown requests get "method not found".
      return req.id === undefined || req.id === null ? null : fail(req.id, -32601, `Method not found: ${req.method}`);
  }
}
