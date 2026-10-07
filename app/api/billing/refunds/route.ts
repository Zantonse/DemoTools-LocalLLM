import { SCOPES } from "@/lib/config";
import { authorize } from "@/lib/billing/auth";
import { billing, recordRefund } from "@/lib/billing/data";
import { store } from "@/lib/store";

export async function GET(req: Request) {
  const auth = await authorize(req, SCOPES.read);
  if (!auth.ok) return auth.response;
  return Response.json({ refunds: billing.refunds });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { order_id?: string; amount?: number; reason?: string };
  const amount = Number(body.amount);
  const order = billing.orders.find((o) => o.id === String(body.order_id ?? "").toUpperCase());
  if (!order) return Response.json({ error: "not_found", error_description: `No order ${body.order_id}` }, { status: 404 });
  if (!(amount > 0) || amount > order.amount) {
    return Response.json({ error: "invalid_amount", error_description: `Amount must be between 0 and ${order.amount}` }, { status: 400 });
  }

  // The API, not the agent, decides what proof a refund needs.
  const required = amount > store.settings.approvalThreshold ? SCOPES.refundHighValue : SCOPES.refund;
  const auth = await authorize(req, required);
  if (!auth.ok) return auth.response;

  const { principal } = auth;
  const refund = recordRefund(
    order,
    amount,
    String(body.reason ?? "unspecified"),
    principal.subject,
    principal.actor,
    principal.method === "static-api-key" ? "shared static API key" : `Okta token with ${required}`,
  );
  return Response.json({ refund, order }, { status: 201 });
}
