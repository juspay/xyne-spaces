/**
 * `/agents/suggest-tools` orchestration: XOR first, the claw LLM judge second,
 * a BM25 shortlist last. Dependencies are injected so the route stays thin and
 * the ordering is easy to reason about.
 */
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { SUGGEST_BUDGET_MS } from "./selection-thresholds.js";
import {
  ALL_HUBS,
  hubsWithCandidates,
  planHubSelection,
  shortlistSelection,
  toSuggestResponse,
  type Hub,
  type KnowledgeCandidate,
  type SelectionInput,
  type SelectionPlan,
  type SkillCandidate,
  type SuggestCatalog,
  type SuggestSource,
  type SuggestToolsData,
} from "./tool-selection.js";
import type { XorAsk } from "./xor-client.js";

const log = createLogger("suggest-tools");

/** Room for the "Agent job: " prefix under Grid's 6000-char state limit. */
const MAX_INTENT_CHARS = 5_500;
const MAX_PROMPT_CONTEXT_CHARS = 1_500;
const MAX_NAMED_CHARS = 2_000;

export const PACK_VERSION = "xor-select-v1";

export interface ResolvedIntent {
  /** State sent to XOR and used for BM25. */
  intent: string;
  /** The user's own words (description first), scanned for hard-named products. */
  namedText: string;
}

/**
 * The user's latest request comes first so a follow-up ("also add Jira") is
 * never lost behind an old generated prompt; the prompt is only extra context.
 */
export function resolveIntent(description?: string, systemPrompt?: string): ResolvedIntent | null {
  const desc = description?.trim() ?? "";
  const prompt = systemPrompt?.trim() ?? "";
  if (!desc && !prompt) return null;
  const intent = desc && prompt
    ? `${desc}\n\nCurrent agent instructions:\n${prompt.slice(0, MAX_PROMPT_CONTEXT_CHARS)}`
    : desc || prompt;
  return { intent: intent.slice(0, MAX_INTENT_CHARS), namedText: (desc || prompt).slice(0, MAX_NAMED_CHARS) };
}

/**
 * Hubs to decide. A non-empty list of only-invalid names means "none" (the
 * caller asked for something we don't know); no list means every hub that
 * has candidates.
 */
export function resolveHubs(raw: unknown, available: Hub[]): Hub[] {
  if (Array.isArray(raw) && raw.length > 0) {
    const valid = new Set<string>(ALL_HUBS);
    const asked = new Set(raw.filter((h): h is Hub => typeof h === "string" && valid.has(h)));
    return available.filter((h) => asked.has(h));
  }
  return available;
}

export interface DecisionRecord {
  intent: string;
  hubs: Hub[];
  source: SuggestSource;
  latencyMs: number;
  /** none = XOR decided; off = XOR disabled; xor_failed = XOR down/slow; down = every model path failed. */
  fallback: "none" | "off" | "xor_failed" | "down";
  mode: "on" | "off";
  data: Record<string, unknown>;
  scored: SelectionPlan["scored"];
}

export interface JudgeResult {
  ok: boolean;
  status: number;
  data?: Record<string, unknown>;
  error?: string;
}

export interface SuggestToolsDeps {
  ask: XorAsk;
  xorEnabled: () => boolean;
  /** The claw LLM judge. Called only when XOR is off or failed. */
  judge: (args: {
    intent: string;
    catalog: SuggestCatalog;
    skills: SkillCandidate[];
    hubs: Array<"mcp" | "builtin" | "subagent" | "skill">;
    timeoutMs: number;
  }) => Promise<JudgeResult>;
  persist: (record: DecisionRecord) => Promise<void>;
  now?: () => number;
}

export interface SuggestToolsArgs {
  resolved: ResolvedIntent;
  hubs: Hub[];
  catalog: SuggestCatalog;
  skills: SkillCandidate[];
  knowledge: KnowledgeCandidate[];
  /** Epoch ms when the request started, so the judge gets the remaining budget. */
  startedAt: number;
}

export type SuggestToolsOutcome =
  | { status: 200; body: { success: true; data: Record<string, unknown> } }
  | { status: number; body: { success: false; error: string } };

const JUDGE_HUBS = new Set<Hub>(["mcp", "builtin", "subagent", "skill"]);

export async function runSuggestTools(args: SuggestToolsArgs, deps: SuggestToolsDeps): Promise<SuggestToolsOutcome> {
  const now = deps.now ?? Date.now;
  const input: SelectionInput = {
    intent: args.resolved.intent,
    namedText: args.resolved.namedText,
    catalog: args.catalog,
    skills: args.skills,
    knowledge: args.knowledge,
    hubs: args.hubs,
  };
  const enabled = deps.xorEnabled();
  const finish = (
    data: Record<string, unknown>,
    source: SuggestSource,
    fallback: DecisionRecord["fallback"],
    scored: SelectionPlan["scored"],
  ): SuggestToolsOutcome => {
    const latencyMs = now() - args.startedAt;
    void deps
      .persist({ intent: args.resolved.intent, hubs: args.hubs, source, latencyMs, fallback, mode: enabled ? "on" : "off", data, scored })
      .catch((err) => log.warn(`[suggest-tools] persist decision failed: ${errMsg(err)}`));
    log.info(`[suggest-tools] source=${source} fallback=${fallback} hubs=${args.hubs.join(",") || "-"} latencyMs=${latencyMs}`);
    return { status: 200, body: { success: true, data } };
  };

  // 1. XOR.
  if (enabled) {
    const plan = await planHubSelection(input, deps.ask);
    if (plan) {
      const data = toSuggestResponse(plan, input, { source: "xor", latencyMs: now() - args.startedAt });
      return finish(data as unknown as Record<string, unknown>, "xor", "none", plan.scored);
    }
  }
  const fallback: DecisionRecord["fallback"] = enabled ? "xor_failed" : "off";

  // 2. The claw LLM judge (full catalog, as the old shadow mode sent it).
  const judgeHubs = args.hubs.filter((h): h is "mcp" | "builtin" | "subagent" | "skill" => JUDGE_HUBS.has(h));
  if (judgeHubs.length > 0) {
    const timeoutMs = Math.max(2_000, SUGGEST_BUDGET_MS - (now() - args.startedAt));
    try {
      const judged = await deps.judge({ intent: args.resolved.intent, catalog: args.catalog, skills: args.skills, hubs: judgeHubs, timeoutMs });
      if (judged.ok && judged.data) {
        const data = { knowledgeIds: [], ...judged.data, source: "judge", latencyMs: now() - args.startedAt };
        return finish(data, "judge", fallback, []);
      }
      log.warn(`[suggest-tools] judge failed status=${judged.status} err=${judged.error ?? "-"} — shortlist fallback`);
    } catch (err) {
      log.warn(`[suggest-tools] judge unavailable: ${errMsg(err)} — shortlist fallback`);
    }
  }

  // 3. BM25 shortlist: named items bind, keyword hits are suggestions only.
  const plan = shortlistSelection(input);
  const data = toSuggestResponse(plan, input, { source: "shortlist", latencyMs: now() - args.startedAt });
  return finish(data as unknown as Record<string, unknown>, "shortlist", "down", []);
}

/** Hubs with candidates for this org/user, used when the caller sends no list. */
export function availableHubs(catalog: SuggestCatalog, skills: SkillCandidate[], knowledge: KnowledgeCandidate[]): Hub[] {
  return hubsWithCandidates({ catalog, skills, knowledge });
}

export type { SuggestToolsData };
