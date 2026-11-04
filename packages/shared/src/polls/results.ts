// Pure result math shared by the poll card, the vote mutators and the agent tool.
// No imports: `@xyne/shared/polls/results` is consumed by xyne-claw-auth as-is.

export interface PollBallot {
  optionIds: readonly string[];
  rankedOptionIds?: readonly string[] | null;
  rating?: number | null;
}

export interface PollQuestionAggregate {
  voterCount: number;
  optionCounts: Record<string, number>;
  rankTotals: Record<string, number>;
  ratingTotal: number;
}

/** Recomputes a question's identity-free result row from every ballot on it. */
export function aggregatePollBallots(ballots: readonly PollBallot[]): PollQuestionAggregate {
  // Maps, not `{}`: option ids are user-supplied and must not hit Object.prototype keys.
  const optionCounts = new Map<string, number>();
  const rankTotals = new Map<string, number>();
  let ratingTotal = 0;

  for (const ballot of ballots) {
    for (const optionId of ballot.optionIds) {
      optionCounts.set(optionId, (optionCounts.get(optionId) ?? 0) + 1);
    }
    ballot.rankedOptionIds?.forEach((optionId, index) => {
      rankTotals.set(optionId, (rankTotals.get(optionId) ?? 0) + index + 1);
    });
    ratingTotal += ballot.rating ?? 0;
  }

  return {
    voterCount: ballots.length,
    optionCounts: Object.fromEntries(optionCounts),
    rankTotals: Object.fromEntries(rankTotals),
    ratingTotal,
  };
}

type ResultRow = Pick<PollQuestionAggregate, 'voterCount'> &
  Partial<Pick<PollQuestionAggregate, 'optionCounts' | 'rankTotals' | 'ratingTotal'>>;

const countFor = (counts: Record<string, number> | undefined, optionId: string): number =>
  counts && Object.prototype.hasOwnProperty.call(counts, optionId) ? counts[optionId] : 0;

/** Votes and whole-number percentage per option, in the given option order. */
export function calculateOptionResults(
  options: readonly { id: string }[],
  aggregate: ResultRow | null | undefined,
) {
  const voterCount = aggregate?.voterCount ?? 0;
  return options.map(option => {
    const count = countFor(aggregate?.optionCounts, option.id);
    return {
      optionId: option.id,
      count,
      percentage: voterCount === 0 ? 0 : Math.round((count / voterCount) * 100),
    };
  });
}

/** Average rating rounded to one decimal; 0 when nobody has rated. */
export function calculateAverageRating(aggregate: ResultRow | null | undefined): number {
  const voterCount = aggregate?.voterCount ?? 0;
  return voterCount === 0 ? 0 : Math.round(((aggregate?.ratingTotal ?? 0) / voterCount) * 10) / 10;
}

/** Options by average rank, best first; rounded to one decimal, 0 when nobody has ranked. */
export function calculateRankingResults(
  options: readonly { id: string }[],
  aggregate: ResultRow | null | undefined,
) {
  const voterCount = aggregate?.voterCount ?? 0;
  return options
    .map(option => ({
      optionId: option.id,
      averageRank:
        voterCount === 0
          ? 0
          : Math.round((countFor(aggregate?.rankTotals, option.id) / voterCount) * 10) / 10,
    }))
    .sort((a, b) => a.averageRank - b.averageRank);
}
