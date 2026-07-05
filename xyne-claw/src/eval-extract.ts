/**
 * Eval-pair extraction from a real conversation thread.
 *
 * Given an ordered, role-tagged transcript (chat thread or email thread), an LLM
 * SELECTS which messages form each (query, response) pair — it never writes or
 * paraphrases content. We then reconstruct the query/response text VERBATIM from
 * the selected message ids. This keeps eval ground-truth faithful to the real
 * human answers, makes every pair traceable, and forces the model to abstain
 * (answered=false) when a thread has no real resolution instead of fabricating
 * one.
 *
 * Runs on LITELLM.fastModel (overridable). Fails closed to an empty extraction
 * on any error — a thread we couldn't process yields no eval pairs, never junk.
 */
import { LITELLM } from "./config.js";
import { withLlmSlot, pauseLlmGate, retryAfterMs } from "./llm-gate.js";
import { copilotHeaders, COPILOT_COMPLETIONS_URL } from "./eval-judge.js";

import { createLogger } from "./logger.js";
const log = createLogger("eval-extract");

// Per-ATTEMPT timeout. Extraction reads a whole thread, so it's more generous
// than the judge — but still bounded so a hung call aborts and retries.
const EXTRACT_TIMEOUT_MS = Number(process.env["EVAL_EXTRACT_TIMEOUT_MS"] ?? 120_000);
const EXTRACT_RETRIES = 3;
const EXTRACT_BACKOFFS_MS = [1000, 3000];

export type TurnRole = "customer" | "human-agent" | "bot" | "other";

export interface ThreadMessage {
  id: string;
  role: TurnRole;
  text: string;
}

export interface ExtractInput {
  messages: ThreadMessage[];
  kind?: "chat" | "email" | undefined;
  model?: string | undefined;
  copilot?: { token: string; model: string } | undefined;
}

/** What the model returns per pair — selections only, no generated text. */
export interface ExtractedItem {
  queryMessageIds: string[];
  responseMessageIds: string[];
  answered: boolean;
  answererRole: TurnRole;
  confidence: number;
  note: string;
}

/** A reconstructed pair (verbatim text assembled from the selected ids). */
export interface ReconstructedPair {
  message: string;
  expectedResponse: string;
  answered: boolean;
  answererRole: TurnRole;
  confidence: number;
  queryMessageIds: string[];
  responseMessageIds: string[];
  note: string;
}

export interface ExtractResult {
  items: ExtractedItem[];
  pairs: ReconstructedPair[];
}

const SYSTEM_PROMPT = `You extract evaluation pairs from a real support conversation. Each pair is a CUSTOMER's ask plus the message(s) that actually ANSWER it, so the answer can later be used as ground-truth in an eval.

You are given an ORDERED list of messages. Each has an id, a role (customer | human-agent | bot | other), and text.

ABSOLUTE RULES:
1. SELECT ONLY. You output message IDS, never text. Never write, paraphrase, summarize, merge, or add any content of your own. You only choose which existing messages form the query and which form the response.
2. Use only IDs that appear in the input.
3. NEVER fabricate an answer. If an ask is not actually answered anywhere in the thread, return that item with "answered": false and an empty responseMessageIds. If the thread contains no genuine ask-and-answer at all, return an empty items list.
4. Prefer the HUMAN-AGENT answer as the response. Set answererRole accordingly. A bot/app message may answer too — if so set answererRole "bot". Do not treat a customer message as the answer.

SEGMENTATION:
- A thread can contain MULTIPLE independent asks and MULTIPLE sub-questions → emit one item per ask.
- If a query or an answer spans several consecutive messages from the same author, include all of their IDs (in order).
- If several people jointly answer one ask, you may include responseMessageIds from more than one author — but only the messages that genuinely resolve it.
- Ignore greetings, "thanks"/acknowledgements, and system/noise messages.
- confidence (0..1) = how clearly the selected response resolves the query. Be conservative; when unsure, lower confidence rather than guessing.

You MUST call the "extract" tool exactly once.`;

const EXTRACT_TOOL = {
  type: "function" as const,
  function: {
    name: "extract",
    description: "Return the selected (query, response) message-id pairs found in the thread.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              queryMessageIds: { type: "array", items: { type: "string" } },
              responseMessageIds: { type: "array", items: { type: "string" } },
              answered: { type: "boolean" },
              answererRole: { type: "string", enum: ["customer", "human-agent", "bot", "other"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              note: { type: "string", description: "≤200 chars: why these messages, or why unanswered." },
            },
            required: ["queryMessageIds", "responseMessageIds", "answered", "answererRole", "confidence", "note"],
          },
        },
      },
      required: ["items"],
    },
  },
};

function renderTranscript(messages: ThreadMessage[]): string {
  return messages
    .map((m) => `[${m.id}] (${m.role})\n${m.text.slice(0, 4000)}`)
    .join("\n\n");
}

/** Assemble verbatim text from selected ids, preserving input order. */
function joinByIds(messages: ThreadMessage[], ids: string[]): string {
  const want = new Set(ids);
  return messages
    .filter((m) => want.has(m.id))
    .map((m) => m.text)
    .join("\n\n")
    .trim();
}

