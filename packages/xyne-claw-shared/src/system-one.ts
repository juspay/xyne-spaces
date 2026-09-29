/**
 * Shared shapes and request validation for `POST /v1/systemone` (XOR / Jev).
 *
 * Grid gates this endpoint with a small parallel-request limit, and a rejected
 * (422) request has been seen to hold a slot for a long time. Every caller
 * therefore validates the exact question shape here before sending, and uses
 * synthetic ids (`m0`, `b3`, `w1`) rather than catalog slugs.
 */

export type SystemOneQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export interface SystemOneAnswer {
  type?: string;
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  confidence?: number;
}

export interface SystemOneRequest {
  state: string;
  model?: string;
  questions: Record<string, SystemOneQuestion>;
}

export interface SystemOneLimits {
  maxQuestions: number;
  maxStateChars: number;
  maxInstructionChars: number;
  maxCriterionChars: number;
}

export const SYSTEM_ONE_LIMITS: SystemOneLimits = {
  maxQuestions: 80,
  maxStateChars: 6000,
  maxInstructionChars: 500,
  maxCriterionChars: 200,
};

const ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

export type SystemOneValidation = { ok: true } | { ok: false; reason: string };

function fail(reason: string): SystemOneValidation {
  return { ok: false, reason };
}

function validateQuestion(
  id: string,
  q: SystemOneQuestion,
  limits: SystemOneLimits,
): SystemOneValidation {
  if (!ID_RE.test(id)) return fail(`question id "${id}" must match ${ID_RE}`);
  if (!q || typeof q !== "object") return fail(`${id}: question must be an object`);
  const instructions = (q as { instructions?: unknown }).instructions;
  if (typeof instructions !== "string" || instructions.trim().length === 0) {
    return fail(`${id}: instructions must be a non-empty string`);
  }
  if (instructions.length > limits.maxInstructionChars) {
    return fail(`${id}: instructions exceed ${limits.maxInstructionChars} chars`);
  }
  switch (q.type) {
    case "noul": {
      const extra = Object.keys(q).filter((k) => k !== "type" && k !== "instructions");
      if (extra.length > 0) return fail(`${id}: noul takes only type and instructions (got ${extra.join(",")})`);
      return { ok: true };
    }
    case "choice": {
      const criteria = q.criteria;
      if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
        return fail(`${id}: choice criteria must be a map`);
      }
      const entries = Object.entries(criteria);
      if (entries.length < 2) return fail(`${id}: choice needs at least 2 criteria`);
      for (const [key, value] of entries) {
        if (!ID_RE.test(key)) return fail(`${id}: criterion key "${key}" must match ${ID_RE}`);
        if (typeof value !== "string" || value.trim().length === 0) {
          return fail(`${id}: criterion "${key}" must be a non-empty string`);
        }
        if (value.length > limits.maxCriterionChars) {
          return fail(`${id}: criterion "${key}" exceeds ${limits.maxCriterionChars} chars`);
        }
      }
      return { ok: true };
    }
    case "score": {
      const criteria = q.criteria;
      if (!Array.isArray(criteria) || criteria.length === 0) {
        return fail(`${id}: score criteria must be a non-empty string array`);
      }
      for (const value of criteria) {
        if (typeof value !== "string" || value.trim().length === 0 || value.length > limits.maxCriterionChars) {
          return fail(`${id}: score criteria entries must be 1-${limits.maxCriterionChars} chars`);
        }
      }
      return { ok: true };
    }
    default:
      return fail(`${id}: unknown question type "${String((q as { type?: unknown }).type)}"`);
  }
}

/** Reject anything Grid could 422 on, before it costs a parallel slot. */
export function validateSystemOneRequest(
  req: SystemOneRequest,
  limits: SystemOneLimits = SYSTEM_ONE_LIMITS,
): SystemOneValidation {
  if (typeof req.state !== "string" || req.state.trim().length === 0) {
    return fail("state must be a non-empty string");
  }
  if (req.state.length > limits.maxStateChars) {
    return fail(`state exceeds ${limits.maxStateChars} chars`);
  }
  const ids = Object.keys(req.questions ?? {});
  if (ids.length === 0) return fail("at least one question is required");
  if (ids.length > limits.maxQuestions) return fail(`more than ${limits.maxQuestions} questions`);
  for (const id of ids) {
    const verdict = validateQuestion(id, req.questions[id]!, limits);
    if (!verdict.ok) return verdict;
  }
  return { ok: true };
}

/** Trim a string to `max` chars on a word-ish boundary, for instructions and criteria. */
export function clipForQuestion(text: string, max: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
