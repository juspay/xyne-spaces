/**
 * Entity-extraction completions — runs on claw (where LITELLM_API_KEY lives).
 *
 * Why on claw, not claw-auth: same reason as curator.ts. claw-auth owns the
 * entity-extraction pipeline (documents, prompts, JSON-schema validation and
 * the repair loop) but holds no LLM credentials, so it POSTs each assembled
 * message list here and gets raw completion text back. The credential stays
 * scoped to one pod and "all LLM calls happen on claw" still holds.
 *
 * Deliberately NOT a general LLM proxy: the model, temperature and thinking
 * flag are fixed here, and the request is size-capped. Callers choose the
 * prompt, nothing else.
 */

import { fetchLiteLLMWithRetry } from "@xyne/litellm-client";
import { withLlmSlot, pauseLlmGate, retryAfterMs } from "./llm-gate.js";
import { LITELLM } from "./config.js";

import { createLogger } from "./logger.js";
const log = createLogger("entity-llm");

// Own model knob: entity extraction deliberately runs a different (cheaper,
// non-reasoning) model than the agent loop, so this is not LITELLM.model.
const ENTITY_MODEL = process.env["ENTITY_EXTRACTION_MODEL"] ?? "glm-latest";
/**
 * Per-attempt budget for one LiteLLM call.
 *
 * Deliberately well under claw-auth's transport timeout. A real 60k-char batch
 * completes in ~15s; 120s is generous headroom, and anything beyond it is a
 * stuck request, not a slow one — waiting the old 300s bought nothing and cost
 * the caller its entire budget.
 */
const ENTITY_TIMEOUT_MS = Number(
  process.env["ENTITY_EXTRACTION_TIMEOUT_MS"] ?? 120_000,
);

/**
 * Retries AFTER the first attempt. One, not the client default of three.
 *
 * Retrying past the point the caller gave up is not resilience, it is damage:
 * the reply goes nowhere, and at ENTITY_LLM_MAX_CONCURRENT=1 the dead request
 * holds the only slot while every live one queues behind it. Three retries at
 * the old 300s timeout meant a single stuck call blocked entity extraction for
 * ~21 minutes.
 *
 * The whole budget — attempts plus backoff — must stay under the caller's
 * timeout, which ENTITY_TOTAL_BUDGET_MS asserts below.
 */
const ENTITY_MAX_RETRIES = Number(process.env["ENTITY_LLM_MAX_RETRIES"] ?? 1);

/** Worst case: every attempt burns its full timeout, plus the 5s first backoff. */
const ENTITY_TOTAL_BUDGET_MS =
  ENTITY_TIMEOUT_MS * (ENTITY_MAX_RETRIES + 1) + 5_000 * ENTITY_MAX_RETRIES;


/**
 * Entity extraction is background work; a live agent turn is not. Even inside
 * the shared offline gate (llm-gate.ts, 2 slots) a discovery run could hold
 * BOTH slots for minutes at a time — each call is 20-75s — starving the eval
 * paths and eating upstream parallel budget that agent turns are competing for
 * on the same platform key (agent.ts falls back to LITELLM.apiKey when an agent
 * has no own credential).
 *
 * So entity calls take at most ONE offline slot by default. Discovery gets
 * slower; interactive turns keep headroom. Raise deliberately, and only if the
 * proxy key's cap has room.
 */
const ENTITY_MAX_CONCURRENT = Math.max(
  1,
  Number(process.env["ENTITY_LLM_MAX_CONCURRENT"] ?? 1),
);

/**
 * How long a request may wait for the single entity slot before giving up.
 *
 * This bound is the difference between a slow run and a dead one. The wait
 * happens BEFORE the LiteLLM call, so an unbounded queue means the caller's
 * socket times out while its request has not even started — claw-auth sees
 * `TypeError: fetch failed` with no status and no upstream error to report.
 *
 * Worse, it is self-sustaining at concurrency 1: one slow call parks the slot,
 * every queued request ages past the caller's timeout, and the backlog outlives
 * the congestion that caused it. Refusing fast turns that into a 503 the caller
 * can log, count and retry sanely.
 */
const ENTITY_SLOT_WAIT_MS = Number(process.env["ENTITY_LLM_SLOT_WAIT_MS"] ?? 45_000);

// Surfaced at boot so a bad override is caught by reading one log line, rather
// than by watching a run die 300s at a time. Declared here, below every value
// it reads, since these are const bindings and not hoisted.
log.info(
  `[entity-llm] model=${ENTITY_MODEL} attemptTimeout=${ENTITY_TIMEOUT_MS}ms ` +
    `retries=${ENTITY_MAX_RETRIES} worstCase=${Math.round(ENTITY_TOTAL_BUDGET_MS / 1000)}s ` +
    `slotWait=${Math.round(ENTITY_SLOT_WAIT_MS / 1000)}s concurrency=${ENTITY_MAX_CONCURRENT}`,
);

