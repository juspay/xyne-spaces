/**
 * Single source of truth for the `{{...}}` variable reference wire format.
 *
 * Both the engine (runtime resolver) and UI (picker/autocomplete) consume this.
 * The `context.` prefix is optional for backward compatibility — both
 * `{{context.trigger.x}}` and `{{trigger.x}}` are recognized.
 */

import type { WorkflowConfig, WorkflowStepConfig } from '../types/workflow-config.js';

/**
 * Matches a *pure* single reference (the entire string is a ref).
 * The `context.` prefix is optional.
 */
export const VARIABLE_REF_REGEX = /^\{\{(?:context\.)?[^}]+\}\}$/;

export type VariableRefToken =
  | { kind: 'literal'; text: string }
  | { kind: 'ref'; path: string; raw: string };

/** Global regex — captures the dotted path inside `{{...}}`. */
const TOKEN_REGEX = /\{\{(?:context\.)?([^}]+)\}\}/g;

/**
 * Tokenize a string into literal segments and variable references.
 *
 *   "hello"                     → [literal('hello')]
 *   "{{trigger.x}}"             → [ref('trigger.x')]
 *   "Hi {{trigger.user.name}}!" → [literal('Hi '), ref('trigger.user.name'), literal('!')]
 */
export function tokenize(input: string): VariableRefToken[] {
  const tokens: VariableRefToken[] = [];
  let lastIndex = 0;
  TOKEN_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TOKEN_REGEX.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        kind: 'literal',
        text: input.slice(lastIndex, match.index),
      });
    }
    tokens.push({ kind: 'ref', path: match[1]!, raw: match[0] });
    lastIndex = TOKEN_REGEX.lastIndex;
  }
  if (lastIndex < input.length) {
    tokens.push({ kind: 'literal', text: input.slice(lastIndex) });
  }
  return tokens;
}

/** True iff `value` is exactly one reference with no surrounding text. */
export function isPureRef(value: string): boolean {
  return VARIABLE_REF_REGEX.test(value);
}

/**
 * Extract the dotted path from a pure reference: `{{trigger.x}}` → `trigger.x`.
 * Returns null if `value` isn't a pure reference.
 */
export function extractRefPath(value: string): string | null {
  const m = /^\{\{(?:context\.)?([^}]+)\}\}$/.exec(value);
  return m?.[1] ?? null;
}

export interface FoundRef {
  /** The dotted path inside the ref, e.g. `trigger.ticket.id`. */
  refPath: string;
  /** JSON-pointer-style location in the config object where the ref string lives. */
  location: string;
}

/**
 * Collect every `{{...}}` reference found anywhere in a nested config object
 * (strings, arrays, objects). Used by the config validator to flag unresolvable refs.
 *
 * `skip` holds values not to descend into, matched by identity — the validator
 * passes a control step's branch arrays, whose steps it checks in their own scope.
 */
export function collectRefs(
  value: unknown,
  prefix: string,
  skip?: ReadonlySet<unknown>,
): FoundRef[] {
  const out: FoundRef[] = [];
  walkConfigStrings(value, prefix, skip, (text, location) => {
    TOKEN_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN_REGEX.exec(text)) !== null) {
      out.push({ refPath: match[1]!, location });
    }
  });
  return out;
}

/**
 * Visit every string in a nested config object, with its JSON-pointer-style
 * location.
 *
 * Extracted from {@link collectRefs} so the `{% expression %}` collector can
 * walk a config the same way without duplicating the traversal — and, more to
 * the point, without this file having to know that expressions exist. That
 * matters: the UI imports this module on every screen, and the expression
 * engine is a ~850 KB dependency that must not be dragged along with it.
 *
 * `skip` holds values not to descend into, matched by identity.
 */
export function walkConfigStrings(
  value: unknown,
  prefix: string,
  skip: ReadonlySet<unknown> | undefined,
  visit: (text: string, location: string) => void,
): void {
  if (skip?.has(value)) return;
  if (typeof value === 'string') {
    visit(value, prefix);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkConfigStrings(value[i], `${prefix}[${i}]`, skip, visit);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walkConfigStrings(v, prefix ? `${prefix}.${k}` : k, skip, visit);
    }
  }
}

// ─── Ref parsing (the head rule, shared by engine + UI) ───

