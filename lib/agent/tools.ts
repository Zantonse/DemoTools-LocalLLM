import { config, SCOPES } from "../config";
import { idp, secondsLeft } from "../idp";
import { abbreviate, tokenView, type Emit } from "../inspector";
import { store, type Session } from "../store";
import type { ToolSpec } from "./llm";

/**
 * The agent's tools. Each one shows the identity work Okta does behind the
 * scenes: getting a properly scoped, user-bound token before every API call,
 * and pausing for human approval when the action is risky.
 */

export interface AgentContext {
  session: Session;
  emit: Emit;
  /** Origin of this app, where the demo billing API lives. */
  apiBase: string;
}

const TOOL_DEFS = [
  {
    name: "list_accounts",
    description: "List the customer accounts in Acme Billing with tier, ARR and owner.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "get_account_orders",
    description: "Get one account's recent orders (id, item, amount, status). Use the account id, e.g. ACC-200.",
    parameters: {
      type: "object",
      properties: { account_id: { type: "string", description: "Account id such as ACC-100" } },
      required: ["account_id"],
      additionalProperties: false,
    },
  },
  {
    name: "issue_refund",
    description:
      "Issue a refund against an order. Large refunds may require the signed-in user to approve on their phone; " +
      "the tool waits for that decision and reports the outcome.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Order id such as ORD-2001" },
        amount: { type: "number", description: "Refund amount in USD" },
        reason: { type: "string", description: "Short reason for the refund" },
      },
      required: ["order_id", "amount", "reason"],
      additionalProperties: false,
    },
  },
];

export const TOOL_INFO = TOOL_DEFS;

export const TOOLS: ToolSpec[] = TOOL_DEFS.map(({ name, description, parameters }) => ({
  type: "function",
  function: { name, description, parameters },
}));

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gets a token for the billing API carrying `scope`, via token exchange (or the legacy key). */
async function getApiToken(ctx: AgentContext, scope: string): Promise<string> {
  const { session, emit } = ctx;
  if (store.settings.legacyMode) {
    emit({
      kind: "warning",
      title: "Agent uses the shared static API key",
      detail:
        "Legacy mode: no user context, no scopes, never expires. Every agent run – and anyone who finds this key – has full access to the billing system.",
      token: tokenView("Static API key (from .env)", config.legacyApiKey),
      tags: ["legacy", "no identity"],
    });
    return config.legacyApiKey;
  }

  const cached = session.tokenCache[scope];
  if (cached && cached.exp - Date.now() > 30_000) {
    emit({
      kind: "info",
      title: `Reusing cached API token (${scope})`,
      detail: `Still valid for ${Math.round((cached.exp - Date.now()) / 1000)}s – no new round-trip to Okta.`,
      tags: ["token-exchange", "cache"],
    });
    return cached.token;
  }

  if (!session.accessToken || secondsLeft(session.accessToken) < 5) {
    throw new Error("The user's session has expired. Sign in again.");
  }
  emit({
    kind: "info",
    title: `Agent needs "${scope}" for the Acme Billing API`,
    detail:
      "Instead of holding a long-lived key, the agent trades the signed-in user's token for a short-lived token that is " +
      "scoped to one API, carries the user's identity, and names the agent as the actor.",
    tags: ["token-exchange"],
  });
  const tokens = await idp.tokenExchange({ subjectToken: session.accessToken, audience: config.apiAudience, scope }, emit);
  emit({
    kind: "token",
    title: "Delegated token issued to the agent",
    detail: "sub = the user · act.sub = the agent · aud = one API · scp = only what's needed · short expiry.",
    token: tokenView(`Agent → Acme Billing (${scope})`, tokens.access_token),
    tags: ["token-exchange"],
  });
  session.tokenCache[scope] = { token: tokens.access_token, exp: Date.now() + (tokens.expires_in ?? 300) * 1000 };
  return tokens.access_token;
}

