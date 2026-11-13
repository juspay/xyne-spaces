import { z } from 'zod';
import { zodToJsonSchemaRecord } from '../util/schema-convert.js';

/**
 * CitationRef — a runtime, agent-emitted citation: where one data point came from.
 *
 * Deliberately separate from the author-time `Citation` overlay
 * (`types/workflow-config.ts`), which an author attaches to a step's *config* in
 * the builder and which the executor ignores. This one is produced by an agent at
 * execution time and travels *with the output data* — `output.response.citation`,
 * a structural mirror of `output.response.value`.
 *
 * Three kinds — everything a model can honestly say about where a value came from:
 *
 * - `ref` — a path the agent was explicitly shown (the `[source: ...]` labels the
 *   agent step injects around resolved `{{refs}}`). An agent can never emit an
 *   {@link Attachment}: its `data` is an opaque host handle the model has no way
 *   to know. Turning a `ref` into an openable document happens in the UI, which
 *   alone holds the workflow config + step outputs required to walk to the source.
 * - `url` — an external link the agent browsed. Already concrete; nothing to resolve.
 * - `derived` — the value was **computed**, so it appears nowhere to be quoted;
 *   its provenance is the inputs it combined and how. See {@link DerivedCitationSchema}.
 *
 * `locator` / `quote` are the half only the reader of the text can supply: they
 * locate the passage *inside* the source the `ref` names. Which source a value
 * came from is structural (the workflow knows it); where inside it is data (only
 * the agent knows it) — this split is why citations are never inferred by tracing.
 *
 * **There is deliberately no separate "document" vs "value" kind.** Whether a ref
 * resolves to an openable document or to plain step output is a *structural* fact
 * the model cannot know — it saw text, not the workflow graph. Asking it to
 * classify would guarantee confident mis-labelling, and a wrong discriminator is
 * far worse than an omitted optional field. So the emitted union is shaped by what
 * the agent can know; the *resolved* union (UI) splits `doc` from `value`, where
 * the answer is actually available. When there is nothing to locate within, the
 * agent simply omits `locator`/`quote`.
 */

/**
 * Where inside a source a value sits.
 *
 * Discriminated rather than a bag of optional fields: a spreadsheet has no pages
 * and a PDF has no rows, so `page?`/`row?`/`line?` side by side would make most
 * combinations meaningless and every consumer defensive.
 *
 * The agent asserts this only because the `[source: …]` label *shows* it — it is
 * copied, never inferred. Anything a label can't show stays out of this union
 * (an image bounding box, for instance, which no reader of text could know).
 */
export const LocatorSchema = z.discriminatedUnion('at', [
  z.object({
    at: z.literal('page'),
    page: z.number().int().positive().describe('1-based page'),
  }),
  z.object({
    at: z.literal('cell'),
    sheet: z.string().optional().describe('Sheet name, when the file has several'),
    row: z.number().int().describe('1-based row, header included — as shown in Excel'),
    col: z.union([z.string(), z.number()]).describe('Column letter ("B") or index'),
  }),
  z.object({
    at: z.literal('line'),
    from: z.number().int().describe('1-based first line'),
    to: z.number().int().optional().describe('Last line, for a range'),
  }),
]);

export type Locator = z.infer<typeof LocatorSchema>;

export const RefCitationSchema = z.object({
  kind: z.literal('ref'),
  // The `{{ref}}` grammar (see util/variable-ref.ts + engine/resolvePath): dotted
  // throughout, arrays indexed as plain segments (`results.0.source`). NOT the
  // bracketed CitationPath grammar (`results[id].text`), which addresses config.
  //
  // Names the SOURCE, not the text: `labelSources` surfaces the owning document
  // when there is one, so a cited passage points at the document it lives in
  // rather than at an internal text path. That keeps citations decoupled from a
  // producer's output shape, and means the document is a direct lookup rather
  // than something reconstructed by climbing the tree.
  ref: z
    .string()
    .describe('Path to the cited source, e.g. "steps.ocr.output.results.0.source"'),
  locator: LocatorSchema.optional().describe('Where inside that source the value sits'),
  quote: z
    .string()
    .optional()
    .describe('Exact source text — highlighted in the document viewer'),
  label: z
    .string()
    .optional()
    .describe('Short title shown instead of the resolved source name'),
});

