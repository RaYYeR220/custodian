// llm.ts — minimal OpenRouter chat-completions client over fetch (no SDK dep).
// OpenRouter is OpenAI-compatible, so this is a standard chat+tools call. The
// model is Gemini google/gemini-3-flash-preview (config.MODEL), chosen over
// Anthropic for cost/simplicity.

import { BASE_URL, MODEL, OPENROUTER_API_KEY, APP_REFERER, APP_TITLE } from "./config.js";
import type { ChatMessage, ToolDef } from "./types.js";

/** The assistant message we get back (content and/or tool calls). */
export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ChatMessage["tool_calls"];
}

export interface LlmOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
}

/**
 * One chat turn. Sends the conversation + tool defs; returns the assistant
 * message. Throws (with the response body) on a non-2xx so the caller can log
 * and abort the run.
 */
export async function chat(
  messages: ChatMessage[],
  tools: ToolDef[],
  opts: LlmOptions = {}
): Promise<AssistantMessage> {
  const apiKey = opts.apiKey ?? OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Put it in the repo-root .env (gitignored)."
    );
  }
  const url = `${opts.baseUrl ?? BASE_URL}/chat/completions`;
  const body = {
    model: opts.model ?? MODEL,
    messages,
    tools,
    tool_choice: "auto" as const,
    temperature: opts.temperature ?? 0.2,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": APP_REFERER,
      "X-Title": APP_TITLE,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status} ${res.statusText}: ${text.slice(0, 1200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: AssistantMessage }>;
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(`OpenRouter error: ${json.error.message ?? JSON.stringify(json.error)}`);
  }
  const msg = json.choices?.[0]?.message;
  if (!msg) {
    throw new Error(`OpenRouter returned no message: ${JSON.stringify(json).slice(0, 800)}`);
  }
  return { role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls };
}
