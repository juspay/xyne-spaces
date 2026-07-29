// ---------------------------------------------------------------------------
// Stage 3 — open type discovery
//
// The one and only place free-form type labels are permitted. Runs once over
// the channel's threads, offline. Its output is curated by a human into a
// frozen type set; it is never used to write to the registry.
// ---------------------------------------------------------------------------

export const OPEN_TYPE_SYSTEM = `You are labelling entity mentions in internal workplace chat to help design a taxonomy.

For each message, identify every mention of a specific, nameable thing — an organisation, product, system, team, place, or similar. For each, give a short lowercase type label describing what kind of thing it is. Use whatever label fits naturally; there is no fixed list.

Rules:
- Only concrete, nameable things. Skip generic nouns ("the dashboard", "a customer").
- Skip people's names and dates.
- Copy the span exactly as written. Do not correct spelling or expand abbreviations.
- If a message contains no such mentions, return an empty list for it.`

export const OPEN_TYPE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['labels'],
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['docIndex', 'span', 'label'],
        properties: {
          docIndex: { type: 'integer' },
          span: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
  },
}

export interface OpenTypeResponse {
  labels: Array<{ docIndex: number; span: string; label: string }>
}

/** Numbered batch, so responses can be mapped back to source documents. */
export function formatDocBatch(
  docs: Array<{ text: string; channelName: string; kind?: string }>,
  maxDocChars = 12_000,
): string {
  return docs
    .map((d, i) => {
      // Labelling threads matters: it tells the model the block is a single
      // conversation, so pronouns in a later line may refer to a name in an
      // earlier one rather than to nothing.
      const label =
        d.kind === 'thread'
          ? `[${i}] (thread in channel: ${d.channelName})`
          : `[${i}] (channel: ${d.channelName})`
      return `${label}\n${d.text.slice(0, maxDocChars)}`
    })
    .join('\n\n---\n\n')
}

// ---------------------------------------------------------------------------
// Stage 3b — type-set proposal
//
// Lexical clustering cannot merge "payment gateway" with "gateway", or
// "organisation" with "company" — the strings share almost nothing. That is a
// semantic judgement, and it is worth an LLM call here precisely because the
// conditions that rule LLMs out elsewhere are all absent: the input is ~40
// labels rather than millions of mentions, the task is genuinely semantic, and
// a human reviews the result at gate 1 before anything is frozen.
//
// The model PROPOSES. Gate 1 still decides.
// ---------------------------------------------------------------------------

export const TYPE_PROPOSAL_SYSTEM = `You are designing an entity taxonomy for search over an organisation's internal chat.

You will be given candidate type labels discovered by an open-ended extraction pass, with mention counts and example spans. Merge them into a small, curated taxonomy.

Rules:

1. ADMISSION TEST — a type earns its place only if someone would filter a search by it ("show me only X"). If no realistic query would, drop it. Types that exist just to describe things are decoration.

2. MERGE synonyms aggressively. Labels that name the same concept in different words belong to one type, even when the strings look nothing alike.

3. DROP unbounded-cardinality labels. If every instance is a unique value — order ids, transaction ids, request ids, timestamps, pod instance names, hashes — it must NOT become a type. One registry row per transaction, forever, is a failure.

4. DROP code-level identifiers unless the org would search by them: function names, struct/type names, field names, env vars, HTTP headers, file paths.

5. DROP grab-bag labels. A high-frequency label like "system", "thing", or "entity" whose examples span several unrelated concepts is the model's "I don't know" bucket, not a type. Its members belong to other types.

6. Target 5 to 15 types. Boundaries must be CRISP: a coarse type labelled consistently beats a precise one labelled inconsistently.

7. Every type needs a one-line decision rule that settles ambiguous cases. Write it so two different people would classify the same mention identically. State the discriminating property, not a description.

8. Types must be mutually exclusive. If two types could both claim a mention, the rules are wrong.

For each type give: an UPPER_SNAKE name, a short lowercase id prefix (2-4 chars), the decision rule, the source labels it absorbs, and a few example spans.
Also list every dropped label with the reason.`

export const TYPE_PROPOSAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['types', 'dropped'],
  properties: {
    types: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'prefix', 'rule', 'sourceLabels', 'examples'],
        properties: {
          name: { type: 'string' },
          prefix: { type: 'string' },
          rule: { type: 'string' },
          sourceLabels: { type: 'array', items: { type: 'string' } },
          examples: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    dropped: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'reason'],
        properties: {
          label: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

export interface TypeProposal {
  types: Array<{
    name: string
    prefix: string
    rule: string
    sourceLabels: string[]
    examples: string[]
  }>
  dropped: Array<{ label: string; reason: string }>
}

export function formatTypeCandidates(
  candidates: Array<{ label: string; count: number; variants: string[]; exampleSpans: string[] }>,
): string {
  return candidates
    .map(
      (c) =>
        `- "${c.label}" (${c.count} mentions)` +
        (c.variants.length > 1 ? `\n    spelling variants: ${c.variants.join(', ')}` : '') +
        `\n    examples: ${c.exampleSpans.slice(0, 8).join(' | ')}`,
    )
    .join('\n')
}

// ---------------------------------------------------------------------------
// Stage 4 — mention extraction
//
// Closed extraction: unlike discovery (open labels), the model may only tag a
// span with one of the APPROVED types. The schema enforces that — `type` is an
// enum of the approved names, so validate() rejects and retries any mention the
// model files under an invented type.
// ---------------------------------------------------------------------------

/** System prompt listing the approved types with their rule + few-shot examples. */