export const UrlCitationSchema = z.object({
  kind: z.literal('url'),
  url: z.string().describe('External source — http(s) only'),
  quote: z.string().optional().describe('Exact text quoted from the page'),
  title: z.string().optional().describe('Short title shown instead of the bare URL'),
});

/**
 * A value the agent **computed** rather than read — a total, a ratio, a growth
 * rate. It appears nowhere in the source, so there is no passage to quote and no
 * page to open; its provenance is *these inputs, combined this way*.
 *
 * This is a distinct kind rather than "several citations on one value" because
 * the two mean opposite things. Two citations on a name are **corroboration** —
 * either alone still supports it. Two inputs to a subtraction are **required** —
 * if one is wrong, the value is wrong. Rendering them identically would hide that.
 *
 * `inputs` is deliberately only one level deep (an input can't itself be
 * `derived`): it keeps every union member a plain `ZodObject`, which is what
 * `z.discriminatedUnion` requires — a recursive member would force `z.union` plus
 * lazy schemas for no real gain, since a chain of derivations is already handled
 * by resolving *through* the upstream agent's own citation.
 */
export const DerivedCitationSchema = z.object({
  kind: z.literal('derived'),
  expression: z
    .string()
    .optional()
    .describe(
      'Arithmetic over the inputs, referenced positionally: "(#2 - #1) / #1". '
      + 'Only + - * / ( ) and numbers — no names or function calls, so it can be '
      + 'recomputed and verified.',
    ),
  // Validated all-or-nothing, unlike a list of plain citations where a malformed
  // entry is dropped and the rest kept. That is a correctness requirement, not
  // strictness: `expression` addresses inputs *by position*, so silently dropping
  // a bad one shifts every later index and the recomputation would quietly
  // evaluate something different. An unparseable derivation must fail whole.
  inputs: z
    .array(z.discriminatedUnion('kind', [RefCitationSchema, UrlCitationSchema]))
    .min(1)
    .describe('The values that were combined, in the order `#1`, `#2`, … refer to'),
  // The prompt asks the agent to always supply this (an expression like
  // `(#1+#2+#3)/(#4+#5)` is meaningless without a name), but it stays schema-optional
  // so a derivation is never dropped for lacking it — the UI falls back to the
  // expression. Hard-enforcement (required + sanitize backfill) is a later step.
  label: z
    .string()
    .optional()
    .describe(
      'Plain-language name of what the value represents — e.g. "Debt Service '
      + 'Coverage Ratio" — so a reader understands what the expression computes.',
    ),
});

export const CitationRefSchema = z.discriminatedUnion('kind', [
  RefCitationSchema,
  UrlCitationSchema,
  DerivedCitationSchema,
]);

export type CitationRef = z.infer<typeof CitationRefSchema>;
export type RefCitation = z.infer<typeof RefCitationSchema>;
export type UrlCitation = z.infer<typeof UrlCitationSchema>;
export type DerivedCitation = z.infer<typeof DerivedCitationSchema>;
/** An input to a derived citation — anything directly citable. */
export type SourceCitation = RefCitation | UrlCitation;

/**
 * The `citation` half of a cited agent response — a structural mirror of `value`
 * whose leaves are `CitationRef[]`.
 *
 * Typed loosely on purpose: its shape follows the author's arbitrary
 * `outputSchema`, so it can only be walked at runtime. {@link isCitationRef} is
 * what makes the walk unambiguous — it distinguishes a citation *leaf*
 * (`[{kind:'ref',…}]`) from a mirror *branch* (`[{amount:[…]}]`), since only
 * leaves carry `kind`.
 */
export type CitationMap = unknown;

/**
 * The canonical (agent) cited-value shape and, above all, its DEPTH: a cited
 * `{ value, citation }` pair sits directly inside a step's output envelope —
 * `output.<envelope>.value`, three segments — with the citation mirror as its
 * sibling `output.<envelope>.citation`.
 *
 * `'response'` is only the agent's envelope word; {@link splitCitedRef} matches
 * the *shape*, not the word, so any executor's envelope qualifies (see there). The
 * constant is retained for its LENGTH — the envelope depth every consumer floors
 * or slices against — and as the canonical example of the shape.
 */
