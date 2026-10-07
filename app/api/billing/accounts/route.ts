import { SCOPES } from "@/lib/config";
import { authorize } from "@/lib/billing/auth";
import { ACCOUNTS } from "@/lib/billing/data";

export async function GET(req: Request) {
  const auth = await authorize(req, SCOPES.read);
  if (!auth.ok) return auth.response;
  return Response.json({ accounts: ACCOUNTS });
}
