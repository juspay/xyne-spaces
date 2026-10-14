type PollOptionLike = { id: string; text: string };
type PollBallotLike = {
  userId: string;
  optionIds: readonly string[];
  textAnswer?: string | null;
  rankedOptionIds?: readonly string[] | null;
  rating?: number | null;
};
type PollUserLike = {
  displayName?: string | null;
  name?: string | null;
  email?: string | null;
};

export type PollVoterDetail = { userId: string; name: string };
export type PollOptionVoterDetails = {
  optionId: string;
  optionText: string;
  voters: PollVoterDetail[];
};
export type PollResponseDetail = PollVoterDetail & { answer: string };

const voterName = (user: PollUserLike | undefined): string =>
  user?.displayName?.trim() || user?.name?.trim() || user?.email?.trim() || 'Unknown voter';

// Callers pass only ballots the viewer may see: PollVotesACL already limits
// identified ballots to the creator of a non-anonymous poll.
export function buildPollVoterDetails({
  options,
  ballots,
  usersById,
}: {
  options: readonly PollOptionLike[];
  ballots: readonly PollBallotLike[];
  usersById: ReadonlyMap<string, PollUserLike>;
}): PollOptionVoterDetails[] {
  return options.map(option => ({
    optionId: option.id,
    optionText: option.text,
    voters: ballots
      .filter(ballot => ballot.optionIds.includes(option.id))
      .map(ballot => ({ userId: ballot.userId, name: voterName(usersById.get(ballot.userId)) })),
  }));
}

export function buildPollResponseDetails({
  responseType,
  options,
  ballots,
  usersById,
}: {
  responseType: string;
  options: readonly PollOptionLike[];
  ballots: readonly PollBallotLike[];
  usersById: ReadonlyMap<string, PollUserLike>;
}): PollResponseDetail[] {
  const optionText = new Map(options.map(option => [option.id, option.text]));

  return ballots.map(ballot => {
    let answer = ballot.textAnswer?.trim() ?? '';
    if (responseType === 'RATING_1_TO_5') answer = `${ballot.rating ?? '—'}/5`;
    if (responseType === 'RANKING') {
      answer = (ballot.rankedOptionIds ?? [])
        .map((optionId, index) => `${index + 1}. ${optionText.get(optionId) ?? optionId}`)
        .join(', ');
    }
    return {
      userId: ballot.userId,
      name: voterName(usersById.get(ballot.userId)),
      answer: answer || 'No response',
    };
  });
}