export const CITED_VALUE_SEGMENTS = ['output', 'response', 'value'] as const;

/**
 * Split a ref at the boundary between "which cited value" and "which field inside
 * it": `a.b.output.result.value.x.y` → `{ base:'a.b', envelope:'result', field:['x','y'] }`.
 *
 * Two invariants, both *relative* so no control-flow shape can break them:
 *
 * 1. A citation mirror is always the value's sibling, at whatever depth the value
 *    sits. Encoding this as an absolute pattern (`steps.<id>.output.response.value`)
 *    silently stopped matching the moment a step lived inside a PARALLEL, whose
 *    output moved to `steps.<container>.output.branches.<b>.steps.<id>.output.…`.
 *
 * 2. The envelope word is the PRODUCING EXECUTOR's, not a fixed literal: a
 *    RUN_AGENT emits `output.response.value`, a CODE step (e.g. a merge that
 *    returns `{ value, citation }`) emits `output.result.value`, and a future
 *    executor may emit another word. So we match the SHAPE — `output.<one
 *    segment>.value` — and report which envelope was found. Whitelisting words
 *    (`response`, then `result`, then …) would be an endless list; keying on the
 *    pair is the actual convention.
 *
 * Anchoring on `output` (rather than a bare `.value`) keeps a data field genuinely
 * named `value` from matching. The real gate, though, is the caller: it looks up
 * the sibling `output.<envelope>.citation` and bails when it does not resolve — so
 * a value that isn't a cited pair self-rejects, wildcard envelope notwithstanding.
 *
 * Matched segment-wise, never by substring, so `valueX` cannot false-match. The
 * LAST occurrence wins: with nesting, the innermost cited value owns the field.
 */
export function splitCitedRef(
  ref: string,
): { base: string; envelope: string; field: string[] } | undefined {
  const s = ref.split('.');
  for (let i = s.length - CITED_VALUE_SEGMENTS.length; i >= 0; i--) {
    if (s[i] === 'output' && s[i + 2] === 'value') {
      return {
        base: s.slice(0, i).join('.'),
        envelope: s[i + 1]!,
        field: s.slice(i + CITED_VALUE_SEGMENTS.length),
      };
    }
  }
  return undefined;
}

/**
 * JSON Schema for one CitationRef — DERIVED from the Zod members (the single
 * source of truth for the shape) so the JSON view can't drift from the type.
 */
export const CITATION_REF_JSON_SCHEMA: Record<string, unknown> = {
  oneOf: [
    zodToJsonSchemaRecord(RefCitationSchema),
    zodToJsonSchemaRecord(UrlCitationSchema),
    zodToJsonSchemaRecord(DerivedCitationSchema),
  ],
};

/**
 * Runtime guard — is `value` a {@link CitationRef}? Discriminates on `kind` plus
 * the one field that kind requires.
 *
 * Load-bearing beyond validation: the renderers call this while walking the
 * citation mirror to decide whether a node is a leaf to render markers for, or a
 * branch to recurse into.
 */
export function isCitationRef(value: unknown): value is CitationRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['kind'] === 'ref') return typeof v['ref'] === 'string';
  if (v['kind'] === 'url') return typeof v['url'] === 'string';
  // Load-bearing: `isCitationRefArray` uses this to tell a citation *leaf* from a
  // mirror *branch*. Omit `derived` here and a computed value's citation would be
  // walked past as if it were structure, and never render.
  if (v['kind'] === 'derived') return Array.isArray(v['inputs']);
  return false;
}

/** Is `value` a citation *leaf* — a non-empty array of {@link CitationRef}? */
export function isCitationRefArray(value: unknown): value is CitationRef[] {
  return Array.isArray(value) && value.length > 0 && value.every(isCitationRef);
}

/**
 * Attributes a `:::citation{…}` markdown directive may carry — the contract
 * between the agent prompt (which instructs the syntax) and the markdown
 * renderer (whose sanitize schema allowlists exactly these and nothing else).
 */
export const CITATION_DIRECTIVE_ATTRS = ['ref', 'page', 'url', 'quote', 'title'] as const;
