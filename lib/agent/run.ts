import { config } from "../config";
import { store } from "../store";
import { chat, type ChatMessage } from "./llm";
import { runTool, TOOLS, type AgentContext } from "./tools";

export type SayFn = (text: string) => void;

const MAX_TURNS = 6;

function systemPrompt(ctx: AgentContext) {
  const user = ctx.session.user;
  return [
    `You are ${config.agent.name}, an AI agent that helps Acme's customer support team work in the Acme Billing system.`,
    `You act on behalf of the signed-in user${user ? `, ${user.name} (${user.email})` : ""}.`,
    "Rules:",
    "- Always use the tools to get data. Never make up accounts, orders, ids or amounts.",
    "- Account ids look like ACC-200 and order ids look like ORD-2001. If you only know an account name, call list_accounts first to find its id.",
    "- To refund, call issue_refund with order_id, amount (a plain number such as 4800) and a short reason.",
    `- Refunds above ${store.settings.approvalThreshold} USD need the user's approval on their phone. issue_refund asks for it and waits. If it reports the approval was denied, tell the user and do not call it again.`,
    "- Keep replies short: two to four sentences or a compact list. Format amounts as USD.",
  ].join("\n");
}

/** Checks and coerces tool arguments; small models often send "$4,800" or omit fields. */
function parseArgs(name: string, raw: string): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
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

async function runLocal(ctx: AgentContext, say: SayFn) {
  const { session } = ctx;
  const seen = new Set<string>();
  const refundedOrders = new Set<string>();
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(ctx) }, ...session.messages];
    const { content, toolCalls } = await chat(messages, TOOLS);
    session.messages.push({ role: "assistant", content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    if (!toolCalls.length) {
      say(content || "I'm not sure how to help with that. Try one of the suggested prompts.");
      return;
    }
    if (content) say(content);

    for (const call of toolCalls) {
      const name = call.function.name;
      const key = `${name}:${call.function.arguments}`;
      let result: string;
      const parsed = parseArgs(name, call.function.arguments);
      if (!parsed.ok) {
        ctx.emit({ kind: "warning", title: `Model sent bad arguments to ${name}`, detail: parsed.error, tags: ["local llm"] });
        result = JSON.stringify({ error: parsed.error });
      } else if (seen.has(key)) {
        // Small models sometimes repeat the same call in a loop.
        result = JSON.stringify({ error: "You already made this exact call. Use the earlier result and answer the user." });
      } else if (name === "issue_refund" && refundedOrders.has(String(parsed.args.order_id).toUpperCase())) {
        result = JSON.stringify({ error: "A refund for this order was already attempted in this request. Do not retry; report the outcome." });
      } else {
        seen.add(key);
        if (name === "issue_refund") refundedOrders.add(String(parsed.args.order_id).toUpperCase());
        try {
          result = await runTool(ctx, name, parsed.args);
        } catch (err) {
          ctx.emit({ kind: "error", title: `Tool ${name} failed`, detail: (err as Error).message });
          result = JSON.stringify({ error: (err as Error).message });
        }
      }
      session.messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  say("I stopped after too many steps. Try a narrower request, or switch to the scripted agent.");
}

/**
 * Deterministic backup agent: no model needed, so the identity flows can
 * always be demoed. Understands the suggested prompts.
 */
async function runScripted(ctx: AgentContext, text: string, say: SayFn) {
  const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const lower = text.toLowerCase();
  const orderId = text.match(/ord-\d+/i)?.[0].toUpperCase();
  const accountId = text.match(/acc-\d+/i)?.[0].toUpperCase();

  if (/refund/.test(lower) && orderId) {
    const amountMatch = text.replace(/ord-\d+/gi, "").match(/\$?\s*(\d[\d,]*(?:\.\d{1,2})?)/);
    if (!amountMatch) return say(`How much should I refund on ${orderId}?`);
    const amount = Number(amountMatch[1].replace(/,/g, ""));
    const reason = text.split(/—|–| - |because|reason:/i)[1]?.trim() || "Customer request";
    const result = JSON.parse(await runTool(ctx, "issue_refund", { order_id: orderId, amount, reason }));
    if (result.refund) return say(`Done: refunded ${usd(amount)} on ${orderId} (${result.refund.id}). Order status is now ${result.order.status.replace("_", " ")}.`);
    if (result.error === "approval_denied") return say(`The ${usd(amount)} refund on ${orderId} was not approved, so I didn't issue it.`);
    return say(`The refund failed: ${result.error_description ?? result.error}.`);
  }

  if (/order/.test(lower)) {
    const accounts = JSON.parse(await runTool(ctx, "list_accounts", {})).accounts as { id: string; name: string }[] | undefined;
    const match = accountId ?? accounts?.find((a) => lower.includes(a.name.toLowerCase().split(" ")[0]))?.id;
    if (!match) return say("Which account? For example: “What orders does Initech have?”");
    const result = JSON.parse(await runTool(ctx, "get_account_orders", { account_id: match }));
    if (!result.orders) return say(`I couldn't load orders: ${result.error_description ?? result.error}.`);
    const lines = (result.orders as { id: string; item: string; amount: number; status: string }[]).map(
      (o) => `- ${o.id}: ${o.item}, ${usd(o.amount)} (${o.status.replace("_", " ")})`,
    );
    return say(`Orders for ${result.account.name}:\n${lines.join("\n")}`);
  }

  const result = JSON.parse(await runTool(ctx, "list_accounts", {}));
  if (!result.accounts) return say(`I couldn't load accounts: ${result.error_description ?? result.error}.`);
  const lines = (result.accounts as { id: string; name: string; tier: string; arr: number }[]).map(
    (a) => `- ${a.name} (${a.id}): ${a.tier}, ${usd(a.arr)} ARR`,
  );
  say(`Here are your accounts:\n${lines.join("\n")}`);
}

export async function runAgent(ctx: AgentContext, text: string, say: SayFn) {
  ctx.session.messages.push({ role: "user", content: text });
  if (store.settings.engine === "local") return runLocal(ctx, say);
  return runScripted(ctx, text, say);
}
