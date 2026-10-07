/**
 * Per-hub selection rules and confidence thresholds (stage E).
 * Starting points from competitor research; tune on the golden eval (`--sweep`).
 * Each threshold can be overridden per deploy with `XOR_TH_<SNAKE_NAME>`,
 * e.g. `XOR_TH_AUTO_BIND=0.8`.
 *
 * Lives in xyne-claw-shared so claw-auth (Hub suggest-tools) and xyne-claw
 * (streamed agent draft) bind and suggest with the same rules.
 */

export const SHORTLIST_TOP_K = 8;

/** Whole suggest budget — must cover the XOR call plus the LLM-judge fallback. */
export const SUGGEST_BUDGET_MS = 20_000;

export const SELECTION_THRESHOLDS = {
  /** MCP / skills auto-bind floor. */
  autoBind: 0.75,
  /** Suggest band lower bound (one-click chip). */
  suggestMin: 0.5,
  /** Builtin: rule match + XOR. */
  builtinRuleAndJudge: 0.6,
  /** Builtin: XOR alone. */
  builtinJudgeAlone: 0.8,
  /** Subagent suggest floor (only named subagents are auto-bound). */
  subagentSuggest: 0.75,
  /** Max subagents bound or suggested. */
  subagentCap: 2,
  /** Max auto-bound skills / knowledge collections. */
  skillAutoCap: 3,
  /** Knowledge collections have generic names, so bind only on strong signal. */
  knowledgeAutoBind: 0.85,
} as const;

type ThresholdName = keyof typeof SELECTION_THRESHOLDS;

/** Read a threshold, honouring the `XOR_TH_*` env override. */
export function selectionThreshold(name: ThresholdName): number {
  const envName = `XOR_TH_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
  const raw = process.env[envName];
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return SELECTION_THRESHOLDS[name];
}

export type HubPickKind = "bound" | "suggested" | "none";

export interface JudgedPick {
  id: string;
  confidence: number;
  reason: string;
}

export interface HubJudgement {
  picks: JudgedPick[];
  none: boolean;
  reason?: string;
}

export interface AppliedHubResult {
  bound: JudgedPick[];
  suggested: JudgedPick[];
  none: boolean;
  reason?: string;
}

/** Named catalog mention → confidence 1.0. */
export function namedItemConfidence(): number {
  return 1.0;
}

function byConfidence(a: JudgedPick, b: JudgedPick): number {
  return b.confidence - a.confidence;
}

function splitAt(picks: JudgedPick[], bindAt: number, boundCap?: number): { bound: JudgedPick[]; suggested: JudgedPick[] } {
  const ranked = picks.filter((p) => p.confidence >= selectionThreshold("suggestMin")).sort(byConfidence);
  let bound = ranked.filter((p) => p.confidence >= bindAt);
  if (boundCap !== undefined) bound = bound.slice(0, boundCap);
  const boundIds = new Set(bound.map((p) => p.id));
  return { bound, suggested: ranked.filter((p) => !boundIds.has(p.id)) };
}

export function applySkillThresholds(picks: JudgedPick[]): AppliedHubResult {
  const { bound, suggested } = splitAt(picks, selectionThreshold("autoBind"), selectionThreshold("skillAutoCap"));
  if (bound.length === 0 && suggested.length === 0) {
    return { bound: [], suggested: [], none: true, reason: "No skill needed" };
  }
  return { bound, suggested, none: false };
}

export function applyKnowledgeThresholds(picks: JudgedPick[]): AppliedHubResult {
  const { bound, suggested } = splitAt(
    picks,
    selectionThreshold("knowledgeAutoBind"),
    selectionThreshold("skillAutoCap"),
  );
  if (bound.length === 0 && suggested.length === 0) {
    return { bound: [], suggested: [], none: true, reason: "No knowledge collection needed" };
  }
  return { bound, suggested, none: false };
}

/**
 * Delegating to a subagent changes how the agent runs, so only subagents the
 * request names are bound; the rest are one-click suggestions.
 */
export function applySubagentThresholds(picks: JudgedPick[], namedIds: ReadonlySet<string> = new Set()): AppliedHubResult {
  const cap = selectionThreshold("subagentCap");
  const bound = picks
    .filter((p) => namedIds.has(p.id))
    .sort(byConfidence)
    .slice(0, cap);
  const boundIds = new Set(bound.map((p) => p.id));
  const suggested = picks
    .filter((p) => !boundIds.has(p.id) && p.confidence >= selectionThreshold("subagentSuggest"))
    .sort(byConfidence)
    .slice(0, Math.max(0, cap - bound.length));
  if (bound.length === 0 && suggested.length === 0) {
    return { bound: [], suggested: [], none: true, reason: "No subagent needed" };
  }
  return { bound, suggested, none: false };
}

export function applyBuiltinThresholds(
  picks: JudgedPick[],
  ruleMatchedIds: ReadonlySet<string>,
): AppliedHubResult {
  const bound: JudgedPick[] = [];
  const suggested: JudgedPick[] = [];
  for (const p of picks) {
    const ruleHit = ruleMatchedIds.has(p.id);
    if (
      (ruleHit && p.confidence >= selectionThreshold("builtinRuleAndJudge")) ||
      p.confidence >= selectionThreshold("builtinJudgeAlone")
    ) {
      bound.push(p);
    } else if (p.confidence >= selectionThreshold("suggestMin")) {
      suggested.push(p);
    }
  }
  bound.sort(byConfidence);
  suggested.sort(byConfidence);
  if (bound.length === 0 && suggested.length === 0) {
    return { bound: [], suggested: [], none: true, reason: "No built-in tools needed" };
  }
  return { bound, suggested, none: false };
}

export function applyMcpThresholds(picks: JudgedPick[]): AppliedHubResult {
  // MCP: auto-bind high confidence; suggest mid; named already 1.0.
  const { bound, suggested } = splitAt(picks, selectionThreshold("autoBind"));
  if (bound.length === 0 && suggested.length === 0) {
    return { bound: [], suggested: [], none: true, reason: "No MCP needed" };
  }
  return { bound, suggested, none: false };
}

/**
 * Builtin rule table — fixed triggers for small catalog (<20).
 * Mirrors GPT Builder / Copilot Studio precedent. A rule that matches the
 * request lowers the bar for a builtin whose slug or tools contain a needle.
 */
export const BUILTIN_RULE_TABLE: ReadonlyArray<{
  id: string;
  re: RegExp;
  needles: readonly string[];
}> = [
  {
    id: "web-search",
    re: /\b(latest|news|research|look\s*up|browse|web\s*search|competitor|on\s+the\s+web)\b/i,
    needles: ["web search", "web-search", "webfetch", "browse"],
  },
  {
    id: "email",
    re: /\b(e-?mails?|inbox|digest|send\s+email)\b/i,
    needles: ["send email", "send-email", "email"],
  },
  {
    id: "send-message",
    re: /\b(dm\b|dms\b|direct\s+messages?|send\s+messages?)\b/i,
    needles: ["send message", "send-message"],
  },
  {
    id: "code-data",
    re: /\b(analyze\s+csv|chart|calculate|spreadsheet|dataframe)\b/i,
    needles: ["code", "terminal", "filesystem", "data"],
  },
  {
    id: "image",
    re: /\b(generate\s+image|image\s+gen|draw\s+a)\b/i,
    needles: ["image", "generate image"],
  },
  {
    id: "file-read",
    re: /\b(read\s+files?|attachments?|uploaded\s+docs?)\b/i,
    needles: ["read file", "filesystem", "read"],
  },
];
