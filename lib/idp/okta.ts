import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "../config";
import { redactForm, redactTokens, type Emit } from "../inspector";
import type { DemoUser } from "../store";
import type { CibaPoll, IdentityProvider, TokenSet } from "./types";

/**
 * Real Okta, driven entirely by standard OAuth/OIDC endpoints discovered from
 * the custom authorization server's metadata. Every call to Okta is logged to
 * the token inspector with secrets redacted.
 */

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  backchannel_authentication_endpoint?: string;
}

let discovery: Promise<Discovery> | undefined;
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getDiscovery() {
  if (!config.okta.issuer) throw new Error("OKTA_ISSUER is not set. See docs/OKTA_SETUP.md.");
  discovery ??= fetch(`${config.okta.issuer}/.well-known/openid-configuration`).then(async (res) => {
    if (!res.ok) {
      discovery = undefined;
      throw new Error(`Okta discovery failed (${res.status}) for ${config.okta.issuer}`);
    }
    return (await res.json()) as Discovery;
  });
  return discovery;
}

async function postForm(url: string, form: Record<string, string>, emit: Emit, title: string, tags: string[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  emit({
    kind: "http",
    title,
    tags,
    http: {
      method: "POST",
      url,
      status: res.status,
      requestBody: redactForm(form),
      responseBody: redactTokens(body),
    },
  });
  return { ok: res.ok, status: res.status, body };
}

function agentAuth() {
  return { client_id: config.okta.agentClientId, client_secret: config.okta.agentClientSecret };
}

export const oktaIdp: IdentityProvider = {
  label: `Okta (${config.okta.issuer ? new URL(config.okta.issuer).host : "not configured"})`,

  async authorizeUrl({ state, nonce, codeChallenge }) {
    const d = await getDiscovery();
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: config.okta.clientId,
      response_type: "code",
      scope: "openid profile email",
      redirect_uri: `${config.baseUrl}/api/auth/callback`,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  },

  async exchangeCode({ code, codeVerifier, nonce }, emit) {
    const d = await getDiscovery();
    const { ok, body } = await postForm(
      d.token_endpoint,
      {
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: `${config.baseUrl}/api/auth/callback`,
        client_id: config.okta.clientId,
        client_secret: config.okta.clientSecret,
      },
      emit,
      "User signs in: authorization code → tokens",
      ["login", "authorization_code + PKCE"],
    );
    if (!ok) throw new Error(`Code exchange failed: ${body.error_description ?? body.error}`);
    const tokens = body as unknown as TokenSet;
    const idToken = tokens.id_token!;
    const { payload } = await jwtVerify(idToken, (jwks ??= createRemoteJWKSet(new URL(d.jwks_uri))), {
      issuer: d.issuer,
      audience: config.okta.clientId,
    });
    if (payload.nonce !== nonce) throw new Error("ID token nonce mismatch");
    const user: DemoUser = {
      sub: String(payload.sub),
      name: String(payload.name ?? payload.preferred_username ?? payload.sub),
      email: String(payload.email ?? payload.preferred_username ?? ""),
    };
    return { tokens, user };
  },

  async tokenExchange({ subjectToken, audience, scope }, emit) {
    const d = await getDiscovery();
    const { ok, body } = await postForm(
      d.token_endpoint,
      {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: subjectToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
        audience,
        scope,
        ...agentAuth(),
      },
      emit,
      "Token exchange (RFC 8693): user token → scoped API token",
      ["token-exchange"],
    );
    if (!ok) throw new Error(`Token exchange failed: ${body.error_description ?? body.error}`);
    return body as unknown as TokenSet;
  },

  async startCiba({ user, idToken, scope, bindingMessage }, emit) {
    const d = await getDiscovery();
    if (!d.backchannel_authentication_endpoint) {
      throw new Error("This authorization server does not advertise a CIBA endpoint. Enable CIBA (see docs/OKTA_SETUP.md).");
    }
    const hint: Record<string, string> =
      config.okta.cibaHint === "login_hint" || !idToken ? { login_hint: user.email } : { id_token_hint: idToken };
    const { ok, body } = await postForm(
      d.backchannel_authentication_endpoint,
      { scope, binding_message: bindingMessage, ...hint, ...agentAuth() },
      emit,
      "CIBA: agent requests out-of-band user approval",
      ["ciba"],
    );
    if (!ok) throw new Error(`CIBA request failed: ${body.error_description ?? body.error}`);
    return {
      auth_req_id: String(body.auth_req_id),
      expires_in: Number(body.expires_in ?? 300),
      interval: Number(body.interval ?? 5),
    };
  },

  async pollCiba(authReqId, emit): Promise<CibaPoll> {
    const d = await getDiscovery();
    const res = await fetch(d.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "urn:openid:params:grant-type:ciba",
        auth_req_id: authReqId,
        ...agentAuth(),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) {
      emit({
        kind: "http",
        title: "CIBA poll: user approved → token issued",
        tags: ["ciba"],
        http: {
          method: "POST",
          url: d.token_endpoint,
          status: res.status,
          requestBody: { grant_type: "urn:openid:params:grant-type:ciba", auth_req_id: authReqId },
          responseBody: redactTokens(body),
        },
      });
      return { status: "approved", tokens: body as unknown as TokenSet };
    }
    switch (body.error) {
      case "authorization_pending":
        return { status: "pending" };
      case "slow_down":
        return { status: "slow_down" };
      case "access_denied":
        return { status: "denied", error: String(body.error_description ?? "User denied the request") };
      case "expired_token":
        return { status: "expired", error: "The approval request expired" };
      default:
        return { status: "error", error: String(body.error_description ?? body.error ?? res.status) };
    }
  },

  async verifyAccessToken(token): Promise<JWTPayload> {
    const d = await getDiscovery();
    jwks ??= createRemoteJWKSet(new URL(d.jwks_uri));
    const { payload } = await jwtVerify(token, jwks, { issuer: d.issuer, audience: config.apiAudience });
    return payload;
  },

  async logoutUrl(idToken) {
    const d = await getDiscovery();
    if (!d.end_session_endpoint || !idToken) return config.baseUrl;
    const url = new URL(d.end_session_endpoint);
    url.search = new URLSearchParams({ id_token_hint: idToken, post_logout_redirect_uri: config.baseUrl }).toString();
    return url.toString();
  },
};
