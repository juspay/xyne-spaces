// ---------------------------------------------------------------------------
// Mention extraction
//
// Type discovery lives in claw-auth; this backend only does closed mention
// extraction against the APPROVED types. The schema locks `type` to an enum of
// approved names, so validate() rejects and retries any mention the model files
// under an invented type.
// ---------------------------------------------------------------------------

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

/** System prompt listing the approved types with their rule + few-shot examples. */
export function buildMentionSystem(
  types: Array<{ name: string; rule: string; examples?: string[] }>,
): string {
  const typeBlock = types
    .map((t) => {
      const examples = t.examples && t.examples.length
        ? `\n    examples: ${t.examples.slice(0, 6).join(' | ')}`
        : ''
      return `- ${t.name}: ${t.rule}${examples}`
    })
    .join('\n')

  return `You are extracting entity mentions from internal payments chat, to index them for search.

You are given a FIXED set of entity types. For each message, find every span that names a specific instance of one of these types — and nothing else.

Types:
${typeBlock}

Rules:
- Only extract a span if it clearly matches one of the types above. If it fits no type, ignore it.
- Use the exact type name from the list. Never invent a type.
- Copy the span exactly as written — do not normalise, expand abbreviations, or correct spelling.
- One entry per occurrence. Skip generic nouns, people's names, and dates.
- If a message contains no matching mention, return nothing for it.`
}

/** Schema with `type` locked to the approved names, so validation is closed. */
export function buildMentionSchema(typeNames: string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['mentions'],
    properties: {
      mentions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['docIndex', 'span', 'type'],
          properties: {
            docIndex: { type: 'integer' },
            span: { type: 'string' },
            type: { type: 'string', enum: typeNames },
          },
        },
      },
    },
  }
}

export interface MentionResponse {
  mentions: Array<{ docIndex: number; span: string; type: string }>
}
