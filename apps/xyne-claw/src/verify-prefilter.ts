import { jevAsk, jevEnabled, jevThreshold, type JevAnswer, type JevQuestion } from "./jev.js";
import type { ResponseClaimError, VerifyResponseInput } from "./verify-response.js";

const MAX_TASK_CHARS = 4_000;
const MAX_DRAFT_CHARS = 8_000;
const MAX_REQUIREMENTS = 8;

export type PrecheckAsk = (
  state: string,
  questions: Record<string, JevQuestion>,
  opts: { purpose: string; timeoutMs: number },
) => Promise<Record<string, JevAnswer> | null>;

export interface Precheck {
  risk: number;
  factRisk: number;
  weakestRequirement: { text: string; score: number } | null;
}

export function passThreshold(): number {
  return jevThreshold("JEV_VERIFY_PASS_THRESHOLD", 0.2);
}

export function holdThreshold(): number {
  return jevThreshold("JEV_VERIFY_HOLD_THRESHOLD", 0.7);
}

export function requirementLines(criteria: string | undefined): string[] {
  return (criteria ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_REQUIREMENTS);
}

export function buildPrecheckState(input: VerifyResponseInput): string {
  return [
    "USER REQUEST:",
    input.task.slice(-MAX_TASK_CHARS),
    "",
    "EVIDENCE (tool results the agent gathered, may be truncated):",
    input.evidenceDigest || "(none)",
    "",
    "DRAFT RESPONSE:",
    input.draft.slice(0, MAX_DRAFT_CHARS),
  ].join("\n");
}

export function buildPrecheckQuestions(criteria: string | undefined): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {
    contradicted: {
      type: "noul",
      instructions:
        "Does the EVIDENCE clearly CONTRADICT at least one concrete, checkable claim in the DRAFT RESPONSE — a count, total, percentage, metric value, date, ID, status, name or outcome? Missing evidence, reasonable rounding, paraphrase, opinions, recommendations and formatting are NOT contradictions.",
    },
    fabricated_list: {
      type: "noul",
      instructions:
        "Does the DRAFT RESPONSE list items, entries or a count that the EVIDENCE shows to be wrong (wrong number of items, or entries that are not in the evidence at all)?",
    },
  };
  requirementLines(criteria).forEach((line, i) => {
    questions[`req_${i}`] = {
      type: "noul",
      instructions: `The agent's owner requires: "${line}". Does the DRAFT RESPONSE satisfy this requirement, as shown by the draft itself and the EVIDENCE?`,
    };
  });
  return questions;
}

export function scorePrecheck(answers: Record<string, JevAnswer>, criteria: string | undefined): Precheck | null {
  const contradicted = answers["contradicted"]?.noul;
  const fabricated = answers["fabricated_list"]?.noul;
  if (typeof contradicted !== "number" || typeof fabricated !== "number") return null;
  const factRisk = Math.max(contradicted, fabricated);
  let weakestRequirement: Precheck["weakestRequirement"] = null;
  const lines = requirementLines(criteria);
  for (let i = 0; i < lines.length; i += 1) {
    const score = answers[`req_${i}`]?.noul;
    if (typeof score !== "number") return null;
    if (!weakestRequirement || score < weakestRequirement.score) weakestRequirement = { text: lines[i] ?? "", score };
  }
  const ruleRisk = weakestRequirement ? 1 - weakestRequirement.score : 0;
  return { risk: Math.max(factRisk, ruleRisk), factRisk, weakestRequirement };
}

export function precheckEnabled(): boolean {
  return jevEnabled();
}

export async function runPrecheck(input: VerifyResponseInput, ask: PrecheckAsk = jevAsk): Promise<Precheck | null> {
  const answers = await ask(buildPrecheckState(input), buildPrecheckQuestions(input.criteria), {
    purpose: "verify-prefilter",
    timeoutMs: jevThreshold("JEV_VERIFY_TIMEOUT_MS", 3_000),
  }).catch(() => null);
  return answers ? scorePrecheck(answers, input.criteria) : null;
}

export function holdErrors(pre: Precheck): ResponseClaimError[] {
  const ruleRisk = pre.weakestRequirement ? 1 - pre.weakestRequirement.score : 0;
  if (pre.weakestRequirement && ruleRisk >= pre.factRisk) {
    return [{
      claim: pre.weakestRequirement.text,
      check: "delivery requirement",
      found: "The draft and the evidence do not show this requirement is met.",
    }];
  }
  return [{
    claim: "One or more concrete claims in the draft (counts, names, values, statuses)",
    check: "evidence consistency",
    found: "At least one claim looks inconsistent with the tool results gathered this run. Re-check each number, name and list against the evidence before resubmitting.",
  }];
}
