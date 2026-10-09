export const POLL_LIMITS = {
  maxQuestions: 10,
  maxQuestionLength: 500,
  minOptions: 2,
  maxOptions: 10,
  maxOptionLength: 200,
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
  sortResultsByVotes?: boolean;
  questions: PollQuestionDraft[];
}

export interface PollSchedule {
  publishAt?: string | null;
  closeAt?: string | null;
  remindAt?: string | null;
}

export interface PollResultAccessContext {
  visibility: PollResultVisibility;
  isPollCreator: boolean;
  isChannelCreator: boolean;
  isChannelAdmin: boolean;
  isClosed: boolean;
}
