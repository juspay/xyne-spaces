import { z } from 'zod';

export enum ValidationIssueCode {
  SHAPE = 'shape',
  UNKNOWN_REFERENCE = 'unknownReference',
  FORWARD_REFERENCE = 'forwardReference',
  TYPE_MISMATCH = 'typeMismatch',
  DUPLICATE_STEP_ID = 'duplicateStepId',
  MISSING_CREDENTIAL = 'missingCredential',
  INVALID_FILTER = 'invalidFilter',
  INVALID_JUMP = 'invalidJump',
  /**
   * The config reads correctly but names something that will not work: a channel
   * the author cannot use, a repository the credential cannot see.
   *
   * The one code decided by ASKING — a component's `validateConfig`, with
   * credentials and a caller — rather than by reading the config, which is what
   * separates it from the specific faults above. The specificity lives in the
   * message, so this stays the single code for anything a component refuses.
   *
   * Also carries the case where the check could not be run at all. That is not
   * strictly a misconfiguration, and the message says so ("could not verify —
   * please try again") rather than accusing the author of a mistake that may not
   * exist; the code is shared because nothing branches on it.
   */
  MISCONFIGURED = 'misconfigured',
  /**
   * A `{% ... %}` expression that cannot be read, may not run, or sits where
   * expressions are not evaluated.
   *
   * Separate from SHAPE because the config *is* well-shaped — the field holds a
   * string, and a string is what the schema asked for. The fault is inside the
   * string, and only something that parses the expression language can see it.
   */
  INVALID_EXPRESSION = 'invalidExpression',
}

export const ValidationIssueCodeSchema = z.nativeEnum(ValidationIssueCode);

/**
 * Resolved, navigation-friendly location of an issue. The validator emits this
 * (it already holds `step.id` / the trigger while walking) so consumers — the
 * UI especially — never have to reverse-engineer the indexed `path`.
 */
export interface ValidationIssueLocation {
  scope: 'trigger' | 'step';
  /** Owning step id (scope 'step') — unique across the whole tree, even nested. */
  stepId?: string;
  /** Dotted field path within that config (e.g. 'email', 'branches.main'); omitted for whole-step issues (id/type). */
  field?: string;
}

export interface ValidationIssue {
  path: string;
  code: ValidationIssueCode;
  message: string;
  /** Resolved location for navigation/grouping. Always set by ConfigValidator. */
  location?: ValidationIssueLocation;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
