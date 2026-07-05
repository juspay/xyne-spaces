/**
 * Semantic-match judge for the evals harness.
 *
 * An LLM grades how well a GENERATED answer matches the EXPECTED (ground-truth)
 * answer for one eval turn, returning a 0-100 score plus a one-line rationale.
 * Mirrors goal-judge.ts: forced tool-call returns strict `{ score, reasoning }`.
 *
 * The grading rubric (`prompt`) and the `model` are supplied by the caller
 * (claw-auth resolves them from the global EvalJudgeConfig / per-folder override
 * and the user's model pick). On any failure the judge fails OPEN to
 * `{ score: null, reasoning: "judge_unavailable" }` so a transient LiteLLM
 * outage marks the turn un-judged rather than fabricating a score.
 */
import { LITELLM } from "./config.js";
import { withLlmSlot, pauseLlmGate, retryAfterMs } from "./llm-gate.js";

import { createLogger } from "./logger.js";
const log = createLogger("eval-judge");

// Per-ATTEMPT timeout — a judge call is a short structured request; if a model
// (e.g. a slow one on a long input) hasn't answered in this window, abort and
// retry rather than hang. Total worst case ≈ 3 × this + backoffs.
const JUDGE_TIMEOUT_MS = Number(process.env["EVAL_JUDGE_TIMEOUT_MS"] ?? 60_000);
const JUDGE_RETRIES = 3;
const JUDGE_BACKOFFS_MS = [1000, 3000];

export interface EvalJudgeInput {
  expected: string;
  generated: string;
  message?: string | undefined;
  prompt?: string | undefined;
  model?: string | undefined;
  copilot?: { token: string; model: string } | undefined;
}

/** Headers Copilot's API requires on direct calls (mirrors settings.ts /models). */
export function copilotHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "opencode/0.3.118",
    "Openai-Intent": "conversation-edits",
    "Editor-Version": "vscode/1.95.0",
    "Copilot-Integration-Id": "vscode-chat",
    "x-initiator": "agent",
  };
}

export const COPILOT_COMPLETIONS_URL = "https://api.githubcopilot.com/chat/completions";

export interface EvalJudgeResult {
  /** 0-100 semantic match, or null when the judge could not run. */
  score: number | null;
  reasoning: string;
}

/** Built-in rubric used when the caller supplies no prompt. */
const DEFAULT_JUDGE_PROMPT = `You are grading how well a GENERATED answer semantically matches an EXPECTED (ground-truth) answer.

Score 0-100 based on meaning, not wording:
- 90-100: same meaning and intent; any differences are purely stylistic.
- 70-89: mostly correct; minor information missing or slightly different emphasis.
- 40-69: partially correct; misses or misstates important parts.
- 1-39: largely wrong, off-topic, or contradicts the expected answer.
- 0: empty, refuses, or completely unrelated.

Reward correct meaning even if phrasing, length, or formatting differ. Do not reward fluent text that fails to convey the expected content. Persona/identity differences (a different assistant name) should NOT lower the score unless the expected answer was specifically about identity.`;

const SCORE_TOOL = {
  type: "function" as const,
  function: {
    name: "score",
    description: "Return the 0-100 semantic match score and a one-line rationale.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        reasoning: { type: "string", description: "≤200 chars, plain English, no markdown." },
      },
      required: ["score", "reasoning"],
    },
  },
};

