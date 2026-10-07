import { resetBilling } from "@/lib/billing/data";
import { getSession, resetConversation } from "@/lib/store";

/** Clears the chat, inspector (except sign-in events), token cache and billing data. */
export async function POST() {
  resetConversation(await getSession());
  resetBilling();
  return Response.json({ ok: true });
}
