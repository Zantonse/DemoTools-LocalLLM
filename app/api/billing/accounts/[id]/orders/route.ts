import { SCOPES } from "@/lib/config";
import { authorize } from "@/lib/billing/auth";
import { ACCOUNTS, billing } from "@/lib/billing/data";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req, SCOPES.read);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const account = ACCOUNTS.find((a) => a.id === id.toUpperCase());
  if (!account) return Response.json({ error: "not_found", error_description: `No account ${id}` }, { status: 404 });
  return Response.json({ account, orders: billing.orders.filter((o) => o.accountId === account.id) });
}
