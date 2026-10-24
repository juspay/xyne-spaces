import type { PollOption } from "./types.js";
import type { PollDraft, PollSchedule } from "./validation.js";

export interface PollRowsInput {
  draft: PollDraft;
  messageId: string;
  workspaceId: string;
  userId: string;
  timestamp: number;
  schedule?: PollSchedule;
  /**
   * Scheduled delivery can run after the close or reminder time (restart grace, retries).
   * It then posts the poll already closed, without a reminder, instead of failing.
   */
  lateDelivery?: boolean;
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
  lateDelivery = false,
}: PollRowsInput) {
  const closesAt = toEpoch(schedule.closeAt);
  let remindAt = toEpoch(schedule.remindAt);
  const closeHasPassed = closesAt !== null && closesAt <= timestamp;
  const reminderHasPassed = remindAt !== null && remindAt <= timestamp;
  if (!lateDelivery && closeHasPassed) {
    throw new Error("Poll close time must be in the future");
  }
  if (!lateDelivery && reminderHasPassed) {
    throw new Error("Poll reminder time must be in the future");
  }
  if (reminderHasPassed || closeHasPassed) remindAt = null;

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
      closedAt: closeHasPassed ? closesAt : null,
      createdAt: timestamp,
    },
    questions: draft.questions.map((question, position) => ({
      id: question.id,
      workspaceId,
      pollId: draft.pollId,
      question: question.question,
      position,
      responseType: question.responseType ?? "SINGLE_CHOICE",
      options: question.options.map((option): PollOption => ({ id: option.id, text: option.text })),
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
