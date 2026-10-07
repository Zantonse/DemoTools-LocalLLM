"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Inspector } from "@/components/Inspector";
import type { InspectorEvent } from "@/lib/inspector";

interface SessionInfo {
  mode: "mock" | "okta";
  idpLabel: string;
  llm: { model: string; baseUrl: string; status: { ok: true; modelAvailable: boolean } | { ok: false; error: string } };
  agentName: string;
  user: { name: string; email: string } | null;
  settings: { legacyMode: boolean; approvalThreshold: number; engine: "local" | "scripted" };
  transcript: { role: "user" | "assistant"; text: string }[];
  events: InspectorEvent[];
}

function llmState(info: SessionInfo) {
  const s = info.llm.status;
  if (!s.ok) return { dot: "🔴", label: "not reachable" };
  if (!s.modelAvailable) return { dot: "🟠", label: "model not pulled" };
  return { dot: "🟢", label: "ready" };
}

const SUGGESTIONS = [
  "Show me my accounts",
  "What orders does Initech have?",
  "Refund $120 on ORD-2002 — duplicate charge",
  "Refund $4,800 on ORD-2001 — contract dispute",
];

export default function Home() {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [transcript, setTranscript] = useState<SessionInfo["transcript"]>([]);
  const [events, setEvents] = useState<InspectorEvent[]>([]);
  const [clearedAt, setClearedAt] = useState(0);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/session", { cache: "no-store" });
    const data = (await res.json()) as SessionInfo;
    setInfo(data);
    setTranscript(data.transcript);
    setEvents(data.events);
  }, []);

  useEffect(() => {
    load();
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setError(err);
  }, [load]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [transcript.length, busy]);

  async function updateSettings(patch: Partial<SessionInfo["settings"]>) {
    setInfo((i) => (i ? { ...i, settings: { ...i.settings, ...patch } } : i));
    const res = await fetch("/api/settings", { method: "POST", body: JSON.stringify(patch) });
    const settings = await res.json();
    setInfo((i) => (i ? { ...i, settings } : i));
  }

  async function resetDemo() {
    await fetch("/api/reset", { method: "POST" });
    setClearedAt(0);
    await load();
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    setTranscript((t) => [...t, { role: "user", text }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", body: JSON.stringify({ message: text }) });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.type === "event") setEvents((e) => [...e, msg.event]);
          else if (msg.type === "assistant") setTranscript((t) => [...t, { role: "assistant", text: msg.text }]);
          else if (msg.type === "error") setError(msg.message);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <div className="center muted">Loading…</div>;

  if (!info.user) {
    return (
      <div className="center">
        <div className="card">
          <h1>{info.agentName}</h1>
          <p>An AI agent for Acme's support team that works in the billing system on the signed-in user's behalf.</p>
          {error && <div className="error-banner">{error}</div>}
          <ul className="feature-list">
            <li>Delegated access: short-lived, user-bound, scoped tokens via token exchange</li>
            <li>Human-in-the-loop: risky actions need the user's approval on their phone (CIBA)</li>
            <li>Token inspector: every identity step, decoded, as it happens</li>
          </ul>
          <a className="btn btn-primary" href="/api/auth/login" style={{ display: "block", textAlign: "center", textDecoration: "none", padding: 10 }}>
            Sign in with {info.mode === "okta" ? "Okta" : "Okta (mock)"}
          </a>
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            Identity provider: {info.idpLabel} · Agent:{" "}
            {info.settings.engine === "local" ? `${info.llm.model} (local, ${llmState(info).label})` : "scripted"}
          </p>
        </div>
      </div>
    );
  }

  const legacy = info.settings.legacyMode;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" /> AI Agent Identity Demo
        </div>
        <span className={`badge ${info.mode === "okta" ? "badge-live" : ""}`}>{info.idpLabel}</span>
        <select
          className="engine-select"
          value={info.settings.engine}
          onChange={(e) => updateSettings({ engine: e.target.value as "local" | "scripted" })}
          title={info.llm.status.ok ? `${info.llm.baseUrl}` : info.llm.status.error}
        >
          <option value="local">
            {llmState(info).dot} {info.llm.model} (local)
          </option>
          <option value="scripted">Scripted agent (backup)</option>
        </select>
        {legacy && <span className="badge badge-legacy">LEGACY: shared API key</span>}
        <span className="spacer" />
        <div className="controls">
          <label className="toggle" title="Show the 'before' picture: the agent uses one static, all-powerful API key">
            <input type="checkbox" checked={legacy} onChange={(e) => updateSettings({ legacyMode: e.target.checked })} />
            Without Okta
          </label>
          <label className="toggle threshold" title="Refunds above this need the user's approval">
            Approval over $
            <input
              type="number"
              min={0}
              step={50}
              value={info.settings.approvalThreshold}
              onChange={(e) => updateSettings({ approvalThreshold: Number(e.target.value) })}
            />
          </label>
          {info.mode === "mock" && (
            <a className="btn" href="/approve" target="_blank" rel="noreferrer" title="Open the mock Okta Verify approver (works on your phone too)">
              📱 Approver
            </a>
          )}
          <button className="btn" onClick={resetDemo}>
            Reset demo
          </button>
          <span className="badge" title={info.user.email}>
            {info.user.name}
          </span>
          <a className="btn" href="/api/auth/logout">
            Sign out
          </a>
        </div>
      </header>

      <main className="main">
        <section className="chat">
          <div className="pane-head">
            {info.agentName} <span className="muted">· acting for {info.user.name}</span>
          </div>
          <div className="messages">
            {info.settings.engine === "local" && llmState(info).label !== "ready" && (
              <div className="error-banner">
                Local LLM {llmState(info).label} at {info.llm.baseUrl}.{" "}
                {info.llm.status.ok ? `Run: ollama pull ${info.llm.model}` : "Start Ollama or LM Studio"}, or switch to the scripted agent.
              </div>
            )}
            {transcript.length === 0 && <div className="empty">Ask the agent to look up accounts, check orders, or issue a refund.</div>}
            {transcript.map((m, i) => (
              <div key={i} className={`msg msg-${m.role}`}>
                {m.text}
              </div>
            ))}
            {busy && <div className="msg msg-thinking">Working…</div>}
            {error && <div className="error-banner">{error}</div>}
            <div ref={bottom} />
          </div>
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" disabled={busy} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the agent…" disabled={busy} />
            <button className="btn btn-primary" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </section>

        <Inspector events={events.filter((e) => e.ts > clearedAt)} onClear={() => setClearedAt(Date.now())} />
      </main>
    </div>
  );
}
