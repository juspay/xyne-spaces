// ---------------------------------------------------------------------------
// Single source of truth for the automation `{{...}}` wire format.
//
// Both backend and dashboard consume this. Anything that needs to detect /
// tokenize / locate variable references imports from here so the two sides
// can never drift on the regex or the tokenizer's behaviour.
//
// The runtime resolver (backend) and the picker's parseReference (dashboard)
// still own their own higher-level decoders — those map the path INSIDE a
// reference to either a JS value (runtime) or a sourceKey/role/path triple
// (picker UI). What's deduped here is the lower-level "is this a reference,
// where are they, what dotted path do they carry".
// ---------------------------------------------------------------------------

/**
 * Matches a *pure* single reference (the entire string is a ref). The
 * `context.` prefix is optional so both `{{context.trigger.x}}` (legacy) and
 * `{{trigger.x}}` (new) are recognised.
 */
export const VARIABLE_REF_REGEX = /^\{\{(?:context\.)?[^}]+\}\}$/;

/**
 * Sentinel string the backend prefixes onto a Zod `.describe(...)` value so
 * the form (and downstream JSON Schema consumers) can detect "this is a
 * variableRef-wrapped field" without needing to inspect the Zod tree. Kept
 * here so the backend's writer and the dashboard's reader can never drift.
 */
export const VARIABLE_REF_DESCRIPTION_PREFIX = '__variableRef__';

export type VariableRefToken =
  | { kind: 'literal'; text: string }
  | { kind: 'ref'; path: string; raw: string };

/** Global regex — captures the dotted path inside `{{...}}`. */
const TOKEN_REGEX = /\{\{(?:context\.)?([^}]+)\}\}/g;

/**
 * Tokenize a string into literal segments and variable references.
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
      tokens.push({ kind: 'literal', text: input.slice(lastIndex, match.index) });
    }
    tokens.push({ kind: 'ref', path: match[1] as string, raw: match[0] });
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
  return m ? (m[1] ?? null) : null;
}

export interface FoundRef {
  /** The dotted path inside the ref, e.g. `trigger.ticket.id`. */
  refPath: string;
  /** JSON-pointer-style location in the config object where the ref string lives. */
  location: string;
}

/**
 * Collect every `{{...}}` reference found anywhere in a nested config object
 * (strings, arrays, objects). Used by the config validator to walk a step's
 * resolved input and flag any reference that doesn't resolve.
 */
export function collectRefs(value: unknown, prefix: string): FoundRef[] {
  const out: FoundRef[] = [];
  walk(value, prefix, out);
  return out;
}

function walk(value: unknown, prefix: string, out: FoundRef[]): void {
  if (typeof value === 'string') {
    TOKEN_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN_REGEX.exec(value)) !== null) {
      out.push({ refPath: match[1] as string, location: prefix });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], `${prefix}[${i}]`, out);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
}
