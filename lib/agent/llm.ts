import { randomUUID } from "node:crypto";
import { config } from "../config";

/**
 * Minimal client for the OpenAI-compatible chat completions API that local
 * model servers expose (Ollama, LM Studio, llama.cpp server, MLX servers).
 * Plain fetch, no SDK: the request is small and every server speaks it.
 */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
}

function endpoint(path: string) {
  return `${config.llm.baseUrl}${path}`;
}

function headers() {
  return {
    "Content-Type": "application/json",
    ...(config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {}),
  };
}

function unreachable(err: unknown): Error {
  const reason = (err as Error).name === "TimeoutError" ? "timed out" : "is not reachable";
  return new Error(
    `The local LLM at ${config.llm.baseUrl} ${reason}. Is your model server running ` +
      `(Ollama: "ollama serve", LM Studio: start the local server) with "${config.llm.model}" available?`,
  );
}

/** Reasoning models (e.g. Qwen3, DeepSeek-R1) put chain-of-thought in <think> tags. */
function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
}

/**
 * Smaller models sometimes write the tool call as text instead of using the
 * tool_calls field, e.g. `<tool_call>{"name": ..., "arguments": {...}}</tool_call>`
 * or a bare JSON object. Recover those so the demo keeps going.
 */
function toolCallsFromText(text: string, toolNames: string[]): { calls: ToolCall[]; rest: string } {
  const candidates: string[] = [];
  let rest = text.replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, (_, body: string) => {
    candidates.push(body);
    return "";
  });
  if (!candidates.length) {
    const json = rest.match(/\{[\s\S]*"name"\s*:\s*"[^"]+"[\s\S]*\}/);
    if (json) {
      candidates.push(json[0]);
      rest = rest.replace(json[0], "");
    }
  }
  const calls: ToolCall[] = [];
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim()) as {
        name?: string;
        arguments?: unknown;
        parameters?: unknown;
      };
      if (!parsed.name || !toolNames.includes(parsed.name)) continue;
      const args = parsed.arguments ?? parsed.parameters ?? {};
      calls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        type: "function",
        function: { name: parsed.name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
      });
    } catch {
      // not a tool call after all
    }
  }
  return calls.length ? { calls, rest: rest.trim() } : { calls: [], rest: text };
}

export async function chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(endpoint("/chat/completions"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: config.llm.model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: config.llm.temperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(config.llm.timeoutMs),
    });
  } catch (err) {
    throw unreachable(err);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = /not found|no such model|pull/i.test(body) ? ` Try: ollama pull ${config.llm.model}` : "";
    throw new Error(`Local LLM returned ${res.status}: ${body.slice(0, 300)}${hint}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: Partial<ToolCall & { function: { arguments: unknown } }>[] } }[];
  };
  const message = data.choices?.[0]?.message ?? {};
  const content = stripThinking(message.content ?? "");
  const toolCalls: ToolCall[] = (message.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c) => ({
      id: c.id || `call_${randomUUID().slice(0, 8)}`,
      type: "function",
      function: {
        name: c.function!.name,
        // Some servers return arguments as an object instead of a JSON string.
        arguments: typeof c.function!.arguments === "string" ? c.function!.arguments : JSON.stringify(c.function!.arguments ?? {}),
      },
    }));
  if (toolCalls.length) return { content, toolCalls };
  const recovered = toolCallsFromText(content, tools.map((t) => t.function.name));
  return { content: recovered.rest, toolCalls: recovered.calls };
}

export type LlmStatus = { ok: true; modelAvailable: boolean } | { ok: false; error: string };

/** Quick reachability check for the UI badge. */
export async function checkLlm(): Promise<LlmStatus> {
  try {
    const res = await fetch(endpoint("/models"), { headers: headers(), signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { data?: { id: string }[] };
    const ids = (data.data ?? []).map((m) => m.id);
    const want = config.llm.model;
    const modelAvailable = ids.length === 0 || ids.some((id) => id === want || id === `${want}:latest` || `${id}:latest` === want);
    return { ok: true, modelAvailable };
  } catch (err) {
    return { ok: false, error: unreachable(err).message };
  }
}
