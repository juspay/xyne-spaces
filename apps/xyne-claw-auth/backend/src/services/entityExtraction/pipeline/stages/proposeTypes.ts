import type { LlmClient, Logger } from '../ports.js'
import type { TypeSet, TypeCandidate } from '../types.js'
import {
  TYPE_PROPOSAL_SCHEMA,
  TYPE_PROPOSAL_SYSTEM,
  formatTypeCandidates,
  type TypeProposal,
} from '../prompts.js'

/**
 * Stage 3b — propose a curated set of entity types from the raw label candidates.
 *
 * Lexical clustering (stage 3) only collapses spelling variants. It cannot know
 * that "payment gateway" and "gateway" are one concept, or that "organisation"
 * and "company" are — those strings share almost nothing. This pass does the
 * semantic merge, drops junk-drawer and unbounded-cardinality labels, and
 * drafts a decision rule per type.
 *
 * It is a PROPOSAL. Gate 1 still requires a human to accept or edit it, because
 * the type set determines every filter the org will ever run.
 */
export async function proposeTypes(
  candidates: TypeCandidate[],
  llm: LlmClient,
  logger?: Logger,
  /**
   * Types this workspace already uses, from earlier channels. Passing them in
   * is what makes a second channel reuse GATEWAY instead of inventing
   * GATEWAY_2 — without it, ten channels produce forty near-duplicate types and
   * a type filter silently misses half its entities.
   */
  existingTypes: Array<{ name: string; prefix: string; rule: string }> = [],
  /** Org/channel framing prepended to the system prompt (see buildContext). */
  context?: string,
): Promise<{ typeSet: TypeSet; dropped: TypeProposal['dropped'] }> {
  if (candidates.length === 0) {
    return { typeSet: { version: 1, types: [] }, dropped: [] }
  }

  const existingTypesSection =
    existingTypes.length > 0
      ? `Types this workspace already uses. REUSE these by name wherever they fit; ` +
        `only propose a new type for something genuinely not covered:\n` +
        existingTypes.map((existing) => `- ${existing.name} (${existing.prefix}) — ${existing.rule}`).join('\n') +
        `\n\nCandidate labels discovered in this channel:\n`
      : ''

  const proposal = await llm.completeJson<TypeProposal>({
    system: context ? `${context}\n\n${TYPE_PROPOSAL_SYSTEM}` : TYPE_PROPOSAL_SYSTEM,
    user: existingTypesSection + formatTypeCandidates(candidates),
    schema: TYPE_PROPOSAL_SCHEMA,
    schemaName: 'TypeProposal',
    purpose: 'entity-bootstrap:propose-types',
  })

  const usedPrefixes = new Set<string>()
  const resolvedTypes = proposal.types.map((proposed) => {
    // Prefixes become id prefixes, so they must be unique and slug-safe.
    let prefix = proposed.prefix.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || 'ent'
    let collisionSuffix = 2
    while (usedPrefixes.has(prefix)) prefix = `${prefix.slice(0, 3)}${collisionSuffix++}`
    usedPrefixes.add(prefix)

    return {
      name: proposed.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
      prefix,
      rule: proposed.rule,
      examples: proposed.examples.slice(0, 5),
    }
  })

  logger?.info('type set proposed', {
    types: resolvedTypes.length,
    dropped: proposal.dropped.length,
    absorbedLabels: proposal.types.reduce((sum, proposed) => sum + proposed.sourceLabels.length, 0),
  })

  return { typeSet: { version: 1, types: resolvedTypes }, dropped: proposal.dropped }
}
