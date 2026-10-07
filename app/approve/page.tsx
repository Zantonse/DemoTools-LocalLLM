"use client";

import { useEffect, useState } from "react";
import type { CibaRequest } from "@/lib/idp/mock";

/** Mock "Okta Verify" push screen. Open on a phone or second screen during the demo. */
export default function Approve() {
  const [requests, setRequests] = useState<CibaRequest[]>([]);
  const [agentName, setAgentName] = useState("AI agent");
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/mock-idp/ciba", { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        setRequests(data.requests ?? []);
        if (data.agentName) setAgentName(data.agentName);
      } catch {
        // keep polling
      }
    };
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  async function decide(id: string, decision: "approved" | "denied") {
    await fetch(`/api/mock-idp/ciba/${id}`, { method: "POST", body: JSON.stringify({ decision }) });
    setRequests((r) => r.filter((x) => x.authReqId !== id));
    setLast(decision === "approved" ? "Approved ✓" : "Denied ✕");
  }

  const req = requests[0];
  return (
    <div className="center">
      <div className="phone">
        <div className="phone-head">Okta Verify · mock push</div>
        {!req && (
          <div className="empty">
            {last && (
              <p>
                <strong>{last}</strong>
              </p>
            )}
            No pending requests. When the agent needs approval, it appears here.
          </div>
        )}
        {req && (
          <div className="push">
            <h2>Did you ask {agentName} to do this?</h2>
            <p style={{ fontSize: 17, margin: 0 }}>{req.bindingMessage}</p>
            <dl>
              <dt>User</dt>
              <dd>{req.user.email}</dd>
              <dt>Agent</dt>
              <dd>{req.clientId}</dd>
              <dt>Access</dt>
              <dd>{req.scope}</dd>
              <dt>Expires</dt>
              <dd>{new Date(req.expiresAt).toLocaleTimeString()}</dd>
            </dl>
            <div className="push-actions">
              <button className="btn btn-danger" onClick={() => decide(req.authReqId, "denied")}>
                No, deny
              </button>
              <button className="btn btn-primary" onClick={() => decide(req.authReqId, "approved")}>
                Yes, approve
              </button>
            </div>
          </div>
        )}
        {requests.length > 1 && <div className="muted" style={{ textAlign: "center" }}>+{requests.length - 1} more waiting</div>}
      </div>
    </div>
  );
}