export async function judgeSemanticMatch(input: EvalJudgeInput): Promise<EvalJudgeResult> {
  const viaCopilot = !!input.copilot?.token;
  if (!viaCopilot && !LITELLM.apiKey) {
    return { score: null, reasoning: "judge_unavailable" };
  }

  const rubric = (input.prompt && input.prompt.trim()) || DEFAULT_JUDGE_PROMPT;
  const model = viaCopilot
    ? input.copilot!.model
    : (input.model && input.model.trim()) || LITELLM.fastModel;
  const url = viaCopilot ? COPILOT_COMPLETIONS_URL : `${LITELLM.url}/v1/chat/completions`;
  const headers = viaCopilot
    ? copilotHeaders(input.copilot!.token)
    : { "Content-Type": "application/json", Authorization: `Bearer ${LITELLM.apiKey}` };

  const userContent = [
    ...(input.message ? [`User message:\n${input.message.slice(0, 4000)}`, ""] : []),
    "--- EXPECTED answer ---",
    (input.expected || "(empty)").slice(0, 8000),
    "",
    "--- GENERATED answer ---",
    (input.generated || "(empty)").slice(0, 8000),
  ].join("\n");

  // Up to JUDGE_RETRIES attempts. Retry transient failures (network/timeout,
  // 5xx, 408/429, or a response missing the tool call). Don't retry hard 4xx
  // (budget_exceeded, invalid model) — re-sending won't help.
  for (let attempt = 1; attempt <= JUDGE_RETRIES; attempt++) {
    const last = attempt === JUDGE_RETRIES;
    try {
      // All shared-key LLM calls go through one concurrency gate — the proxy
      // key's parallel cap is tiny and shared with live agents (llm-gate.ts).
      // Copilot calls run on the user's own quota, so they skip the gate.
      const doFetch = () =>
        fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: rubric },
              { role: "user", content: userContent },
            ],
            tools: [SCORE_TOOL],
            tool_choice: { type: "function", function: { name: SCORE_TOOL.function.name } },
            temperature: 0,
          }),
          signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
        });
      const res = await (viaCopilot ? doFetch() : withLlmSlot(doFetch));

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
        if (res.status === 429 && !viaCopilot) {
          const ra = retryAfterMs(res.headers.get("retry-after"));
          pauseLlmGate(ra ?? 5_000); // back off globally, not just this caller
        }
        log.warn(`[eval-judge] ${viaCopilot ? "Copilot" : "LiteLLM"} ${res.status} (model=${model}, attempt=${attempt}/${JUDGE_RETRIES}, retryable=${retryable}): ${body.slice(0, 200)}`);
        if (!retryable || last) return { score: null, reasoning: "judge_unavailable" };
      } else {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
        };
        const raw = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (raw) {
          const parsed = JSON.parse(raw) as { score?: unknown; reasoning?: unknown };
          const n = typeof parsed.score === "number" ? Math.round(parsed.score) : Number.NaN;
          const score = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
          const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 240) : "";
          if (attempt > 1) log.info(`[eval-judge] succeeded on attempt ${attempt} (model=${model})`);
          return { score, reasoning };
        }
        log.warn(`[eval-judge] no tool_call in response (attempt=${attempt}/${JUDGE_RETRIES})`);
        if (last) return { score: null, reasoning: "judge_unavailable" };
      }
    } catch (err) {
      log.warn(`[eval-judge] call failed (attempt=${attempt}/${JUDGE_RETRIES}): ${err instanceof Error ? err.message : String(err)}`);
      if (last) return { score: null, reasoning: "judge_unavailable" };
    }
    await new Promise((r) => setTimeout(r, JUDGE_BACKOFFS_MS[attempt - 1] ?? 3000));
  }
  return { score: null, reasoning: "judge_unavailable" };
}

/** Models the user can actually USE for judging/extraction.
 *
 * `/v1/models` lists what the key can *see*, not what it can *call* — paid
 * external models (vertex_ai/openai) are budget-blocked on this proxy, and
 * embeddings aren't chat models. `/model/info` exposes each model's provider,
 * so we keep only the internal self-hosted (`hosted_vllm`) chat models — the
 * ones with no budget gate. Falls back to `/v1/models` (minus embeddings) if
 * `/model/info` is unavailable. */
let lastGoodModels: string[] | null = null;

export async function listJudgeModels(): Promise<string[]> {
  if (!LITELLM.apiKey) return [];
  const headers = { Authorization: `Bearer ${LITELLM.apiKey}` };
  try {
    const res = await fetch(`${LITELLM.url}/model/info`, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const data = (await res.json()) as {
        data?: Array<{ model_name?: unknown; litellm_params?: { custom_llm_provider?: unknown } }>;
      };
      const usable = new Set<string>();
      for (const m of data.data ?? []) {
        const name = typeof m.model_name === "string" ? m.model_name : "";
        const prov = typeof m.litellm_params?.custom_llm_provider === "string" ? m.litellm_params.custom_llm_provider : "";
        if (name && prov === "hosted_vllm" && !/embed/i.test(name)) usable.add(name);
      }
      if (usable.size > 0) {
        lastGoodModels = [...usable].sort();
        return lastGoodModels;
      }
    }
  } catch {
    /* fall through */
  }
  // /model/info failed this time. Serve the last good FILTERED list rather than
  // the raw /v1/models visibility dump — the raw list contains budget-blocked
  // external models, and falling back to it made different dropdowns (fetched
  // at different moments) show different model sets.
  if (lastGoodModels) return lastGoodModels;
  // /model/info is now 403-blocked at the gateway, so the provider-metadata
  // filter can't run. Fall back to an env-seeded allowlist of known-usable
  // models, intersected with the live /v1/models visibility list (so removed
  // models drop out). Tune with EVAL_USABLE_MODELS (comma-separated).
  const allowlist = (process.env["EVAL_USABLE_MODELS"] ??
    "claude-haiku-4-5-20251001,gemini-3-flash-preview,glm-flash-experimental,kimi-latest,minimaxai/minimax-m2,open-fast,open-large")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  try {
    const res = await fetch(`${LITELLM.url}/v1/models`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return allowlist.sort();
    const data = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const visible = new Set(
      (data.data ?? []).map((m) => (typeof m.id === "string" ? m.id : "")).filter(Boolean),
    );
    const usable = allowlist.filter((m) => visible.has(m));
    lastGoodModels = (usable.length > 0 ? usable : allowlist).sort();
    return lastGoodModels;
  } catch {
    return allowlist.sort();
  }
}
