import type { JWTPayload } from "jose";
import type { Emit } from "../inspector";
import type { DemoUser } from "../store";

export interface TokenSet {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
  issued_token_type?: string;
}

export type CibaPoll =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "approved"; tokens: TokenSet }
  | { status: "denied" | "expired" | "error"; error: string };

export interface IdentityProvider {
  /** Shown in the UI, e.g. "Okta (acme.okta.com)" or "Mock Okta". */
  label: string;
  authorizeUrl(args: { state: string; nonce: string; codeChallenge: string }): Promise<string>;
  /** Authorization code + PKCE → tokens. */
  exchangeCode(args: { code: string; codeVerifier: string; nonce: string }, emit: Emit): Promise<{ tokens: TokenSet; user: DemoUser }>;
  /** RFC 8693 token exchange: user's token → API token for the agent. */
  tokenExchange(args: { subjectToken: string; audience: string; scope: string }, emit: Emit): Promise<TokenSet>;
  /** OpenID CIBA: ask the user to approve on their device. */
  startCiba(
    args: { user: DemoUser; idToken?: string; scope: string; bindingMessage: string },
    emit: Emit,
  ): Promise<{ auth_req_id: string; expires_in: number; interval: number }>;
  pollCiba(authReqId: string, emit: Emit): Promise<CibaPoll>;
  /** Used by the downstream API to validate bearer tokens. */
  verifyAccessToken(token: string): Promise<JWTPayload>;
  logoutUrl(idToken?: string): Promise<string>;
}
