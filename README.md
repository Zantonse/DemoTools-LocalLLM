# DemoTools: Local LLM

A sales engineering demo kit for **Okta for AI Agents**, with the agent running on a **local model** on your own hardware (e.g. a Mac mini with Ollama). No cloud AI involved. Okta governs the agent the same way whatever model drives it. That's the point to land with customers who run their own models.

> Sister project: [O4AADemoTools](https://github.com/Zantonse/O4AADemoTools) is the same demo driven by Claude.

One web app, three things customers remember:

The story: a support copilot works in Acme's billing system (accounts, orders, refunds) with the signed-in support rep's own refund authority. Like real support teams, small refunds are fine on your own and big ones need sign-off.

1. **Delegated access.** The agent calls the billing API *as the signed-in user*. It holds no API key: it exchanges the user's token for a short-lived token scoped to one API, carrying the user as `sub` and the agent as `act` (RFC 8693 token exchange).
2. **Human-in-the-loop approval.** When the agent tries something risky (a refund over $500), the API demands a scope Okta only issues after the user approves a push on their phone (OpenID CIBA). Approve and the action goes through. Deny and the agent stops.
3. **Token inspector.** Every identity step is shown live next to the chat: the requests to Okta, decoded JWTs with the important claims explained, and the API calls with their status codes.

A **"Without Okta"** toggle flips the agent to a shared static API key, so you can show the "before" picture: the same $9,000 refund goes through with no approval, and the audit log can't say who asked for it.

## Quick start on a Mac

**1. Run a local model server** (pick one):

- **Ollama**: `brew install ollama`, then `ollama serve` (or open the Ollama app), then `ollama pull qwen3:8b`.
- **LM Studio**: download a tool-calling model, then start the local server (Developer tab). Set `LOCAL_LLM_URL=http://localhost:1234/v1` and `LOCAL_LLM_MODEL` to the model id LM Studio shows.

**2. Run the app:**

```bash
npm install
cp .env.example .env.local     # defaults: mock Okta + Ollama qwen3:8b
npm run build && npm start     # http://localhost:3000
```

**3. Demo:** sign in with a mock persona, click the suggested prompts in order, and approve the $4,800 refund on the **📱 Approver** page.

The top bar shows the model's status (🟢 ready, 🟠 model not pulled, 🔴 server not reachable). A dropdown switches to the **scripted agent**, a deterministic backup that runs the same identity flows with no model at all. Use it if the model misbehaves mid-demo.

### Choosing a model

The model must support **tool calling**. Ollama labels these "tools" on its model pages. Rough sizing for Apple Silicon (quantized models):

| Mac memory | Model size | Examples |
|---|---|---|
| 16 GB | 7–8B | `qwen3:8b` (default), `llama3.1:8b` |
| 24–32 GB | 14B | `qwen3:14b` |
| 64 GB+ | 30B+ | `qwen3:32b` |

Bigger models choose tools and arguments more reliably. Rehearse your exact prompts on the model you'll demo with, and send one warm-up message before the meeting (the first request loads the model into memory, which takes a while).

### Built-in guardrails for small models

Local models are less consistent than frontier models, so the agent loop (`lib/agent/run.ts`, `lib/agent/llm.ts`) cleans up after them:

- Recovers tool calls written as text (`<tool_call>{...}</tool_call>` or bare JSON) instead of the proper field
- Strips `<think>…</think>` reasoning from replies
- Coerces amounts like `"$4,800"` to `4800` and rejects missing arguments with a hint the model can act on
- Blocks repeated identical calls, and never attempts a second refund on the same order in one request
- Low temperature (0.1) by default

None of this is security. The security is enforced outside the model: the billing API only accepts Okta tokens with the right scope, and high-value refunds need the user's approval no matter what the model does.

### Running it on a Mac mini for other devices

To drive the demo from your laptop, and approve on your real phone:

```bash
APP_BASE_URL=http://mac-mini.local:3000   # in .env.local: the mini's hostname or LAN IP
npm run build && npm run start:lan        # listens on all interfaces
```

Open `http://mac-mini.local:3000` on the laptop and `http://mac-mini.local:3000/approve` on your phone (same Wi-Fi). Allow incoming connections if macOS asks. In live Okta mode, the sign-in redirect URI registered in Okta must use the same address. If Okta rejects a plain `http://` address, use the browser on the mini itself (`localhost`) or put it behind HTTPS (e.g. Tailscale).

To keep the Mac awake during a demo: `caffeinate -dims`.

## Live mode against your Okta org

Set `DEMO_MODE=okta` and fill in the Okta section of `.env.local`. **[docs/OKTA_SETUP.md](docs/OKTA_SETUP.md)** walks through the authorization server, scopes, apps, access policies and Okta Verify setup. Everything is discovered from the authorization server's `/.well-known/openid-configuration`, and all calls are standard OAuth/OIDC:

| Step | Grant / endpoint |
|---|---|
| User signs in | Authorization code + PKCE → `/v1/token` |
| Agent gets API access | `urn:ietf:params:oauth:grant-type:token-exchange` → `/v1/token` |
| High-risk approval | `/v1/bc-authorize`, then poll `urn:openid:params:grant-type:ciba` → `/v1/token` |
| API validates tokens | JWKS signature, `iss`, `aud`, `exp`, then scope check |

## Demo script

See **[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)** for a 10-minute talk track with the "aha" moments called out.

## How it fits together

```
 Browser ──chat──▶ /api/chat ──▶ Agent (local LLM or scripted)
    ▲                                 │ tool call
    │ NDJSON stream                   ▼
    │ (inspector events)        lib/agent/tools.ts
    │                            │ 1. token exchange / CIBA ──▶ Okta (or mock IdP)
    │                            │ 2. Bearer <scoped token>  ──▶ /api/billing/* ("Acme Billing")
    └────────────────────────────┘                               validates JWT + scope
```

| Path | What it is |
|---|---|
| `app/page.tsx` | Chat + inspector UI, demo controls |
| `components/Inspector.tsx` | Token inspector (decoded claims, HTTP details) |
| `app/approve/page.tsx` | Mock Okta Verify push screen (mock mode) |
| `lib/agent/` | Agent loop (local LLM / scripted), the OpenAI-compatible client, and tools: where the identity work happens |
| `lib/idp/okta.ts` | Real Okta adapter (discovery-based OAuth/OIDC) |
| `lib/idp/mock.ts` | Offline Okta simulator with personas and a CIBA queue |
| `app/api/billing/` + `lib/billing/` | The protected demo API and its token checks |

## Demo controls

- **Without Okta**: the agent uses a static `sk_live_…` key (no user, no scopes, no approval).
- **Approval over $**: the refund amount that needs human approval. The API enforces it, not the agent.
- **Reset demo**: clears the chat, inspector, cached tokens and billing data. Sign-in is kept.

## Limitations

- State is in memory: one presenter, one server process. Restarting resets everything.
- Built for demos, not production: no CSRF protection on settings, and the mock IdP accepts any persona.

## Roadmap ideas

Fine-grained authorization on RAG results (Okta FGA), Cross App Access (ID-JAG) between two apps with admin revoke, an Okta-protected MCP server, an agent inventory and kill-switch view, a Terraform bootstrap for a fresh tenant, and per-customer branding presets.
