/**
 * The `{% … %}` wire format: how an expression is spelled and where one
 * appears. Imports no parser, so the config schema, the UI and the config walk
 * can recognise one without pulling in JSONata — only `expression.ts` does.
 *
 * Not `{{…}}`: every consumer of that one splits its body on `.` as a path, so
 * a second delimiter is purely additive and needs no migration.
 */
import { VARIABLE_REF_REGEX, walkConfigStrings } from '../util/variable-ref.js';

/** Matches a *pure* expression (the entire string is one `{% ... %}`). */
export const EXPRESSION_REGEX = /^\{%([\s\S]*)%\}$/;

/** Drop the anchors, so a pattern can be embedded in an alternation. */
const unanchored = (re: RegExp): string => re.source.replace(/^\^/, '').replace(/\$$/, '');

/**
 * A pure `{{ref}}` or a pure `{% expression %}`. Composed from both patterns
 * rather than written out a third time.
 */
export const REF_OR_EXPRESSION_REGEX = new RegExp(
  `^(?:${unanchored(VARIABLE_REF_REGEX)}|${unanchored(EXPRESSION_REGEX)})$`,
);

/**
 * Global, non-greedy — `"a {% x %} b {% y %}"` must find two expressions, not one spanning the middle.
 */
const EXPRESSION_TOKEN_REGEX = /\{%([\s\S]*?)%\}/g;

/**
 * Non-global twin, for `.test()`.
 *
 * `.test()` on a global regex advances its `lastIndex` and resumes from there on
 * the next call, so sharing one with the tokenizer would make the answer depend
 * on what was asked before it.
 */
const EXPRESSION_PRESENT_REGEX = /\{%[\s\S]*?%\}/;

export type ExpressionToken =
  | { kind: 'literal'; text: string }
  | { kind: 'expression'; source: string; raw: string };

/** True iff `value` is exactly one expression with no surrounding text. */
export function isExpression(value: string): boolean {
  return EXPRESSION_REGEX.test(value);
}

/** True iff `value` contains at least one expression anywhere. */
export function hasExpression(value: string): boolean {
  return value.includes('{%') && EXPRESSION_PRESENT_REGEX.test(value);
}

/**
 * The source inside a pure expression: `"{% $sum(a) %}"` → `"$sum(a)"`.
 * Returns null if `value` isn't a pure expression.
 */
export function extractExpressionSource(value: string): string | null {
  const m = EXPRESSION_REGEX.exec(value);
  return m?.[1]?.trim() ?? null;
}

/** Split a string into literal segments and expressions. */
export function tokenizeExpressions(input: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let lastIndex = 0;
  EXPRESSION_TOKEN_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = EXPRESSION_TOKEN_REGEX.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'literal', text: input.slice(lastIndex, match.index) });
    }
    tokens.push({ kind: 'expression', source: match[1]!.trim(), raw: match[0] });
    lastIndex = EXPRESSION_TOKEN_REGEX.lastIndex;
  }
  if (lastIndex < input.length) {
    tokens.push({ kind: 'literal', text: input.slice(lastIndex) });
  }
  return tokens;
}

/** Wrap an expression source into its wire form. The one place that spells it. */
export function toExpressionValue(source: string): string {
  return `{% ${source.trim()} %}`;
}

/**
 * The context roots an expression may read — the same five `resolvePath` resolves, and nothing else.
 */
export const EXPRESSION_ROOTS = ['trigger', 'workflow', 'execution', 'steps', 'vars'] as const;

export interface FoundExpression {
  /** The expression source, without delimiters. */
  source: string;
  /** JSON-pointer-style location in the config object where it lives. */
  location: string;
}

/** Collect every `{% ... */
export function collectExpressions(
  value: unknown,
  prefix: string,
  skip?: ReadonlySet<unknown>,
): FoundExpression[] {
  const out: FoundExpression[] = [];
  walkConfigStrings(value, prefix, skip, (text, location) => {
    for (const token of tokenizeExpressions(text)) {
      if (token.kind === 'expression') out.push({ source: token.source, location });
    }
  });
  return out;
}
