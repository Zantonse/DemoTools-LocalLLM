import { config } from "@/lib/config";
import { idp } from "@/lib/idp";
import { tokenView } from "@/lib/inspector";
import { getSession, recordEvent } from "@/lib/store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = await getSession();
  const fail = (msg: string) => Response.redirect(`${config.baseUrl}/?error=${encodeURIComponent(msg)}`, 302);

  const error = url.searchParams.get("error");
  if (error) return fail(url.searchParams.get("error_description") ?? error);
  const code = url.searchParams.get("code");
  const login = session.login;
  if (!code || !login || url.searchParams.get("state") !== login.state) return fail("Sign-in state mismatch. Try again.");
  delete session.login;

  const emit = (e: Parameters<typeof recordEvent>[1]) =>
    recordEvent(session, { ...e, tags: [...new Set([...(e.tags ?? []), "login"])] });
  try {
    const { tokens, user } = await idp.exchangeCode({ code, codeVerifier: login.codeVerifier, nonce: login.nonce }, emit);
    session.user = user;
    session.accessToken = tokens.access_token;
    session.idToken = tokens.id_token;
    if (tokens.id_token) {
      emit({ kind: "token", title: `${user.name} signed in – ID token`, detail: "Who the user is, for the app.", token: tokenView("ID token", tokens.id_token) });
    }
    emit({
      kind: "token",
      title: "User access token (held by the app, not the agent)",
      detail: "The agent never sees the user's password, and never gets this token's full power – it exchanges it for narrower ones.",
      token: tokenView("User access token", tokens.access_token),
    });
  } catch (err) {
    return fail((err as Error).message);
  }
  return Response.redirect(`${config.baseUrl}/`, 302);
}
