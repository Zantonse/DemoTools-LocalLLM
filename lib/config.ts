export type DemoMode = "mock" | "okta";
export type AgentEngine = "local" | "scripted";

const env = (name: string, fallback = "") => process.env[name]?.trim() || fallback;

export const SCOPES = {
  read: "billing:read",
  refund: "refunds:write",
  refundHighValue: "refunds:high_value",
} as const;

export const MOCK_ISSUER = "https://mock-okta.demo/oauth2/default";

export const config = {
  mode: (env("DEMO_MODE", "mock") === "okta" ? "okta" : "mock") as DemoMode,
  baseUrl: env("APP_BASE_URL", "http://localhost:3000").replace(/\/$/, ""),
  okta: {
    issuer: env("OKTA_ISSUER").replace(/\/$/, ""),
    clientId: env("OKTA_CLIENT_ID"),
    clientSecret: env("OKTA_CLIENT_SECRET"),
    agentClientId: env("AGENT_CLIENT_ID") || env("OKTA_CLIENT_ID"),
    agentClientSecret: env("AGENT_CLIENT_SECRET") || env("OKTA_CLIENT_SECRET"),
    cibaHint: (env("CIBA_HINT", "id_token_hint") === "login_hint" ? "login_hint" : "id_token_hint") as
      | "login_hint"
      | "id_token_hint",
  },
  apiAudience: env("API_AUDIENCE", "api://acme-billing"),
  agent: {
    /** Starting engine; switchable live from the top bar. */
    engine: (env("AGENT_ENGINE", "local") === "scripted" ? "scripted" : "local") as AgentEngine,
    name: "Acme Support Copilot",
    mockClientId: "0oa-ai-agent-support-copilot",
  },
  /** Any OpenAI-compatible server: Ollama (default), LM Studio, llama.cpp, MLX. */
  llm: {
    baseUrl: env("LOCAL_LLM_URL", "http://localhost:11434/v1").replace(/\/$/, ""),
    model: env("LOCAL_LLM_MODEL", "qwen3:8b"),
    apiKey: env("LOCAL_LLM_API_KEY"),
    temperature: Number(env("LOCAL_LLM_TEMPERATURE", "0.1")),
    timeoutMs: Number(env("LOCAL_LLM_TIMEOUT_MS", "120000")),
  },
  defaultApprovalThreshold: Number(env("APPROVAL_THRESHOLD", "500")) || 500,
  // The "before" picture: a long-lived, all-powerful key shared by every agent run.
  legacyApiKey: "sk_live_acme_billing_7Fq2xK9mZ4vL1nR8wT3bY6",
};

export function agentClientId() {
  return config.mode === "okta" ? config.okta.agentClientId : config.agent.mockClientId;
}

export function apiIssuer() {
  return config.mode === "okta" ? config.okta.issuer : MOCK_ISSUER;
}