async function callApi(ctx: AgentContext, method: "GET" | "POST", path: string, token: string, body?: unknown) {
  const res = await fetch(`${ctx.apiBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  ctx.emit({
    kind: res.ok ? "http" : "error",
    title: `Agent → Acme Billing: ${method} ${path}`,
    http: {
      method,
      url: `${ctx.apiBase}${path}`,
      status: res.status,
      requestHeaders: {
        Authorization: `Bearer ${abbreviate(token)}`,
        ...(res.headers.get("www-authenticate") ? { "← WWW-Authenticate": res.headers.get("www-authenticate")! } : {}),
      },
      requestBody: body,
      responseBody: json,
    },
    tags: ["resource server"],
  });
  return { status: res.status, ok: res.ok, json };
}

/** Human-in-the-loop: CIBA push to the user, then poll until they decide. */
async function requestApproval(ctx: AgentContext, scope: string, bindingMessage: string): Promise<string | { denied: string }> {
  const { session, emit } = ctx;
  if (!session.user) throw new Error("No signed-in user to ask for approval.");
  const start = await idp.startCiba({ user: session.user, idToken: session.idToken, scope, bindingMessage }, emit);
  emit({
    kind: "approval",
    title: `Waiting for ${session.user.name} to approve on their phone…`,
    detail:
      config.mode === "mock"
        ? "Open the approver page (phone icon, top right) to approve or deny the push."
        : "An Okta Verify push was sent to the user's enrolled device.",
    approval: {
      authReqId: start.auth_req_id,
      bindingMessage,
      approveUrl: config.mode === "mock" ? `${config.baseUrl}/approve` : undefined,
    },
    tags: ["ciba", "human-in-the-loop"],
  });

  let interval = Math.max(1, start.interval) * 1000;
  const deadline = Date.now() + Math.min(start.expires_in, 180) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const result = await idp.pollCiba(start.auth_req_id, emit);
    if (result.status === "pending") continue;
    if (result.status === "slow_down") {
      interval += 5000;
      continue;
    }
    if (result.status === "approved") {
      emit({
        kind: "token",
        title: "Approval-bound token issued",
        detail: "Minted only after the user said yes. It carries the high-value scope, the agent as actor, and is single-purpose.",
        token: tokenView(`Agent → Acme Billing (${scope})`, result.tokens.access_token),
        tags: ["ciba"],
      });
      return result.tokens.access_token;
    }
    emit({ kind: "error", title: `Approval ${result.status}`, detail: result.error, tags: ["ciba"] });
    return { denied: result.error };
  }
  emit({ kind: "error", title: "Approval timed out", tags: ["ciba"] });
  return { denied: "The approval request timed out." };
}

/** Checks and coerces tool arguments; small models often send "$4,800" or omit fields. */
export function parseArgs(name: string, raw: string): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  let args: Record<string, unknown>;
  try {
    args = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, error: `Arguments for ${name} were not valid JSON. Send a JSON object.` };
  }
  if (name === "get_account_orders" && !args.account_id) return { ok: false, error: "account_id is required, e.g. ACC-200." };
  if (name === "issue_refund") {
    const amount = Number(String(args.amount ?? "").replace(/[$,\s]/g, ""));
    if (!args.order_id) return { ok: false, error: "order_id is required, e.g. ORD-2001." };
    if (!(amount > 0)) return { ok: false, error: "amount must be a positive number, e.g. 4800." };
    args = { ...args, amount, reason: args.reason || "Customer request" };
  }
  return { ok: true, args };
}

type ToolInput = Record<string, unknown>;

export async function runTool(ctx: AgentContext, name: string, input: ToolInput): Promise<string> {
  switch (name) {
    case "list_accounts": {
      const token = await getApiToken(ctx, SCOPES.read);
      const res = await callApi(ctx, "GET", "/api/billing/accounts", token);
      return JSON.stringify(res.json);
    }
    case "get_account_orders": {
      const token = await getApiToken(ctx, SCOPES.read);
      const id = encodeURIComponent(String(input.account_id));
      const res = await callApi(ctx, "GET", `/api/billing/accounts/${id}/orders`, token);
      return JSON.stringify(res.json);
    }
    case "issue_refund": {
      const orderId = String(input.order_id).toUpperCase();
      const amount = Number(input.amount);
      const reason = String(input.reason ?? "");
      const threshold = store.settings.approvalThreshold;
      const body = { order_id: orderId, amount, reason };

      if (store.settings.legacyMode) {
        const res = await callApi(ctx, "POST", "/api/billing/refunds", await getApiToken(ctx, SCOPES.refund), body);
        if (res.ok) {
          ctx.emit({
            kind: "warning",
            title: `${usd(amount)} refund executed with no human approval`,
            detail: 'The billing audit log records "svc-billing-integration" – nobody can tell which user (if any) asked for this.',
            tags: ["legacy"],
          });
        }
        return JSON.stringify(res.json);
      }

      if (amount <= threshold) {
        ctx.emit({
          kind: "info",
          title: `${usd(amount)} is within the ${usd(threshold)} autonomous limit`,
          detail: "Policy lets the agent act on the user's behalf without an extra prompt.",
          tags: ["policy"],
        });
        const res = await callApi(ctx, "POST", "/api/billing/refunds", await getApiToken(ctx, SCOPES.refund), body);
        return JSON.stringify(res.json);
      }

      ctx.emit({
        kind: "info",
        title: `${usd(amount)} exceeds the ${usd(threshold)} limit → human approval required`,
        detail: `The billing API requires the "${SCOPES.refundHighValue}" scope, which Okta only issues through a CIBA approval – never through token exchange.`,
        tags: ["policy", "ciba"],
      });
      const approval = await requestApproval(ctx, `openid ${SCOPES.refundHighValue}`, `Approve ${usd(amount)} refund on ${orderId}?`);
      if (typeof approval !== "string") {
        return JSON.stringify({ error: "approval_denied", detail: approval.denied, note: "Do not retry unless the user asks." });
      }
      const res = await callApi(ctx, "POST", "/api/billing/refunds", approval, body);
      if (res.ok) {
        ctx.emit({
          kind: "success",
          title: `Refund completed with ${ctx.session.user?.name}'s approval`,
          detail: "Audit trail shows the user as the subject and the AI agent as the actor.",
          tags: ["ciba"],
        });
      }
      return JSON.stringify(res.json);
    }
    default:
      return JSON.stringify({ error: `Unknown tool ${name}` });
  }
}
