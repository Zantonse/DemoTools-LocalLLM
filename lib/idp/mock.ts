import { createHash, randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair, jwtVerify, type CryptoKey, type JWTPayload } from "jose";
import { agentClientId, config, MOCK_ISSUER } from "../config";
import { redactForm, redactTokens, type Emit } from "../inspector";
import type { DemoUser } from "../store";
import type { CibaPoll, IdentityProvider, TokenSet } from "./types";

/**
 * A tiny simulated Okta authorization server. It mints real, signed RS256 JWTs
 * shaped like Okta access tokens (scp, cid, uid, act) so the token inspector
 * looks exactly like the live demo – without needing a tenant or Wi‑Fi.
 */

export interface Persona extends DemoUser {
  title: string;
}

export const PERSONAS: Persona[] = [
  { sub: "00u1alexrivera", name: "Alex Rivera", email: "alex.rivera@acme.example", title: "Support Manager" },
  { sub: "00u2jordanlee", name: "Jordan Lee", email: "jordan.lee@acme.example", title: "Support Agent" },
];

export interface CibaRequest {
  authReqId: string;
  user: DemoUser;
  scope: string;
  bindingMessage: string;
  clientId: string;
  status: "pending" | "approved" | "denied";
  createdAt: number;
  expiresAt: number;
}

interface MockState {
  keys?: Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; kid: string }>;
  codes: Map<string, { user: DemoUser; codeChallenge: string; nonce: string; expiresAt: number }>;
  ciba: Map<string, CibaRequest>;
}

const g = globalThis as typeof globalThis & { __o4aaMockIdp?: MockState };
const state: MockState = (g.__o4aaMockIdp ??= { codes: new Map(), ciba: new Map() });

const MOCK_BASE = "https://mock-okta.demo/oauth2/default/v1";
const ACCESS_TTL = 3600;
const EXCHANGED_TTL = 300;

function keys() {
  state.keys ??= generateKeyPair("RS256", { extractable: true }).then(async (pair) => {
    const jwk = await exportJWK(pair.publicKey);
    const kid = createHash("sha256").update(JSON.stringify(jwk)).digest("base64url").slice(0, 16);
    return { ...pair, kid };
  });
  return state.keys;
}

