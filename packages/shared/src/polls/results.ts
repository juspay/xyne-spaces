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
  const optionCounts: Record<string, number> = {};
  const rankTotals: Record<string, number> = {};
  let ratingTotal = 0;

  for (const ballot of ballots) {
    for (const optionId of ballot.optionIds) {
      optionCounts[optionId] = (optionCounts[optionId] ?? 0) + 1;
    }
    ballot.rankedOptionIds?.forEach((optionId, index) => {
      rankTotals[optionId] = (rankTotals[optionId] ?? 0) + index + 1;
    });
    ratingTotal += ballot.rating ?? 0;
  }

  return { voterCount: ballots.length, optionCounts, rankTotals, ratingTotal };
}
