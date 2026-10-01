export function nextBallotOptionIds(
  currentOptionIds: readonly string[],
  optionId: string,
  selected: boolean,
  allowMultipleVotes: boolean,
): string[] {
  if (!selected) {
    return currentOptionIds.filter(currentId => currentId !== optionId);
  }
  if (!allowMultipleVotes) {
    return [optionId];
  }
  return currentOptionIds.includes(optionId)
    ? [...currentOptionIds]
    : [...currentOptionIds, optionId];
}
