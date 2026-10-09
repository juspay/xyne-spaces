export function nextBallotOptionIds(
  currentOptionIds: readonly string[],
  optionId: string,
  selected: boolean,
  responseType: "SINGLE_CHOICE" | "MULTIPLE_CHOICE",
): string[] {
  if (!selected) {
    return currentOptionIds.filter((currentId) => currentId !== optionId);
  }
  if (responseType === "SINGLE_CHOICE") {
    return [optionId];
  }
  return currentOptionIds.includes(optionId)
    ? [...currentOptionIds]
    : [...currentOptionIds, optionId];
}
