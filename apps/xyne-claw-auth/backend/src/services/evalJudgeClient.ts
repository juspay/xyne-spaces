/**
 * Thin HTTP client for claw's eval judge endpoints.
 *
 * Same "LLM-on-claw-only" invariant as goalJudgeClient: the LiteLLM key lives on
 * claw, so the semantic-match scoring and the model list go there over S2S.
 *
 * judge() returns `{ score: null, reasoning: "judge_unavailable" }` on any
 * failure so the caller records the turn as un-judged rather than fabricating a
 * score. listModels() returns [] on failure.
 */
import { CONFIG } from "../config.js";

const JUDGE_TIMEOUT_MS = Number(process.env["EVAL_JUDGE_TIMEOUT_MS"] ?? 300_000);

export interface EvalJudgeRequest {
  expected: string;
  generated: string;
  message?: string | undefined;
  prompt?: string | undefined;
  model?: string | undefined;
  copilot?: { token: string; model: string } | undefined;
}

export interface EvalJudgeResult {
  score: number | null;
  reasoning: string;
}

export async function judgeEvalTurn(req: EvalJudgeRequest): Promise<EvalJudgeResult> {
  if (!CONFIG.xyneClawS2sKey) {
    return { score: null, reasoning: "judge_unavailable" };
  }
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/eval-judge`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { score: null, reasoning: "judge_unavailable" };
    }
    const data = (await res.json()) as { success?: boolean; score?: number | null; reasoning?: string };
    if (!data.success) return { score: null, reasoning: "judge_unavailable" };
    const score = typeof data.score === "number" ? data.score : null;
    return { score, reasoning: typeof data.reasoning === "string" ? data.reasoning : "" };
  } catch {
    return { score: null, reasoning: "judge_unavailable" };
  }
}

export interface ExtractedPair {
  message: string;
  expectedResponse: string;
  answered: boolean;
  answererRole: string;
  confidence: number;
  note: string;
}

/** Call claw's /eval-extract: select (query, response) pairs from a normalized
 *  thread. Returns [] on any failure (a thread we couldn't process yields no
 *  pairs, never junk). */
export async function extractEvalPairs(
  messages: Array<{ id: string; role: string; text: string }>,
  kind: "chat" | "email",
  model?: string,
  copilot?: { token: string; model: string },
): Promise<ExtractedPair[]> {
  if (!CONFIG.xyneClawS2sKey) return [];
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/eval-extract`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify({ messages, kind, ...(model ? { model } : {}), ...(copilot ? { copilot } : {}) }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { success?: boolean; pairs?: ExtractedPair[] };
    if (!data.success || !Array.isArray(data.pairs)) return [];
    return data.pairs;
  } catch {
    return [];
  }
}

export async function listEvalModels(): Promise<{ models: string[]; defaultModel: string }> {
  if (!CONFIG.xyneClawS2sKey) return { models: [], defaultModel: "" };
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/eval-models`;
  try {
    const res = await fetch(url, {
      headers: { "x-s2s-key": CONFIG.xyneClawS2sKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { models: [], defaultModel: "" };
    const data = (await res.json()) as { success?: boolean; models?: string[]; defaultModel?: string };
    return {
      models: Array.isArray(data.models) ? data.models : [],
      defaultModel: typeof data.defaultModel === "string" ? data.defaultModel : "",
    };
  } catch {
    return { models: [], defaultModel: "" };
  }
}