let entityActive = 0;
const entityWaiters: Array<() => void> = [];

async function withEntitySlot<T>(fn: () => Promise<T>): Promise<T> {
  if (entityActive >= ENTITY_MAX_CONCURRENT) {
    let waiter!: () => void;
    const admitted = await new Promise<boolean>((resolve) => {
      waiter = () => resolve(true);
      entityWaiters.push(waiter);
      setTimeout(() => resolve(false), ENTITY_SLOT_WAIT_MS);
    });

    if (!admitted) {
      // Drop our own waiter so a later release does not hand the slot to a
      // request that has already been refused.
      const index = entityWaiters.indexOf(waiter);
      if (index !== -1) entityWaiters.splice(index, 1);
      throw new EntityLlmError(
        `Entity LLM slot busy for ${Math.round(ENTITY_SLOT_WAIT_MS / 1000)}s ` +
          `(${entityActive}/${ENTITY_MAX_CONCURRENT} in use, ${entityWaiters.length} queued)`,
        503,
      );
    }
  }

  entityActive += 1;
  try {
    return await fn();
  } finally {
    entityActive -= 1;
    entityWaiters.shift()?.();
  }
}

/** Guard rails on what one call may carry. A doc batch is ~60k chars. */
export const MAX_MESSAGES = 16;
export const MAX_TOTAL_CHARS = 400_000;

export type EntityLlmRole = "system" | "user" | "assistant";
export interface EntityLlmMessage {
  role: EntityLlmRole;
  content: string;
}

export class EntityLlmError extends Error {
  constructor(
    message: string,
    /** HTTP status to surface to the caller; 502 for upstream failures. */
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * One LiteLLM chat completion, returning the raw assistant text.
 *
 * 429/5xx retry comes from fetchLiteLLMWithRetry — the shared key's
 * max_parallel_requests slots are contended by live agent runs, and a discarded
 * batch silently shrinks the discovered taxonomy rather than failing loudly.
 */
export async function completeEntityPrompt(
  messages: EntityLlmMessage[],
  purpose?: string,
): Promise<string> {
  if (!LITELLM.apiKey) {
    throw new EntityLlmError("LITELLM_API_KEY not set on claw", 503);
  }

  // Through the shared gate: the proxy key's parallel cap is small and shared
  // with live agent runs, and a discovery run fans out on its own. Throttling
  // locally instead (as this used to) is exactly what llm-gate.ts was built to
  // stop — independent throttles together blow the cap and burn retries on 429s.
  const res = await withEntitySlot(() =>
    withLlmSlot(() =>
      fetchLiteLLMWithRetry(
        `${LITELLM.url.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LITELLM.apiKey}`,
          },
          body: JSON.stringify({
            model: ENTITY_MODEL,
            messages,
            temperature: 0,
            // glm-latest is a reasoning model; disabling the trace took a batch of
            // 8 documents from 45s to 7.7s with no quality loss.
            chat_template_kwargs: { enable_thinking: false },
          }),
        },
        {
          timeoutMs: ENTITY_TIMEOUT_MS,
          maxRetries: ENTITY_MAX_RETRIES,
          label: `entity-llm${purpose ? `:${purpose}` : ""}`,
        },
      ),
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
      `[entity-llm] LiteLLM ${res.status} purpose=${purpose ?? "-"}: ${body.slice(0, 300)}`,
    );
    throw new EntityLlmError(
      `LiteLLM error: ${res.status} ${body.slice(0, 500)}`,
      502,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Shape/size validation for an S2S request body. Returns the parsed messages. */
export function parseEntityLlmMessages(raw: unknown): EntityLlmMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new EntityLlmError("messages must be a non-empty array", 400);
  }
  if (raw.length > MAX_MESSAGES) {
    throw new EntityLlmError(`messages exceeds ${MAX_MESSAGES} entries`, 400);
  }

  let total = 0;
  const out: EntityLlmMessage[] = [];
  for (const entry of raw) {
    const m = entry as { role?: unknown; content?: unknown };
    if (m.role !== "system" && m.role !== "user" && m.role !== "assistant") {
      throw new EntityLlmError(
        "each message needs role system|user|assistant",
        400,
      );
    }
    if (typeof m.content !== "string") {
      throw new EntityLlmError("each message needs a string content", 400);
    }
    total += m.content.length;
    if (total > MAX_TOTAL_CHARS) {
      throw new EntityLlmError(
        `messages exceed ${MAX_TOTAL_CHARS} total characters`,
        413,
      );
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}
