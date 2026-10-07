# Okta org setup (live mode)

This configures an Okta Workforce Identity org so the demo runs against real Okta instead of the mock. You need an org with **Okta Identity Engine**, **API Access Management** (custom authorization servers), and **Okta Verify**.

> Okta's admin console labels and feature availability change. If a step doesn't match what you see, search Okta's developer docs for **"On-Behalf-Of Token Exchange"** and **"Client-Initiated Backchannel Authentication (CIBA)"**, which are the two flows this demo depends on. Some orgs need these features enabled by Okta first.

## 1. Authorization server: the "Acme Billing" API

**Security → API → Authorization Servers → Add Authorization Server**

- Name: `Acme Billing`
- Audience: `api://acme-billing` (this becomes `API_AUDIENCE`)
- Copy the **Issuer URI** (e.g. `https://acme.okta.com/oauth2/aus1abc...`) into `OKTA_ISSUER`.

**Scopes tab**, add:

| Scope | Meaning in the demo |
|---|---|
| `billing:read` | Read accounts and orders |
| `refunds:write` | Refunds at or under the approval threshold |
| `refunds:high_value` | Refunds over the threshold. Only via CIBA approval |

## 2. Web app: where the user signs in

**Applications → Create App Integration → OIDC → Web Application**

- Grant types: **Authorization Code**
- Sign-in redirect URI: `{APP_BASE_URL}/api/auth/callback` (e.g. `http://localhost:3000/api/auth/callback`)
- Sign-out redirect URI: `{APP_BASE_URL}`
- Assign your demo user(s)
- Copy the client ID and secret into `OKTA_CLIENT_ID` / `OKTA_CLIENT_SECRET`

## 3. Agent client: the AI agent's own identity

The agent authenticates as itself when it exchanges tokens and requests approvals. Use a separate app integration so the agent appears as a distinct identity with its own policies and logs. (For a quick start you can enable these grants on the web app instead and leave `AGENT_CLIENT_*` blank.)

- Create an app integration for the agent (for example an OIDC Web Application named `Acme Support Copilot`)
- Under the app's grant types (often in **Advanced**), enable:
  - **Token Exchange**
  - **Client-Initiated Backchannel Authentication (CIBA)**, with **Okta Verify** as the authenticator for push
- Copy its credentials into `AGENT_CLIENT_ID` / `AGENT_CLIENT_SECRET`

## 4. Access policies on the authorization server

On the `Acme Billing` authorization server, **Access Policies → Add Policy** (assign it to both clients), then add rules:

| Rule | Grant type | Client | Scopes |
|---|---|---|---|
| Portal sign-in | Authorization Code | Web app | `openid profile email` |
| Agent: delegated access | Token Exchange | Agent | `billing:read`, `refunds:write` |
| Agent: approved high-value | CIBA | Agent | `openid`, `refunds:high_value` |

That table **is the demo's security story**. The agent can never get `refunds:high_value` through token exchange, only through a real-time approval by the user. Show it in the console during the demo.

Keep access token lifetimes short on the agent rules (5 minutes works well in the inspector).

## 5. Demo user

- Enroll the demo user in **Okta Verify** on your phone.
- Make sure their email is set; `CIBA_HINT=login_hint` sends it as the login hint. The default `id_token_hint` sends the user's ID token instead.

## 6. Run it

```bash
DEMO_MODE=okta
APP_BASE_URL=http://localhost:3000
OKTA_ISSUER=https://<your-org>.okta.com/oauth2/<auth-server-id>
OKTA_CLIENT_ID=...
OKTA_CLIENT_SECRET=...
AGENT_CLIENT_ID=...
AGENT_CLIENT_SECRET=...
API_AUDIENCE=api://acme-billing
```

`npm run dev`, sign in, then run the prompts. In live mode the inspector shows the real requests to your org (secrets redacted), and the approval arrives as an Okta Verify push.

## Troubleshooting

| Symptom in the inspector | Likely cause |
|---|---|
| `Okta discovery failed` | `OKTA_ISSUER` should be the custom auth server issuer, not the org URL |
| Token exchange `invalid_grant` / `unauthorized_client` | Token Exchange not enabled on the agent client, or no matching policy rule |
| Token exchange `invalid_scope` | The policy rule doesn't allow that scope for Token Exchange |
| `does not advertise a CIBA endpoint` | CIBA isn't enabled for the org or authorization server |
| CIBA `unknown_user_id` / `invalid_request` | Try `CIBA_HINT=login_hint`, and check the user is enrolled in Okta Verify |
| Billing API returns `401 invalid_token` with an audience error | `API_AUDIENCE` doesn't match the authorization server audience |
| Redirect mismatch on sign-in | `APP_BASE_URL` doesn't match the redirect URI registered on the web app |
