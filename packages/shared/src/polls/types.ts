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

/** Question types whose answers refer to the question's options. */
export const POLL_OPTION_RESPONSE_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "RANKING"] as const;

export const usesPollOptions = (responseType: string): boolean =>
  (POLL_OPTION_RESPONSE_TYPES as readonly string[]).includes(responseType);

/** Free-text question types; their answers exist only on each voter's own ballot. */
export const POLL_TEXT_RESPONSE_TYPES = ["SHORT_TEXT", "Q_AND_A"] as const;

export const isTextResponseType = (responseType: string): boolean =>
  (POLL_TEXT_RESPONSE_TYPES as readonly string[]).includes(responseType);

export const isChoiceResponseType = (
  responseType: string,
): responseType is PollChoiceResponseType =>
  (POLL_CHOICE_RESPONSE_TYPES as readonly string[]).includes(responseType);

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
};
