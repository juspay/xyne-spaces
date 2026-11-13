import type { ValidationIssue, ValidationResult } from '@xyne/workflow-sdk';

/**
 * Buckets a {@link ValidationResult} by location for the builder UI. Relies on
 * the SDK validator's resolved `issue.location` (scope + stepId + field) — no
 * path-string parsing or config walking here (that lives in the validator, the
 * single source of truth).
 */
export interface GroupedIssues {
  /** Issues per step, keyed by `location.stepId`. */
  byStep: Map<string, ValidationIssue[]>;
  /** Trigger-scoped issues. */
  trigger: ValidationIssue[];
  /** Step ids that have issues, in validator emission order (= document order). */
  orderedStepIds: string[];
  /** Issues with no resolvable location (defensive; shown only in the summary). */
  unlocated: ValidationIssue[];
  /** Total issue count. */
  total: number;
}

export function groupIssues(result: ValidationResult | null | undefined): GroupedIssues {
  const byStep = new Map<string, ValidationIssue[]>();
  const trigger: ValidationIssue[] = [];
  const unlocated: ValidationIssue[] = [];
  const orderedStepIds: string[] = [];

  const issues = result?.issues ?? [];
  for (const issue of issues) {
    const loc = issue.location;
    if (loc?.scope === 'trigger') {
      trigger.push(issue);
    } else if (loc?.scope === 'step' && loc.stepId) {
      let arr = byStep.get(loc.stepId);
      if (!arr) {
        arr = [];
        byStep.set(loc.stepId, arr);
        orderedStepIds.push(loc.stepId);
      }
      arr.push(issue);
    } else {
      unlocated.push(issue);
    }
  }

  return { byStep, trigger, orderedStepIds, unlocated, total: issues.length };
}

/**
 * Field-level error map for a step's issues (`location.field` → message), for
 * merging into the config form's `errors`. First message per field wins.
 */
export function fieldErrors(issues: ValidationIssue[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues ?? []) {
    const field = issue.location?.field;
    if (field && !(field in out)) out[field] = issue.message;
  }
  return out;
}
