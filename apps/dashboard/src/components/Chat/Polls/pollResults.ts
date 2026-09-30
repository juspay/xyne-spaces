type PollOptionLike = { id: string };
type PollBallotLike = { userId: string; optionIds: readonly string[] };

export function calculatePollResults(
  options: readonly PollOptionLike[],
  ballots: readonly PollBallotLike[],
  currentUserId: string,
) {
  const voterCount = new Set(ballots.map(ballot => ballot.userId)).size;
  const currentSelections =
    ballots.find(ballot => ballot.userId === currentUserId)?.optionIds ?? [];

  return {
    voterCount,
    currentSelections: [...currentSelections],
    options: options.map(option => {
      const count = ballots.filter(ballot => ballot.optionIds.includes(option.id)).length;
      return {
        optionId: option.id,
        count,
        percentage: voterCount === 0 ? 0 : Math.round((count / voterCount) * 100),
      };
    }),
  };
}
