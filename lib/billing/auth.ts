import type { JWTPayload } from "jose";
import { config } from "../config";
import { idp } from "../idp";

/**
 * Bearer-token checks for the demo "Acme Billing" API. This is the resource
 * server: it trusts Okta-issued tokens (signature, issuer, audience, expiry)
 * and enforces scopes. In legacy mode it also accepts the shared static key.
 */

export interface Principal {
  /** The human the call is on behalf of (or the service account in legacy mode). */
  subject: string;
  /** The agent actually making the call, from the `act` claim. */
  actor: string;
  scopes: string[];
  method: "okta-token" | "static-api-key";
  claims?: JWTPayload;
}

export type AuthResult = { ok: true; principal: Principal } | { ok: false; response: Response };

function deny(status: 401 | 403, error: string, description: string, scope?: string) {
  const parts = [`Bearer error="${error}"`, `error_description="${description}"`];
  if (scope) parts.push(`scope="${scope}"`);
  return Response.json({ error, error_description: description, ...(scope ? { required_scope: scope } : {}) }, {
    status,
    headers: { "WWW-Authenticate": parts.join(", ") },
  });
}

export async function authorize(req: Request, requiredScope: string): Promise<AuthResult> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, response: deny(401, "invalid_request", "Missing bearer token") };

  if (token === config.legacyApiKey) {
    // The anti-pattern: one key, every permission, no idea which user asked.
    return {
      ok: true,
      principal: { subject: "svc-billing-integration", actor: "unknown (shared API key)", scopes: ["*"], method: "static-api-key" },
    };
  }

  let claims: JWTPayload;
  try {
    claims = await idp.verifyAccessToken(token);
  } catch (err) {
    return { ok: false, response: deny(401, "invalid_token", (err as Error).message) };
  }
  const scopes = Array.isArray(claims.scp) ? (claims.scp as string[]) : String(claims.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.includes(requiredScope)) {
    return { ok: false, response: deny(403, "insufficient_scope", `Token is missing scope ${requiredScope}`, requiredScope) };
  }
  const act = claims.act as { sub?: string } | undefined;
  return {
    ok: true,
    principal: {
      subject: String(claims.sub),
      actor: act?.sub ?? String(claims.cid ?? "unknown"),
      scopes,
      method: "okta-token",
      claims,
    },
  };
}
