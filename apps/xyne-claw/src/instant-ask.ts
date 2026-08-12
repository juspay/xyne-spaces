/**
 * Instant KB answer completions — runs on claw (where LITELLM_API_KEY lives).
 *
 * Why on claw, not claw-auth: same reason as entity-llm.ts/curator.ts.
 * claw-auth owns the instant pipeline (KB search, prompt assembly, citation
 * shaping) but holds no LLM credentials, so it POSTs the assembled message
 * list here and gets raw completion text back. The credential stays scoped to
 * one pod and "all LLM calls happen on claw" still holds.
 *
 * Deliberately NOT a general LLM proxy: the model and temperature are fixed
 * here, and the request is size-capped. Callers choose the prompt, nothing
 * else.
 */

import { fetchLiteLLMWithRetry } from "@xyne/litellm-client";
import { withLlmSlot, pauseLlmGate, retryAfterMs } from "./llm-gate.js";
import { LITELLM } from "./config.js";

import { createLogger } from "./logger.js";
const log = createLogger("instant-ask");

// Own model knob: instant KB answers deliberately run against a knob
// independent of the agent loop's LITELLM.model, same reasoning as
// entity-llm.ts's ENTITY_MODEL.
const INSTANT_MODEL = process.env["INSTANT_ASK_MODEL"] ?? LITELLM.model;

// Classify (query rewrite / follow-up detection / direct-answer short
// circuit) is a much smaller, more mechanical decision than the final
// answer — same reasoning as entity-llm's own cheaper model, so it defaults
// to a distinct (cheaper/faster) knob rather than reusing INSTANT_MODEL.
const INSTANT_CLASSIFY_MODEL = process.env["INSTANT_CLASSIFY_MODEL"] ?? INSTANT_MODEL;

/** Per-attempt budget for one LiteLLM call — an interactive turn is waiting. */
const INSTANT_TIMEOUT_MS = Number(
  process.env["INSTANT_ASK_TIMEOUT_MS"] ?? 60_000,
);

/** Retries AFTER the first attempt — same one-retry discipline as entity-llm.ts. */
const INSTANT_MAX_RETRIES = Number(
  process.env["INSTANT_ASK_MAX_RETRIES"] ?? 1,
);

log.info(
  `[instant-ask] model=${INSTANT_MODEL} classifyModel=${INSTANT_CLASSIFY_MODEL} ` +
    `attemptTimeout=${INSTANT_TIMEOUT_MS}ms retries=${INSTANT_MAX_RETRIES}`,
);

/** Guard rails on what one call may carry. */
export const MAX_MESSAGES = 32;
export const MAX_TOTAL_CHARS = 400_000;

export type InstantAskRole = "system" | "user" | "assistant";
export interface InstantAskMessage {
  role: InstantAskRole;
  content: string;
}

