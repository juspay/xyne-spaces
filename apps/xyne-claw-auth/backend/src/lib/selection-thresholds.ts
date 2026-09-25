/**
 * Per-hub selection rules and confidence thresholds (stage E).
 * Starting points from competitor research; tune on golden eval.
 */

export const SHORTLIST_TOP_K = 8;

/** Whole suggest budget before dashboard 4s SUGGEST_MS. */
export const SUGGEST_BUDGET_MS = 3_500;

export const SELECTION_THRESHOLDS = {
  /** Skills / knowledge auto-bind floor. */
  autoBind: 0.75,
  /** Skills / knowledge suggest band lower bound. */
  suggestMin: 0.5,
  /** Builtin: rule match + judge. */
  builtinRuleAndJudge: 0.6,
  /** Builtin: judge alone. */
  builtinJudgeAlone: 0.8,
  /** Subagent suggest floor (never auto-bound). */
  subagentSuggest: 0.75,
  /** Max subagents suggested. */
  subagentCap: 2,
  /** Max auto-bound skills. */
  skillAutoCap: 3,
} as const;

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

export function applySkillThresholds(picks: JudgedPick[]): AppliedHubResult {
  const ranked = [...picks]
    .filter((p) => p.confidence >= SELECTION_THRESHOLDS.suggestMin)
    .sort((a, b) => b.confidence - a.confidence);
  const bound = ranked
    .filter((p) => p.confidence >= SELECTION_THRESHOLDS.autoBind)
    .slice(0, SELECTION_THRESHOLDS.skillAutoCap);
  const boundIds = new Set(bound.map((p) => p.id));
  const suggested = ranked.filter((p) => !boundIds.has(p.id));
  if (bound.length === 0 && suggested.length === 0) {
    return { bound: [], suggested: [], none: true, reason: "No skill needed" };
  }
  return { bound, suggested, none: false };
}

export function applyKnowledgeThresholds(picks: JudgedPick[]): AppliedHubResult {
  return applySkillThresholds(picks);
}

export function applySubagentThresholds(picks: JudgedPick[]): AppliedHubResult {
  const suggested = [...picks]
    .filter((p) => p.confidence >= SELECTION_THRESHOLDS.subagentSuggest)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, SELECTION_THRESHOLDS.subagentCap);
  if (suggested.length === 0) {
    return {
      bound: [],
      suggested: [],
      none: true,
      reason: "No subagent needed",
    };
  }
  // Subagents are suggest-only — never auto-bound.
  return { bound: [], suggested, none: false };
}

export function applyBuiltinThresholds(
  picks: JudgedPick[],
  ruleMatchedIds: Set<string>,
): AppliedHubResult {
  const bound: JudgedPick[] = [];
  const suggested: JudgedPick[] = [];
  for (const p of picks) {
    const ruleHit = ruleMatchedIds.has(p.id);
    if (
      (ruleHit && p.confidence >= SELECTION_THRESHOLDS.builtinRuleAndJudge) ||
      p.confidence >= SELECTION_THRESHOLDS.builtinJudgeAlone
    ) {
      bound.push(p);
    } else if (p.confidence >= SELECTION_THRESHOLDS.suggestMin) {
      suggested.push(p);
    }
  }
  if (bound.length === 0 && suggested.length === 0) {
    return {
      bound: [],
      suggested: [],
      none: true,
      reason: "No built-in tools needed",
    };
  }
  return { bound, suggested, none: false };
}

export function applyMcpThresholds(picks: JudgedPick[]): AppliedHubResult {
  // MCP: auto-bind high confidence; suggest mid; named already 1.0.
  const ranked = [...picks]
    .filter((p) => p.confidence >= SELECTION_THRESHOLDS.suggestMin)
    .sort((a, b) => b.confidence - a.confidence);
  const bound = ranked.filter((p) => p.confidence >= SELECTION_THRESHOLDS.autoBind);
  const boundIds = new Set(bound.map((p) => p.id));
  const suggested = ranked.filter((p) => !boundIds.has(p.id));
  if (bound.length === 0 && suggested.length === 0) {
    return { bound: [], suggested: [], none: true, reason: "No MCP needed" };
  }
  return { bound, suggested, none: false };
}

/**
 * Builtin rule table — fixed triggers for small catalog (<20).
 * Mirrors GPT Builder / Copilot Studio precedent.
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
