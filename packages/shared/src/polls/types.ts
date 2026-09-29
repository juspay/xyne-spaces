export const POLL_LIMITS = {
  maxQuestions: 10,
  maxQuestionLength: 500,
  minOptions: 2,
  maxOptions: 10,
  maxOptionLength: 200,
} as const;

export interface PollOptionDraft {
  id: string;
  text: string;
}

export interface PollQuestionDraft {
  id: string;
  question: string;
  options: PollOptionDraft[];
}

export interface PollDraft {
  pollId: string;
  allowComments: boolean;
  allowMultipleVotes: boolean;
  allowAudienceChoices: boolean;
  questions: PollQuestionDraft[];
}
