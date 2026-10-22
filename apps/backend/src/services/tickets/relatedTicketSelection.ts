import type { TicketRelatedJevConfig, TicketRelatedScore } from '@/agents/ticket-duplicate';

type RelatedSelectionConfig = Pick<TicketRelatedJevConfig, 'sameCauseThreshold' | 'sameSymptomThreshold' | 'maxLinks'>;

/**
 * Which scored candidates become RELATED_POSSIBLE links. Candidates are solved tickets
 * only (the caller filters them). Same cause first; same problem with the new ticket's
 * cause still unknown is a second tier that has to clear the higher bar. A different cause
 * or a different problem is never linked.
 */
const tierOf = (
  candidate: TicketRelatedScore,
  { sameCauseThreshold, sameSymptomThreshold }: RelatedSelectionConfig,
): number | null => {
  if (candidate.relation === 'same_cause') return candidate.score >= sameCauseThreshold ? 0 : null;
  if (candidate.relation === 'same_symptom_cause_unknown') {
    return candidate.score >= sameSymptomThreshold ? 1 : null;
  }
  return null;
};

export const pickRelatedTicketIds = (
  scores: ReadonlyArray<TicketRelatedScore>,
  config: RelatedSelectionConfig,
): string[] =>
  scores
    .flatMap(candidate => {
      const tier = tierOf(candidate, config);
      return tier === null ? [] : [{ ...candidate, tier }];
    })
    .sort((a, b) => a.tier - b.tier || b.score - a.score)
    .slice(0, Math.max(0, config.maxLinks))
    .map(candidate => candidate.id);
