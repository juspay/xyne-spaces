type PollOptionLike = { id: string };
type PollBallotLike = { optionIds: readonly string[] };
type PollResultAggregateLike = {
  voterCount: number;
  optionCounts: unknown;
};

const readOptionCount = (optionCounts: unknown, optionId: string): number => {
  if (!optionCounts || typeof optionCounts !== 'object' || Array.isArray(optionCounts)) return 0;
  const value = (optionCounts as Record<string, unknown>)[optionId];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
};

export function calculatePollResults(
  options: readonly PollOptionLike[],
  aggregate: PollResultAggregateLike | null | undefined,
  currentUserBallots: readonly PollBallotLike[],
) {
  const voterCount = Math.max(0, aggregate?.voterCount ?? 0);
  const currentSelections = currentUserBallots[0]?.optionIds ?? [];

  return {
    voterCount,
    currentSelections: [...currentSelections],
    options: options.map(option => {
      const count = readOptionCount(aggregate?.optionCounts, option.id);
      return {
        optionId: option.id,
        count,
        percentage: voterCount === 0 ? 0 : Math.round((count / voterCount) * 100),
      };
    }),
  };
}

export function calculateRatingResult(
  aggregate: { ratingTotal?: number; voterCount?: number } | null | undefined,
) {
  const responseCount = Math.max(0, aggregate?.voterCount ?? 0);
  const ratingTotal = Math.max(0, aggregate?.ratingTotal ?? 0);
  return {
    responseCount,
    average: responseCount === 0 ? 0 : Math.round((ratingTotal / responseCount) * 10) / 10,
  };
}

export function calculateRankingResult(
  options: readonly PollOptionLike[],
  aggregate: { rankTotals?: unknown; voterCount?: number } | null | undefined,
) {
  const totals = aggregate?.rankTotals;
  const responseCount = Math.max(0, aggregate?.voterCount ?? 0);
  return options
    .map(option => ({
      optionId: option.id,
      totalRank:
        totals && typeof totals === 'object' && !Array.isArray(totals)
          ? Math.max(0, Number((totals as Record<string, unknown>)[option.id]) || 0)
          : 0,
      averageRank: 0,
    }))
    .map(result => ({
      ...result,
      averageRank:
        responseCount === 0 ? 0 : Math.round((result.totalRank / responseCount) * 10) / 10,
    }))
    .sort((a, b) => {
      if (responseCount === 0) return 0;
      return a.averageRank - b.averageRank;
    });
}
