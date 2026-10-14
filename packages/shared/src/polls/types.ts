export const POLL_LIMITS = {
  maxQuestions: 10,
  maxQuestionLength: 500,
  minOptions: 2,
  maxOptions: 10,
  maxOptionLength: 200,
  maxShortTextLength: 500,
  maxLongTextLength: 5000,
} as const;

export const POLL_RESPONSE_TYPES = [
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "SHORT_TEXT",
  "RANKING",
  "RATING_1_TO_5",
  "Q_AND_A",
] as const;

export type PollResponseType = (typeof POLL_RESPONSE_TYPES)[number];

export const POLL_CHOICE_RESPONSE_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE"] as const;

export type PollChoiceResponseType = (typeof POLL_CHOICE_RESPONSE_TYPES)[number];

export const isChoiceResponseType = (
  responseType: string,
): responseType is PollChoiceResponseType =>
  (POLL_CHOICE_RESPONSE_TYPES as readonly string[]).includes(responseType);

export const POLL_NON_CHOICE_RESPONSE_TYPES = [
  "SHORT_TEXT",
  "RANKING",
  "RATING_1_TO_5",
  "Q_AND_A",
] as const;

export type PollNonChoiceResponseType =
  (typeof POLL_NON_CHOICE_RESPONSE_TYPES)[number];

export const POLL_RESULT_VISIBILITIES = [
  "EVERYONE",
  "CREATOR_ONLY",
  "AFTER_CLOSE",
  "ADMIN_ONLY",
] as const;

export type PollResultVisibility = (typeof POLL_RESULT_VISIBILITIES)[number];

/** One entry of `poll_questions.options`; array order is display order. */
export type PollOption = {
  id: string;
  text: string;
  createdBy: string;
};

export interface PollOptionDraft {
  id: string;
  text: string;
}

export interface PollQuestionDraft {
  id: string;
  question: string;
  options: PollOptionDraft[];
  responseType?: PollResponseType;
}

export interface PollResponseInput {
  questionId: string;
  responseType: PollNonChoiceResponseType;
  textAnswer?: string;
  rankedOptionIds?: string[];
  rating?: number;
}

export interface PollDraft {
  pollId: string;
  allowAudienceChoices: boolean;
  isAnonymous: boolean;
  resultVisibility?: PollResultVisibility;
  questions: PollQuestionDraft[];
}

export interface PollSchedule {
  publishAt?: string | null;
  closeAt?: string | null;
  remindAt?: string | null;
}
