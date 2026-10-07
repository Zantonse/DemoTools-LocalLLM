import { idp } from "@/lib/idp";
import { clearAuth, getSession } from "@/lib/store";

export async function GET() {
  const session = await getSession();
  const target = await idp.logoutUrl(session.idToken).catch(() => "/");
  clearAuth(session);
  return Response.redirect(target, 302);
}
