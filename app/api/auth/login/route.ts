import { createHash, randomBytes } from "node:crypto";
import { config } from "@/lib/config";
import { idp } from "@/lib/idp";
import { getSession } from "@/lib/store";

export async function GET() {
  const session = await getSession();
  const codeVerifier = randomBytes(32).toString("base64url");
  const login = {
    state: randomBytes(16).toString("base64url"),
    nonce: randomBytes(16).toString("base64url"),
    codeVerifier,
  };
  session.login = login;
  try {
    const url = await idp.authorizeUrl({
      state: login.state,
      nonce: login.nonce,
      codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    });
    return Response.redirect(url, 302);
  } catch (err) {
    return Response.redirect(`${config.baseUrl}/?error=${encodeURIComponent((err as Error).message)}`, 302);
  }
}
