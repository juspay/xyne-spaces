import type { PollDraft, PollOption, PollSchedule } from "./types.js";

export interface PollRowsInput {
  draft: PollDraft;
  messageId: string;
  workspaceId: string;
  userId: string;
  timestamp: number;
  schedule?: PollSchedule;
}

const toEpoch = (value: string | null | undefined): number | null =>
  value ? Date.parse(value) : null;

/**
 * The rows a newly published poll consists of. Zero mutators and the scheduled
 * delivery transaction both write exactly these rows.
 */
export function buildPollRows({
  draft,
  messageId,
  workspaceId,
  userId,
  timestamp,
  schedule = {},
}: PollRowsInput) {
  const closesAt = toEpoch(schedule.closeAt);
  const remindAt = toEpoch(schedule.remindAt);
  if (closesAt !== null && closesAt <= timestamp) {
    throw new Error("Poll close time must be in the future");
  }
  if (remindAt !== null && remindAt <= timestamp) {
    throw new Error("Poll reminder time must be in the future");
  }

  return {
    poll: {
      id: draft.pollId,
      workspaceId,
      messageId,
      createdBy: userId,
      allowAudienceChoices: draft.allowAudienceChoices,
      isAnonymous: draft.isAnonymous,
      resultVisibility: draft.resultVisibility ?? "EVERYONE",
      closesAt,
      remindAt,
      closedAt: null,
      createdAt: timestamp,
    },
    questions: draft.questions.map((question, position) => ({
      id: question.id,
      workspaceId,
      pollId: draft.pollId,
      question: question.question,
      position,
      responseType: question.responseType ?? "SINGLE_CHOICE",
      options: question.options.map(
        (option): PollOption => ({ id: option.id, text: option.text, createdBy: userId }),
      ),
      createdAt: timestamp,
    })),
    results: draft.questions.map((question) => ({
      questionId: question.id,
      workspaceId,
      pollId: draft.pollId,
      voterCount: 0,
      optionCounts: {},
      rankTotals: {},
      ratingTotal: 0,
      updatedAt: timestamp,
    })),
  };
}
