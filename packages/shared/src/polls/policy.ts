import {
  POLL_LIMITS,
  isChoiceResponseType,
  type PollOption,
  type PollSchedule,
} from "./types.js";

export const normalizePollChoice = (text: string): string =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export const isPollClosed = (poll: { closedAt?: number | null }): boolean =>
  poll.closedAt != null;

export function assertPollOpen(poll: { closedAt?: number | null }): void {
  if (isPollClosed(poll)) {
    throw new Error("This poll is closed");
  }
}

/** Rankings must order every option of the question exactly once. */
export function assertCompleteRanking(
  options: readonly PollOption[],
  rankedOptionIds: readonly string[],
): void {
  const optionIds = new Set(options.map((option) => option.id));
  if (
    rankedOptionIds.length !== optionIds.size ||
    new Set(rankedOptionIds).size !== optionIds.size ||
    rankedOptionIds.some((id) => !optionIds.has(id))
  ) {
    throw new Error("Rank every option once");
  }
}

/** Returns the question's options with `option` appended, or throws why it cannot be added. */
export function appendPollOption(
  question: { responseType: string; options: readonly PollOption[] },
  option: PollOption,
): PollOption[] {
  if (!isChoiceResponseType(question.responseType)) {
    throw new Error("Options can only be added to choice questions");
  }
  if (question.options.length >= POLL_LIMITS.maxOptions) {
    throw new Error("This question already has the maximum number of options");
  }
  const normalizedText = normalizePollChoice(option.text);
  if (question.options.some((existing) => normalizePollChoice(existing.text) === normalizedText)) {
    throw new Error("This option already exists");
  }
  return [...question.options, option];
}

export function assertPollMessageActive(
  message: { isDeleted: boolean } | null | undefined,
): void {
  if (!message) {
    throw new Error("Poll message is not available");
  }
  if (message.isDeleted) {
    throw new Error("This poll message was deleted");
  }
}

export function isPollMessageMetadata(metadata: unknown): boolean {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).messageSubtype === "poll"
  );
}

/** A scheduled poll's close and reminder times must still fall after its publish time. */
export function assertPollScheduleAfter(
  pollDraft: unknown,
  publishAt: number,
): void {
  const schedule = (pollDraft as { schedule?: PollSchedule } | null)?.schedule;
  for (const time of [schedule?.closeAt, schedule?.remindAt]) {
    if (time && Date.parse(time) <= publishAt) {
      throw new Error("Pick a time before the poll's close and reminder times");
    }
  }
}
