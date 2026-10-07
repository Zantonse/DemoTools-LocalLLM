import { decodeJwt, decodeProtectedHeader } from "jose";

export type EventKind = "info" | "token" | "http" | "approval" | "warning" | "error" | "success";

export interface TokenView {
  label: string;
  raw: string;
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
}

export interface HttpView {
  method: string;
  url: string;
  status?: number;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseBody?: unknown;
  simulated?: boolean;
}

export interface InspectorEvent {
  id: string;
  ts: number;
  kind: EventKind;
  title: string;
  detail?: string;
  token?: TokenView;
  http?: HttpView;
  /** Short labels rendered as chips, e.g. the OAuth grant type in play. */
  tags?: string[];
  /** For approval events: the pending request the presenter can act on. */
  approval?: { authReqId: string; bindingMessage: string; approveUrl?: string };
}

export type NewEvent = Omit<InspectorEvent, "id" | "ts">;
export type Emit = (event: NewEvent) => void;

export function tokenView(label: string, raw: string): TokenView {
  let header: Record<string, unknown> | null = null;
  let payload: Record<string, unknown> | null = null;
  try {
    header = decodeProtectedHeader(raw) as Record<string, unknown>;
    payload = decodeJwt(raw) as Record<string, unknown>;
  } catch {
    // Opaque token (e.g. the legacy API key) – shown raw only.
  }
  return { label, raw, header, payload };
}

/** Shortens a secret for display in headers: "eyJraWQi…x9Qw". */
export function abbreviate(secret: string, keep = 10) {
  return secret.length <= keep * 2 ? secret : `${secret.slice(0, keep)}…${secret.slice(-4)}`;
}

/** Copies a token response for display, abbreviating the raw token strings. */
export function redactTokens(body: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...body };
  for (const key of ["access_token", "id_token", "refresh_token"]) {
    if (typeof out[key] === "string") out[key] = abbreviate(out[key] as string);
  }
  return out;
}

export function redactForm(form: Record<string, string>) {
  const out: Record<string, string> = { ...form };
  for (const key of ["client_secret", "code_verifier"]) if (out[key]) out[key] = "••••••";
  for (const key of ["subject_token", "id_token_hint", "code"]) if (out[key]) out[key] = abbreviate(out[key]);
  return out;
}
