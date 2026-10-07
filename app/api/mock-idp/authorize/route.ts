import { config } from "@/lib/config";
import { issueAuthCode } from "@/lib/idp/mock";

/** The mock sign-in page posts here; we redirect back with an auth code like Okta would. */
export async function POST(req: Request) {
  if (config.mode !== "mock") return new Response("Not found", { status: 404 });
  const form = await req.formData();
  const state = String(form.get("state") ?? "");
  try {
    const code = issueAuthCode(String(form.get("persona")), String(form.get("code_challenge")), String(form.get("nonce")));
    return Response.redirect(`${config.baseUrl}/api/auth/callback?${new URLSearchParams({ code, state })}`, 303);
  } catch (err) {
    return Response.redirect(`${config.baseUrl}/?error=${encodeURIComponent((err as Error).message)}`, 303);
  }
}
