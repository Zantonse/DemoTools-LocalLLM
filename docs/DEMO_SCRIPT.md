# Demo script (~10 minutes)

**Setup:** app on the left half of the screen, inspector on the right. Phone (or the `/approve` page on a second screen) ready. Click **Reset demo** before you start.

## 0. Frame the problem (1 min)

> "Every company is putting agents in front of business systems. Today most of them get there with a shared API key or a service account. That means the agent has all the access of the key, no one knows which user asked for what, and nothing stops it doing something big on its own. Let me show you the alternative."

Today's scenario: a support copilot that works in Acme's billing system with the support rep's own refund authority. Support teams typically let reps refund small amounts on their own and send larger refunds to a manager. The agent gets exactly the same rule.

## 1. Sign in (1 min)

Sign in. In the inspector, open **User access token**.

> "The user signed in to the agent's app with Okta, like any other app. Note this token is for the user, held by the app. The agent never sees a password and never gets a standing key."

## 2. Delegated access (2 min)

Click **Show me my accounts**. Walk the inspector top to bottom:

- **Agent needs "billing:read"**: the agent asks Okta for exactly what this task needs.
- **Token exchange**: the user's token is traded for a new one.
- **Delegated token issued**: point at the highlighted claims:
  - `sub`: still the user. The API knows who this is for.
  - `act`: the agent. The API knows *what* is acting.
  - `aud`: one API only. Useless anywhere else.
  - `scp`: read only.
  - `exp`: minutes, not months.
- **GET /api/billing/accounts → 200**: the API validated all of that.

Click **What orders does Initech have?** and point out **Reusing cached API token**: no extra round-trips.

**Aha:** *"The agent got just enough access, for just this user, for just a few minutes, and every call is attributable to both the human and the agent."*

## 3. Autonomous within guardrails (1 min)

Click **Refund $120 on ORD-2002**.

> "Under $500, same as a human rep's refund limit, policy lets the agent act for the user. It asked Okta for `refunds:write`, got it, done. No friction for low-risk work."

## 4. Human in the loop (2 min): the money moment

Click **Refund $4,800 on ORD-2001**.

- Inspector: **exceeds the $500 limit → human approval required**. The API needs `refunds:high_value`, which Okta *will not* issue through token exchange.
- **CIBA request**, then **Waiting for approval…**. Hold up your phone. Read the binding message aloud.
- Approve it. **Approval-bound token issued**, then **POST /refunds → 201**.

> "The agent couldn't approve itself, and no prompt injection can talk it into the scope. Only the human, on a device they own, can unlock it. And it's per action, not a blanket grant."

Optional: run it again and **deny**. The agent stops and says so.

## 5. The "before" picture (1 min)

Toggle **Without Okta**. Ask: *"Refund $9,000 on ORD-1001 — testing"*.

- Inspector goes amber: **shared static API key** (`sk_live_…`, opaque, never expires).
- The refund goes straight through. **No approval**, and the audit trail says `svc-billing-integration`.

> "This is how most agents are wired today. Same agent, same request, but no identity, no limits, no human."

Toggle it back off.

## 6. Close (1 min)

> "What you saw is standards-based: OAuth token exchange and OpenID CIBA, enforced by policies you manage in Okta next to everything else. Same place you already control which people get access to what, now for agents too."

If live mode: flip to the Okta admin console and show the authorization server **access policy rules** (token exchange gets `billing:read` and `refunds:write`; only CIBA gets `refunds:high_value`) and the **System Log** entries for the agent client.

## Bring your own agent: Hermes (optional, 2 min)

Setup beforehand: Hermes connected via **🔌 Connect agent** (see README). Have its chat (terminal, Telegram, etc.) on screen next to the inspector.

> "Your employees won't only use agents you build. Here's Hermes, an open-source agent running a local model on this box. I plugged it into the billing system over MCP, the standard way agents connect to tools."

Ask Hermes to refund $4,800 on ORD-2001. The inspector shows **External agent connected over MCP**, then **Hermes called issue_refund**, then the same token exchange, approval push and approval-bound token.

> "Different agent, same rules. Okta doesn't need to trust the agent. It gives it narrow, user-bound tokens and puts the human in the loop for anything risky."

## The local-model angle (optional, 30 seconds)

Point at the model badge in the top bar.

> "This agent's brain is an open model running on this little box. No cloud AI at all. And notice nothing about the security changed. The model never holds a credential, and it can't approve its own refunds. Okta enforces that at the API, so you can swap models, or run several, without re-doing your security."

## Questions you'll get

- **"What if the agent is compromised?"** Its tokens are minutes long, for one API, with limited scopes, and high-risk actions need a human. Revoke the agent client in Okta and it's cut off everywhere.
- **"What if the model is jailbroken or hallucinates?"** The worst it can do is ask. Every call still needs a scoped, user-bound token, and risky actions still need the human's approval.
- **"Does this work with our agent framework?"** It's plain OAuth at the tool boundary. Any framework that can make an HTTP call can do it.
- **"What about third-party APIs like Salesforce or Slack?"** Same pattern, with Okta brokering access to those apps (talk about Cross App Access and token vaulting).
