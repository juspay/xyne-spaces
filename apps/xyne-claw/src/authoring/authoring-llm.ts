/**
 * Fast-model calls for agent authoring (classify, judge, instructions).
 *
 * All three go to the suggest model (`LITELLM_SUGGEST_*`, a fast proxy model
 * such as gemini-2.5-flash) with thinking turned off: these are short
 * structured jobs, and a reasoning model spends most of its budget thinking.
 */
import { LITELLM } from "../config.js";

export type AuthoringLlmErrorKind = "timeout" | "aborted" | "http" | "parse";

export class AuthoringLlmError extends Error {
  constructor(
    readonly kind: AuthoringLlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AuthoringLlmError";
  }
}

export interface AuthoringMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AuthoringLlmOptions {
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
  /** Caller cancellation (client closed the stream, the turn timed out). */
  signal?: AbortSignal;
}

/** Fast models wrap JSON in ```json fences or add prose despite response_format. */
export function parseLooseJson<T>(raw: string): T | null {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  if (!text.startsWith("{") && !text.startsWith("[")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function linkSignals(options: AuthoringLlmOptions): { signal: AbortSignal; timedOut: () => boolean } {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return { signal, timedOut: () => timeout.aborted && !options.signal?.aborted };
}

function requestBody(
  messages: AuthoringMessage[],
  options: AuthoringLlmOptions,
  extras: { json?: boolean; stream?: boolean; thinkingOff: boolean },
): string {
  return JSON.stringify({
    model: LITELLM.suggestModel,
    messages,
    max_tokens: options.maxTokens,
    temperature: options.temperature ?? 0.3,
    ...(extras.json ? { response_format: { type: "json_object" } } : {}),
    ...(extras.stream ? { stream: true } : {}),
    // A reasoning model otherwise spends the budget on hidden thinking.
    ...(extras.thinkingOff ? { reasoning_effort: "none", thinking: { type: "disabled" } } : {}),
  });
}

async function post(
  messages: AuthoringMessage[],
  options: AuthoringLlmOptions,
  extras: { json?: boolean; stream?: boolean },
): Promise<Response> {
  const { signal, timedOut } = linkSignals(options);
  const send = (thinkingOff: boolean): Promise<Response> =>
    fetch(`${LITELLM.suggestUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.suggestApiKey}`,
      },
      body: requestBody(messages, options, { ...extras, thinkingOff }),
      signal,
    });
  try {
    let res = await send(true);
    if (res.status === 400) {
      // A proxy that does not know the thinking params rejects them; retry without.
      const text = await res.text().catch(() => "");
      if (/reasoning|thinking/i.test(text)) res = await send(false);
      else throw new AuthoringLlmError("http", `LLM returned 400: ${text.slice(0, 160)}`, 400);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AuthoringLlmError("http", `LLM returned ${res.status}: ${text.slice(0, 160)}`, res.status);
    }
    return res;
  } catch (err) {
    if (err instanceof AuthoringLlmError) throw err;
    if (timedOut()) throw new AuthoringLlmError("timeout", `LLM timed out after ${options.timeoutMs}ms`);
    if (options.signal?.aborted) throw new AuthoringLlmError("aborted", "cancelled");
    throw new AuthoringLlmError("http", err instanceof Error ? err.message : String(err));
  }
}

/** One JSON object back. Throws AuthoringLlmError (parse) when the model returns none. */
export async function chatJson<T>(
  messages: AuthoringMessage[],
  options: AuthoringLlmOptions,
): Promise<T> {
  const res = await post(messages, options, { json: true });
  const data = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  const parsed = parseLooseJson<T>(raw);
  if (parsed === null) {
    throw new AuthoringLlmError("parse", `LLM returned non-JSON: ${raw.slice(0, 120)}`);
  }
  return parsed;
}

/** Text deltas as they arrive. */
export async function* chatStream(
  messages: AuthoringMessage[],
  options: AuthoringLlmOptions,
): AsyncGenerator<string> {
  const res = await post(messages, options, { stream: true });
  if (!res.body) throw new AuthoringLlmError("http", "LLM stream had no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string | null } }>;
          };
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // A partial or non-JSON line: the next read completes it or it is noise.
        }
      }
    }
  } catch (err) {
    if (err instanceof AuthoringLlmError) throw err;
    if (options.signal?.aborted) throw new AuthoringLlmError("aborted", "cancelled");
    throw new AuthoringLlmError("http", err instanceof Error ? err.message : String(err));
  } finally {
    reader.cancel().catch(() => {});
  }
}