export async function extractEvalPairs(input: ExtractInput): Promise<ExtractResult> {
  const viaCopilot = !!input.copilot?.token;
  if ((!viaCopilot && !LITELLM.apiKey) || input.messages.length === 0) {
    return { items: [], pairs: [] };
  }
  const model = viaCopilot ? input.copilot!.model : (input.model && input.model.trim()) || LITELLM.fastModel;
  const callUrl = viaCopilot ? COPILOT_COMPLETIONS_URL : `${LITELLM.url}/v1/chat/completions`;
  const callHeaders = viaCopilot
    ? copilotHeaders(input.copilot!.token)
    : { "Content-Type": "application/json", Authorization: `Bearer ${LITELLM.apiKey}` };
  const idSet = new Set(input.messages.map((m) => m.id));

  const userContent = [
    input.kind === "email"
      ? "This is an EMAIL thread. Inbound messages are the customer; outbound are the responder."
      : "This is a chat thread.",
    "",
    "--- Messages (ordered) ---",
    renderTranscript(input.messages),
  ].join("\n");

  // Up to EXTRACT_RETRIES attempts to get the tool-call args. Retry transient
  // failures (network/timeout, 5xx, 408/429, missing tool call); bail on hard 4xx.
  let raw: string | undefined;
  for (let attempt = 1; attempt <= EXTRACT_RETRIES; attempt++) {
    const last = attempt === EXTRACT_RETRIES;
    try {
      // Shared concurrency gate with the judge — see llm-gate.ts. Copilot
      // calls run on the user's own quota, so they skip the gate.
      const doFetch = () =>
        fetch(callUrl, {
          method: "POST",
          headers: callHeaders,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userContent },
            ],
            tools: [EXTRACT_TOOL],
            tool_choice: { type: "function", function: { name: EXTRACT_TOOL.function.name } },
            temperature: 0,
          }),
          signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
        });
      const res = await (viaCopilot ? doFetch() : withLlmSlot(doFetch));
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
        if (res.status === 429 && !viaCopilot) pauseLlmGate(retryAfterMs(res.headers.get("retry-after")) ?? 5_000);
        log.warn(`[eval-extract] LiteLLM ${res.status} (model=${model}, attempt=${attempt}/${EXTRACT_RETRIES}, retryable=${retryable}): ${body.slice(0, 200)}`);
        if (!retryable || last) return { items: [], pairs: [] };
      } else {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
        };
        const got = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (got) {
          if (attempt > 1) log.info(`[eval-extract] succeeded on attempt ${attempt} (model=${model})`);
          raw = got;
          break;
        }
        log.warn(`[eval-extract] no tool_call in response (attempt=${attempt}/${EXTRACT_RETRIES})`);
        if (last) return { items: [], pairs: [] };
      }
    } catch (err) {
      log.warn(`[eval-extract] call failed (attempt=${attempt}/${EXTRACT_RETRIES}): ${err instanceof Error ? err.message : String(err)}`);
      if (last) return { items: [], pairs: [] };
    }
    await new Promise((r) => setTimeout(r, EXTRACT_BACKOFFS_MS[attempt - 1] ?? 3000));
  }
  if (!raw) return { items: [], pairs: [] };

  try {
    const parsed = JSON.parse(raw) as { items?: unknown };
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

    const items: ExtractedItem[] = [];
    for (const it of rawItems) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      // Grounding: drop any selection that cites ids not present in the input.
      const qIds = (Array.isArray(o["queryMessageIds"]) ? o["queryMessageIds"] : []).filter(
        (x): x is string => typeof x === "string" && idSet.has(x),
      );
      const rIds = (Array.isArray(o["responseMessageIds"]) ? o["responseMessageIds"] : []).filter(
        (x): x is string => typeof x === "string" && idSet.has(x),
      );
      if (qIds.length === 0) continue; // an item with no real query is meaningless
      const answered = o["answered"] === true && rIds.length > 0;
      const role = ["customer", "human-agent", "bot", "other"].includes(o["answererRole"] as string)
        ? (o["answererRole"] as TurnRole)
        : "other";
      const conf = typeof o["confidence"] === "number" ? Math.max(0, Math.min(1, o["confidence"])) : 0;
      items.push({
        queryMessageIds: qIds,
        responseMessageIds: rIds,
        answered,
        answererRole: role,
        confidence: conf,
        note: typeof o["note"] === "string" ? o["note"].slice(0, 240) : "",
      });
    }

    // Reconstruct verbatim text from the selected ids — the LLM never authored these.
    const pairs: ReconstructedPair[] = items.map((it) => ({
      message: joinByIds(input.messages, it.queryMessageIds),
      expectedResponse: joinByIds(input.messages, it.responseMessageIds),
      answered: it.answered,
      answererRole: it.answererRole,
      confidence: it.confidence,
      queryMessageIds: it.queryMessageIds,
      responseMessageIds: it.responseMessageIds,
      note: it.note,
    }));

    return { items, pairs };
  } catch (err) {
    log.warn(`[eval-extract] call failed: ${err instanceof Error ? err.message : String(err)}`);
    return { items: [], pairs: [] };
  }
}