async function sign(payload: JWTPayload, audience: string, ttl: number) {
  const { privateKey, kid } = await keys();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setIssuer(MOCK_ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setJti(`AT.${randomUUID()}`)
    .sign(privateKey);
}

async function verify(token: string, audience: string) {
  const { publicKey } = await keys();
  const { payload } = await jwtVerify(token, publicKey, { issuer: MOCK_ISSUER, audience });
  return payload;
}

function logCall(emit: Emit, title: string, tags: string[], path: string, form: Record<string, string>, response: Record<string, unknown>, status = 200) {
  emit({
    kind: "http",
    title,
    tags,
    http: {
      method: "POST",
      url: `${MOCK_BASE}${path}`,
      status,
      requestBody: redactForm(form),
      responseBody: redactTokens(response),
      simulated: true,
    },
  });
}

/** Called by the mock sign-in page when the presenter picks a persona. */
export function issueAuthCode(personaSub: string, codeChallenge: string, nonce: string) {
  const user = PERSONAS.find((p) => p.sub === personaSub);
  if (!user) throw new Error("Unknown persona");
  const code = randomUUID();
  state.codes.set(code, { user, codeChallenge, nonce, expiresAt: Date.now() + 60_000 });
  return code;
}

export function listCibaRequests() {
  const now = Date.now();
  return [...state.ciba.values()].filter((r) => r.status === "pending" && r.expiresAt > now);
}

export function decideCiba(authReqId: string, decision: "approved" | "denied") {
  const req = state.ciba.get(authReqId);
  if (!req || req.status !== "pending") return false;
  req.status = decision;
  return true;
}

export const mockIdp: IdentityProvider = {
  label: "Mock Okta (offline)",

  async authorizeUrl({ state: st, nonce, codeChallenge }) {
    const q = new URLSearchParams({ state: st, nonce, code_challenge: codeChallenge });
    return `${config.baseUrl}/mock-idp/login?${q}`;
  },

  async exchangeCode({ code, codeVerifier, nonce }, emit) {
    const entry = state.codes.get(code);
    state.codes.delete(code);
    if (!entry || entry.expiresAt < Date.now()) throw new Error("Invalid or expired authorization code");
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    if (challenge !== entry.codeChallenge) throw new Error("PKCE verification failed");
    if (entry.nonce !== nonce) throw new Error("Nonce mismatch");
    const { user } = entry;
    const clientId = "0oa-acme-support-portal";
    const access_token = await sign(
      { sub: user.email, uid: user.sub, cid: clientId, scp: ["openid", "profile", "email"] },
      "api://default",
      ACCESS_TTL,
    );
    const id_token = await sign({ sub: user.sub, name: user.name, email: user.email, nonce, amr: ["pwd", "mfa"] }, clientId, ACCESS_TTL);
    const tokens: TokenSet = { token_type: "Bearer", expires_in: ACCESS_TTL, scope: "openid profile email", access_token, id_token };
    logCall(
      emit,
      "User signs in: authorization code → tokens",
      ["login", "authorization_code + PKCE"],
      "/token",
      { grant_type: "authorization_code", code, code_verifier: codeVerifier, client_id: clientId, redirect_uri: `${config.baseUrl}/api/auth/callback` },
      tokens as unknown as Record<string, unknown>,
    );
    return { tokens, user };
  },

  async tokenExchange({ subjectToken, audience, scope }, emit) {
    const form = {
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: subjectToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience,
      scope,
      client_id: agentClientId(),
      client_secret: "x",
    };
    const subject = await verify(subjectToken, "api://default");
    // Policy: token exchange may grant read + low-value refunds, never high-value ones.
    const allowed = new Set<string>([ "billing:read", "refunds:write" ]);
    const denied = scope.split(" ").filter((s) => !allowed.has(s));
    if (denied.length) {
      const err = { error: "invalid_scope", error_description: `Policy does not allow ${denied.join(", ")} via token exchange` };
      logCall(emit, "Token exchange (RFC 8693) denied by policy", ["token-exchange"], "/token", form, err, 400);
      throw new Error(err.error_description);
    }
    const access_token = await sign(
      { sub: subject.sub, uid: subject.uid, cid: agentClientId(), scp: scope.split(" "), act: { sub: agentClientId() } },
      audience,
      EXCHANGED_TTL,
    );
    const tokens: TokenSet = {
      token_type: "Bearer",
      expires_in: EXCHANGED_TTL,
      scope,
      access_token,
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    };
    logCall(emit, "Token exchange (RFC 8693): user token → scoped API token", ["token-exchange"], "/token", form, tokens as unknown as Record<string, unknown>);
    return tokens;
  },

  async startCiba({ user, idToken, scope, bindingMessage }, emit) {
    const authReqId = randomUUID();
    const expires_in = 120;
    state.ciba.set(authReqId, {
      authReqId,
      user,
      scope,
      bindingMessage,
      clientId: agentClientId(),
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + expires_in * 1000,
    });
    const response = { auth_req_id: authReqId, expires_in, interval: 2 };
    logCall(
      emit,
      "CIBA: agent requests out-of-band user approval",
      ["ciba"],
      "/bc-authorize",
      { scope, binding_message: bindingMessage, ...(idToken ? { id_token_hint: idToken } : { login_hint: user.email }), client_id: agentClientId(), client_secret: "x" },
      response,
    );
    return response;
  },

  async pollCiba(authReqId, emit): Promise<CibaPoll> {
    const req = state.ciba.get(authReqId);
    if (!req) return { status: "error", error: "invalid auth_req_id" };
    if (req.status === "denied") return { status: "denied", error: "User denied the request" };
    if (req.status === "pending") return req.expiresAt < Date.now() ? { status: "expired", error: "The approval request expired" } : { status: "pending" };
    state.ciba.delete(authReqId);
    const scopes = req.scope.split(" ");
    const access_token = await sign(
      {
        sub: req.user.email,
        uid: req.user.sub,
        cid: req.clientId,
        scp: scopes.filter((s) => s !== "openid"),
        act: { sub: req.clientId },
        amr: ["okta_verify", "user_presence"],
        binding_message: req.bindingMessage,
      },
      config.apiAudience,
      EXCHANGED_TTL,
    );
    const tokens: TokenSet = { token_type: "Bearer", expires_in: EXCHANGED_TTL, scope: req.scope, access_token };
    logCall(
      emit,
      "CIBA poll: user approved → token issued",
      ["ciba"],
      "/token",
      { grant_type: "urn:openid:params:grant-type:ciba", auth_req_id: authReqId, client_id: req.clientId },
      tokens as unknown as Record<string, unknown>,
    );
    return { status: "approved", tokens };
  },

  verifyAccessToken: (token) => verify(token, config.apiAudience),

  async logoutUrl() {
    return config.baseUrl;
  },
};
