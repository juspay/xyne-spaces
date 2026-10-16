import { z } from 'zod';

import {
  POLL_LIMITS,
  POLL_RESPONSE_TYPES,
  POLL_RESULT_VISIBILITIES,
  isTextResponseType,
  usesPollOptions,
} from "./types.js";
import { normalizePollChoice } from "./policy.js";

// Client-generated ids. UUIDs only: ids key the stored counts and ballots.
const stableIdSchema = z.string().uuid("A UUID is required");

const pollOptionDraftSchema = z
  .object({
    id: stableIdSchema,
    text: z
      .string()
      .trim()
      .min(1, 'Choice text is required')
      .max(POLL_LIMITS.maxOptionLength, 'Choice text is too long'),
  })
  .strict();

const pollQuestionDraftSchema = z
  .object({
    id: stableIdSchema,
    question: z
      .string()
      .trim()
      .min(1, 'Question text is required')
      .max(POLL_LIMITS.maxQuestionLength, 'Question text is too long'),
    options: z.array(pollOptionDraftSchema).max(POLL_LIMITS.maxOptions, 'Too many choices'),
    responseType: z.enum(POLL_RESPONSE_TYPES).default('SINGLE_CHOICE'),
  })
  .strict()
  .superRefine((question, context) => {
    if (usesPollOptions(question.responseType) && question.options.length < POLL_LIMITS.minOptions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least two choices are required',
        path: ['options'],
      });
    }
    const optionLabels = new Set<string>();

    question.options.forEach((option, index) => {
      const normalizedLabel = normalizePollChoice(option.text);
      if (optionLabels.has(normalizedLabel)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate choice text',
          path: ['options', index, 'text'],
        });
      }
      optionLabels.add(normalizedLabel);
    });
  });

export const pollDraftSchema = z
  .object({
    pollId: stableIdSchema,
    allowAudienceChoices: z.boolean(),
    isAnonymous: z.boolean(),
    resultVisibility: z.enum(POLL_RESULT_VISIBILITIES).default("EVERYONE"),
    questions: z
      .array(pollQuestionDraftSchema)
      .min(1, "At least one question is required")
      .max(POLL_LIMITS.maxQuestions, "Too many questions"),
  })
  .strict()
  .superRefine((draft, context) => {
    // Text answers live only on ballots, which an anonymous poll's creator cannot read.
    if (draft.isAnonymous && draft.questions.some((question) => isTextResponseType(question.responseType))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Anonymous polls cannot include text or Q&A questions',
        path: ['isAnonymous'],
      });
    }
    const questionIds = new Set<string>();
    const optionIds = new Set<string>();

    draft.questions.forEach((question, questionIndex) => {
      if (questionIds.has(question.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate question ID',
          path: ['questions', questionIndex, 'id'],
        });
      }
      questionIds.add(question.id);

      question.options.forEach((option, optionIndex) => {
        if (optionIds.has(option.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Duplicate choice ID',
            path: ['questions', questionIndex, 'options', optionIndex, 'id'],
          });
        }
        optionIds.add(option.id);
      });
    });
  });

export type PollDraft = z.input<typeof pollDraftSchema>;

export const pollScheduleSchema = z
  .object({
    publishAt: z.string().datetime().nullable().optional(),
    closeAt: z.string().datetime().nullable().optional(),
    remindAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .superRefine((schedule, context) => {
    const publishAt = schedule.publishAt
      ? Date.parse(schedule.publishAt)
      : null;
    if (
      publishAt !== null &&
      schedule.closeAt &&
      Date.parse(schedule.closeAt) <= publishAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Poll close time must be after publication",
        path: ["closeAt"],
      });
    }
    if (
      publishAt !== null &&
      schedule.remindAt &&
      Date.parse(schedule.remindAt) <= publishAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reminder time must be after publication",
        path: ["remindAt"],
      });
    }
    if (
      schedule.remindAt &&
      schedule.closeAt &&
      Date.parse(schedule.remindAt) >= Date.parse(schedule.closeAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reminder time must be before the poll closes",
        path: ["remindAt"],
      });
    }
  });

export type PollSchedule = z.input<typeof pollScheduleSchema>;

const textAnswerSchema = (maxLength: number) => z.string().trim().min(1).max(maxLength);

export const pollResponseSchema = z.discriminatedUnion("responseType", [
  z.object({
    questionId: stableIdSchema,
    responseType: z.literal("SHORT_TEXT"),
    textAnswer: textAnswerSchema(POLL_LIMITS.maxShortTextLength),
  }).strict(),
  z.object({
    questionId: stableIdSchema,
    responseType: z.literal("Q_AND_A"),
    textAnswer: textAnswerSchema(POLL_LIMITS.maxLongTextLength),
  }).strict(),
  z.object({
    questionId: stableIdSchema,
    responseType: z.literal("RANKING"),
    rankedOptionIds: z.array(stableIdSchema).min(2),
  }).strict(),
  z.object({
    questionId: stableIdSchema,
    responseType: z.literal("RATING_1_TO_5"),
    rating: z.number().int().min(1).max(5),
  }).strict(),
]);

export type PollResponseInput = z.input<typeof pollResponseSchema>;

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

export const buildPollMessageSummary = (draft: PollDraft): string => {
  const [firstQuestion] = draft.questions;
  const additionalQuestionCount = draft.questions.length - 1;
  const suffix =
    additionalQuestionCount > 0 ? ` (+${additionalQuestionCount} more)` : "";

  return `Poll: ${escapeHtml(firstQuestion.question)}${suffix}`;
};