export class InstantAskError extends Error {
  constructor(
    message: string,
    /** HTTP status to surface to the caller; 502 for upstream failures. */
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * One LiteLLM-compatible chat completion, returning the raw assistant text.
 *
 * 429/5xx retry comes from fetchLiteLLMWithRetry — the shared key's
 * max_parallel_requests slots are contended by live agent runs.
 *
 * `opts.credential` is an escape hatch for an AGENT's own "bring your own
 * key" LiteLLM credential (claw-auth resolves + decrypts it via
 * resolveAgentProviderConfigs, same as a normal agentic run, and forwards it
 * here over the S2S channel — never exposed to the browser). When absent,
 * falls back to the platform default `LITELLM`/`INSTANT_MODEL` below. Only
 * ever used for the answer call, not classify — see instant-ask.ts on the
 * claw-auth side for why.
 */
export async function completeInstantAsk(
  messages: InstantAskMessage[],
  purpose?: string,
  opts?: {
    model?: "answer" | "classify";
    jsonMode?: boolean;
    credential?: { apiKey: string; baseUrl: string; model: string };
  },
): Promise<string> {
  const apiKey = opts?.credential?.apiKey ?? LITELLM.apiKey;
  const baseUrl = opts?.credential?.baseUrl ?? LITELLM.url;
  const model = opts?.credential?.model
    ?? (opts?.model === "classify" ? INSTANT_CLASSIFY_MODEL : INSTANT_MODEL);

  if (!apiKey) {
    throw new InstantAskError("LITELLM_API_KEY not set on claw", 503);
  }

  // Through the shared gate: the proxy key's parallel cap is small and shared
  // with live agent runs — no independent local throttle (see llm-gate.ts).
  const res = await withLlmSlot(() =>
    fetchLiteLLMWithRetry(
      `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          ...(opts?.jsonMode ? { response_format: { type: "json_object" } } : {}),
          // glm-* models are reasoning models; disabling the trace took entity
          // extraction from 45s to 7.7s with no quality loss (entity-llm.ts).
          // Same fix here. Gated on the model NAME (not just "no override"),
          // because this is a vLLM/GLM-specific field — sending it to an
          // arbitrary agent BYOK credential pointed at a different backend
          // could error instead of being silently ignored.
          ...(process.env["INSTANT_ENABLE_THINKING"] !== "true" && /glm/i.test(model)
            ? { chat_template_kwargs: { enable_thinking: false } }
            : {}),
        }),
      },
      {
        timeoutMs: INSTANT_TIMEOUT_MS,
        maxRetries: INSTANT_MAX_RETRIES,
        label: `instant-ask${purpose ? `:${purpose}` : ""}`,
      },
    ),
  );

  // Tell the gate globally, so every other caller backs off too rather than
  // each discovering the same 429 independently.
  if (res.status === 429) {
    pauseLlmGate(retryAfterMs(res.headers.get("retry-after")) ?? 5_000);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.warn(
      `[instant-ask] LiteLLM ${res.status} purpose=${purpose ?? "-"}: ${body.slice(0, 300)}`,
    );
    throw new InstantAskError(
      `LiteLLM error: ${res.status} ${body.slice(0, 500)}`,
      502,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Streaming variant of the ANSWER completion — feeds the new
 * `/internal/instant/stream` SSE route so the browser sees the answer
 * token-by-token, same as a normal agentic run, instead of waiting for the
 * full generation and getting it as one lump (what `completeInstantAsk`
 * above still does — kept for the classify call, which is a small JSON blob
 * with nothing worth streaming).
 *
 * Deliberately bypasses `fetchLiteLLMWithRetry`: that helper is built for
 * single-shot JSON completions where retrying a failed attempt is safe —
 * here we've already streamed partial content to the caller by the time a
 * mid-stream failure could happen, so there's nothing a retry could safely
 * redo. Same fetch/parse shape as xyne-search's own
 * `directRAGMarkdownStream` (server/app/agent/services/nonAgenticAsk.ts),
 * which streams against this same LiteLLM deployment successfully.
 */
export async function streamInstantAnswer(
  messages: InstantAskMessage[],
  onChunk: (text: string) => void,
  opts?: {
    credential?: { apiKey: string; baseUrl: string; model: string };
  },
): Promise<string> {
  const apiKey = opts?.credential?.apiKey ?? LITELLM.apiKey;
  const baseUrl = opts?.credential?.baseUrl ?? LITELLM.url;
  const model = opts?.credential?.model ?? INSTANT_MODEL;

  if (!apiKey) {
    throw new InstantAskError("LITELLM_API_KEY not set on claw", 503);
  }

  const res = await withLlmSlot(() =>
    fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        stream: true,
        // Same fix as completeInstantAsk above — see its comment.
        ...(process.env["INSTANT_ENABLE_THINKING"] !== "true" && /glm/i.test(model)
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
      }),
      signal: AbortSignal.timeout(INSTANT_TIMEOUT_MS),
    }),
  );

  if (res.status === 429) {
    pauseLlmGate(retryAfterMs(res.headers.get("retry-after")) ?? 5_000);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.warn(`[instant-ask] LiteLLM stream ${res.status}: ${body.slice(0, 300)}`);
    throw new InstantAskError(`LiteLLM error: ${res.status} ${body.slice(0, 500)}`, 502);
  }
  if (!res.body) {
    throw new InstantAskError("LiteLLM stream response has no body", 502);
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice("data:".length).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string | null } }>;
        };
        const text = parsed.choices?.[0]?.delta?.content ?? "";
        if (text) {
          full += text;
          onChunk(text);
        }
      } catch {
        // Skip malformed SSE frame — same tolerance as directRAGMarkdownStream.
      }
    }
  }
  return full;
}

/** Shape/size validation for an S2S request body. Returns the parsed messages. */
export function parseInstantAskMessages(raw: unknown): InstantAskMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new InstantAskError("messages must be a non-empty array", 400);
  }
  if (raw.length > MAX_MESSAGES) {
    throw new InstantAskError(`messages exceeds ${MAX_MESSAGES} entries`, 400);
  }

  let total = 0;
  const out: InstantAskMessage[] = [];
  for (const entry of raw) {
    const m = entry as { role?: unknown; content?: unknown };
    if (m.role !== "system" && m.role !== "user" && m.role !== "assistant") {
      throw new InstantAskError(
        "each message needs role system|user|assistant",
        400,
      );
    }
    if (typeof m.content !== "string") {
      throw new InstantAskError("each message needs a string content", 400);
    }
    total += m.content.length;
    if (total > MAX_TOTAL_CHARS) {
      throw new InstantAskError(
        `messages exceed ${MAX_TOTAL_CHARS} total characters`,
        413,
      );
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}
