import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { ChatMessage } from "./agent/llm";
import { config, type AgentEngine } from "./config";
import type { InspectorEvent, NewEvent } from "./inspector";

/**
 * In-memory state. This is a single-presenter demo app, so we keep everything
 * in process memory (pinned to globalThis so dev hot-reloads don't wipe it).
 * Restarting the server resets the demo.
 */

export interface DemoUser {
  sub: string;
  name: string;
  email: string;
}

export interface Session {
  id: string;
  user?: DemoUser;
  idToken?: string;
  accessToken?: string;
  login?: { state: string; nonce: string; codeVerifier: string };
  messages: ChatMessage[];
  transcript: { role: "user" | "assistant"; text: string }[];
  events: InspectorEvent[];
  /** Links an external MCP agent (e.g. Hermes) to this signed-in session. */
  mcp?: { key: string; client?: string };
  /** Exchanged API tokens, keyed by scope, reused until they expire. */
  tokenCache: Record<string, { token: string; exp: number }>;
}

export interface DemoSettings {
  /** "Before Okta": the agent uses a shared static API key instead of delegated tokens. */
  legacyMode: boolean;
  approvalThreshold: number;
  /** "local" = the local LLM drives the agent; "scripted" = deterministic backup. */
  engine: AgentEngine;
}

interface Store {
  sessions: Map<string, Session>;
  /** MCP connection key → session id. */
  mcpKeys: Map<string, string>;
  settings: DemoSettings;
}

const g = globalThis as typeof globalThis & { __o4aaStore?: Store };
export const store: Store = (g.__o4aaStore ??= {
  sessions: new Map(),
  mcpKeys: new Map(),
  settings: { legacyMode: false, approvalThreshold: config.defaultApprovalThreshold, engine: config.agent.engine },
});

const COOKIE = "o4aa_sid";

/** Returns the caller's session, creating one (and its cookie) if needed. */
export async function getSession(): Promise<Session> {
  const jar = await cookies();
  let id = jar.get(COOKIE)?.value;
  let session = id ? store.sessions.get(id) : undefined;
  if (!session) {
    id = randomUUID();
    session = { id, messages: [], transcript: [], events: [], tokenCache: {} };
    store.sessions.set(id, session);
    jar.set(COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
  }
  return session;
}

export function recordEvent(session: Session, event: NewEvent): InspectorEvent {
  const full: InspectorEvent = { id: randomUUID(), ts: Date.now(), ...event };
  session.events.push(full);
  return full;
}

export function resetConversation(session: Session) {
  session.messages = [];
  session.transcript = [];
  session.events = session.events.filter((e) => e.tags?.includes("login"));
  session.tokenCache = {};
}

export function clearAuth(session: Session) {
  if (session.mcp) store.mcpKeys.delete(session.mcp.key);
  delete session.mcp;
  delete session.user;
  delete session.idToken;
  delete session.accessToken;
  delete session.login;
  session.messages = [];
  session.transcript = [];
  session.events = [];
  session.tokenCache = {};
}
