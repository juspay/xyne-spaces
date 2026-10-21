import type { TicketRelatedRelation } from '@/agents/ticket-duplicate';

export interface RelatedCandidateScore {
  readonly id: string;
  readonly relation: TicketRelatedRelation;
  /** Jev's probability for `relation`. */
  readonly score: number;
}

export interface RelatedSelectionConfig {
  sameCauseThreshold: number;
  sameSymptomThreshold: number;
  maxLinks: number;
}

/**
 * Which scored candidates become RELATED_POSSIBLE links. Same cause first. Same problem
 * with the new ticket's cause still unknown is a second tier, taken only when the
 * candidate is solved (its resolution is the point) and clears the higher bar. A
 * different cause or a different problem is never linked. Within a tier, solved tickets
 * come before open ones, then higher scores.
 */
const tierOf = (
  candidate: RelatedCandidateScore,
  solved: boolean,
  { sameCauseThreshold, sameSymptomThreshold }: RelatedSelectionConfig,
): number | null => {
  if (candidate.relation === 'same_cause') return candidate.score >= sameCauseThreshold ? 0 : null;
  if (candidate.relation === 'same_symptom_cause_unknown') {
    return solved && candidate.score >= sameSymptomThreshold ? 1 : null;
  }
  return null;
};

export const pickRelatedTicketIds = (
  scores: ReadonlyArray<RelatedCandidateScore>,
  isSolved: (id: string) => boolean,
  config: RelatedSelectionConfig,
): string[] =>
  scores
    .flatMap(candidate => {
      const solved = isSolved(candidate.id);
      const tier = tierOf(candidate, solved, config);
      return tier === null ? [] : [{ ...candidate, solved, tier }];
    })
    .sort((a, b) => a.tier - b.tier || Number(b.solved) - Number(a.solved) || b.score - a.score)
    .slice(0, Math.max(0, config.maxLinks))
    .map(candidate => candidate.id);