/**
 * Parsed view of a ref path's head. Mirrors the branching in
 * `resolvePath` (engine/variable-resolver.ts) — the single rule for how a
 * dotted ref maps to a source:
 *
 *   trigger.x.y                 → { source: 'trigger', path: 'x.y' }
 *   workflow.id                 → { source: 'workflow', path: 'id' }
 *   steps.stepId.output.field   → { source: 'step', stepId, path: 'output.field' }
 *   stepId.output.field         → { source: 'step', stepId, path: 'output.field' } (shorthand)
 *
 * Transient/derived — never persisted. `path` is the remainder after the head
 * (and stepId for step refs), e.g. `output.body.status`.
 */
export interface ParsedRef {
  source: 'step' | 'trigger' | 'workflow' | 'execution' | 'vars';
  /** Producing step id — present iff `source === 'step'`. */
  stepId?: string | undefined;
  /** Sub-path after the head/stepId, e.g. `output.body.status` or `rrn`. */
  path?: string | undefined;
}

/** Parse a dotted ref path into its source/stepId/path. Pure; no context. */
export function parseRef(refPath: string): ParsedRef {
  const segments = refPath.split('.').filter((s) => s.length > 0);
  const head = segments[0];

  if (head === 'trigger' || head === 'workflow' || head === 'execution' || head === 'vars') {
    return { source: head, path: segments.slice(1).join('.') || undefined };
  }
  if (head === 'steps') {
    return {
      source: 'step',
      stepId: segments[1],
      path: segments.slice(2).join('.') || undefined,
    };
  }
  // Shorthand: bare step id → context.steps[id]
  return {
    source: 'step',
    stepId: head,
    path: segments.slice(1).join('.') || undefined,
  };
}

// ─── Reference integrity (who points at a given step) ───

function isStepLike(v: unknown): v is WorkflowStepConfig {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { id?: unknown }).id === 'string' &&
    typeof (v as { type?: unknown }).type === 'string'
  );
}

/** True if a ref path targets `stepId` (`stepId.…` shorthand or `steps.stepId.…`). */
function refTargetsStep(refPath: string, stepId: string): boolean {
  const parsed = parseRef(refPath);
  return parsed.source === 'step' && parsed.stepId === stepId;
}

/**
 * Collect ref paths from a step's OWN config, NOT descending into nested step
 * arrays (those belong to nested steps, visited separately). Keeps the
 * "who references X" attribution precise (a container isn't blamed for its
 * children's refs).
 */
function collectOwnRefPaths(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    for (const tok of tokenize(value)) {
      if (tok.kind === 'ref') out.push(tok.path);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isStepLike(item)) continue; // nested step — handled on its own visit
      collectOwnRefPaths(item, out);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectOwnRefPaths(v, out);
    }
  }
}

/** Schema-free walk of every step in the config (incl. nested in branches/loops/cases). */
export function walkSteps(value: unknown, visit: (step: WorkflowStepConfig) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isStepLike(item)) {
        visit(item);
        walkSteps((item as { config?: unknown }).config, visit);
      } else {
        walkSteps(item, visit);
      }
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      walkSteps(v, visit);
    }
  }
}

/**
 * Find the ids of every step whose config references `stepId`'s output
 * (e.g. `{{stepId.output.x}}`). Used to warn before deleting a referenced step.
 * Excludes the target itself; works across nested branches/loops.
 *
 * **Known gap: `{% expressions %}` are not searched.** A step referenced only
 * from inside an expression is not reported here, so deleting it would not warn.
 * Closing it needs the JSONata AST (`refsInExpression`), and this module is
 * deliberately free of that dependency — the UI imports it on every screen.
 *
 * The fix is to move this function to a module that may import both grammars,
 * keeping the name and re-exporting it, rather than to make this file heavy. It
 * is not urgent: nothing can author an expression until the editor supports
 * one, and the warning is advisory. It should be done in the same change that
 * teaches the editor to write expressions.
 */
export function findStepsReferencing(config: WorkflowConfig, stepId: string): string[] {
  const result: string[] = [];
  walkSteps(config.steps, (step) => {
    if (step.id === stepId) return;
    const refs: string[] = [];
    collectOwnRefPaths((step as { config?: unknown }).config, refs);
    if (refs.some((rp) => refTargetsStep(rp, stepId))) {
      result.push(step.id);
    }
  });
  return result;
}
