// One LiteLLM /v1/chat/completions POST plus the response shape the twin/memory callers read.
import { fetchLiteLLMWithRetry, type LiteLLMFetchOptions } from "@xyne/litellm-client";

const LITELLM_URL = (process.env["LITELLM_URL"] ?? "https://grid.ai.example.com").replace(/\/$/, "");

export interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function postChatCompletion(apiKey: string, body: Record<string, unknown>, opts: LiteLLMFetchOptions): Promise<Response> {
  return fetchLiteLLMWithRetry(
    `${LITELLM_URL}/v1/chat/completions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    opts,
  );
}

/** Wire `usage` → trace shape; only numeric fields are copied. */
export function tokenUsage(u: NonNullable<ChatCompletionResponse["usage"]>): { promptTokens?: number; completionTokens?: number } {
  return {
    ...(typeof u.prompt_tokens === "number" ? { promptTokens: u.prompt_tokens } : {}),
    ...(typeof u.completion_tokens === "number" ? { completionTokens: u.completion_tokens } : {}),
  };
}
