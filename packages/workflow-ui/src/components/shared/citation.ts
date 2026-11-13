/**
 * Runtime-citation helpers for the reader side.
 *
 * The types live in the SDK (`@xyne/workflow-sdk/common`) — one definition, so
 * the producer (agent step) and the renderers can't drift. This module adds only
 * what reading needs: unwrapping a cited agent response, and walking the
 * citation mirror alongside the data.
 */
import type { CitationRef, CitationMap, RefCitation } from '@xyne/workflow-sdk/common';
import { isCitationRef, isCitationRefArray } from '@xyne/workflow-sdk/common';

export type { CitationRef, CitationMap, RefCitation };
export { isCitationRef, isCitationRefArray };

/**
 * The citation branch belonging to a child, indexed exactly as the value is.
 *
 * How containers walk data and citations in lockstep: since the mirror follows
 * the value's shape, the key or index used to descend into one descends into the
 * other. `undefined` in, `undefined` out — an uncited subtree just stays quiet.
 */
export function citeAt(cite: unknown, key: string | number): unknown {
  return cite !== null && typeof cite === 'object'
    ? (cite as Record<PropertyKey, unknown>)[key]
    : undefined;
}

/**
 * The citations for one data point, addressed by its path into the rendered data
 * (`['response', 'total']`, `['response', 'lineItems', 0, 'amount']`).
 *
 * Exact match, not prefix: the mirror follows the data exactly, so a hit is the
 * citations *for that leaf* and nothing is inherited from an ancestor. (Contrast
 * `getFieldCitations` in origin-resolver, which is prefix-aware because author
 * citations are written at a different granularity than they're read.)
 */
export function citationsAt(
  map: CitationMap,
  path: ReadonlyArray<string | number>,
): CitationRef[] {
  let cur: unknown = map;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return [];
    cur = (cur as Record<PropertyKey, unknown>)[seg];
  }
  return isCitationRefArray(cur) ? cur : [];
}

function citedWrapper(
  output: Record<string, unknown> | undefined,
): { value: unknown; citation: CitationMap } | undefined {
  const response = output?.['response'];
  if (
    response === null
    || typeof response !== 'object'
    || Array.isArray(response)
    || !('value' in response || 'citation' in response)
  ) {
    return undefined;
  }
  const w = response as { value?: unknown; citation?: CitationMap };
  return { value: w.value, citation: w.citation ?? {} };
}

/**
 * Split a step's output into the data to render and a citation mirror **aligned
 * to it**.
 *
 * A cited agent returns `output.response = { value, citation }`. We hoist `value`
 * back into `response` so the panel shows the data itself rather than a wrapper,
 * and nest the mirror under the same key — leaving citation and data the same
 * shape, so one walk indexes both (`data.response.total` ↔ `citation.response.total`).
 *
 * Everything else — uncited agents, every other step type — passes through with
 * `citation: undefined`, so renderers can call this unconditionally.
 */
export function unwrapResponse(output: Record<string, unknown> | undefined): {
  data: Record<string, unknown>;
  citation: CitationMap | undefined;
} {
  const wrapper = citedWrapper(output);
  if (!wrapper) return { data: output ?? {}, citation: undefined };
  return {
    // Sibling agent fields (attachments, usage, toolCalls) are preserved.
    data: { ...output, response: wrapper.value },
    citation: { response: wrapper.citation },
  };
}

/**
 * The matching unwrap for the declared output schema: `resolveOutputJsonSchema`
 * describes a cited response as `{ value, citation }`, so hoist `value` back to
 * `response` exactly as {@link unwrapResponse} does to the data. Without this the
 * schema and the data would disagree about what `response` is, and the
 * schema-driven renderer would fall back to a raw JSON dump.
 */
export function unwrapResponseSchema(
  schema: Record<string, unknown> | undefined,
  output: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!schema || !citedWrapper(output)) return schema;
  const props = schema['properties'] as Record<string, unknown> | undefined;
  const response = props?.['response'] as Record<string, unknown> | undefined;
  const inner = (response?.['properties'] as Record<string, unknown> | undefined)?.['value'];
  if (!props || !inner) return schema;
  return { ...schema, properties: { ...props, response: inner } };
}
