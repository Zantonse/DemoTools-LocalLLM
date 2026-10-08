"use client";

import { useEffect, useState } from "react";

interface McpInfo {
  url: string;
  key: string;
  client: string | null;
}

/** Shows how to plug an external MCP agent (e.g. Hermes Agent) into the demo. */
export function ConnectAgent({ onClose, client }: { onClose: () => void; client: string | null }) {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const load = (rotate = false) =>
    fetch("/api/mcp-key", { method: "POST", body: JSON.stringify({ rotate }) })
      .then((r) => r.json())
      .then(setInfo);

  useEffect(() => {
    load();
  }, []);

  const yaml = info
    ? `mcp_servers:
  acme_billing:
    url: "${info.url}"
    headers:
      Authorization: "Bearer ${info.key}"
    timeout: 300   # leave time for the phone approval`
    : "";

  async function copy() {
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h1>Connect an external agent</h1>
        <p>
          Plug in an agent you didn't build, such as <strong>Hermes Agent</strong>, over MCP. It gets the same billing tools,
          and every call still goes through Okta for the signed-in user.
        </p>
        {client && <div className="ok-banner">Connected: {client}</div>}
        <div className="section-label">Add to ~/.hermes/config.yaml, then restart Hermes</div>
        <pre className="code">{yaml || "Loading…"}</pre>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={copy} disabled={!info}>
            {copied ? "Copied ✓" : "Copy config"}
          </button>
          <button className="btn" onClick={() => load(true)}>
            New key
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
        <p style={{ marginTop: 14, marginBottom: 0, fontSize: 12 }}>
          Then ask Hermes: “Use acme_billing to refund $4,800 on ORD-2001 for a contract dispute.” Watch the inspector and
          your phone. The key only links Hermes to this demo session. It grants no access by itself.
        </p>
      </div>
    </div>
  );
}
