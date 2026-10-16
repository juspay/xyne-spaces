import type { PollResponseInput } from "./validation.js";

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

/** The ballot columns a non-choice response writes; the response's type decides which one is set. */
export function ballotFieldsForResponse(response: PollResponseInput) {
  return {
    optionIds: [] as string[],
    textAnswer: "textAnswer" in response ? response.textAnswer : null,
    rankedOptionIds: "rankedOptionIds" in response ? response.rankedOptionIds : null,
    rating: "rating" in response ? response.rating : null,
  };
}
