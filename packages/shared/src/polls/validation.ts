import { z } from 'zod';

import {
  POLL_LIMITS,
  POLL_NON_CHOICE_RESPONSE_TYPES,
  POLL_RESPONSE_TYPES,
  POLL_RESULT_VISIBILITIES,
  type PollDraft,
  type PollSchedule,
} from "./types.js";
import { normalizePollChoice } from "./policy.js";

const stableIdSchema = z.string().trim().min(1, "A stable ID is required");

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
    if (
      ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'RANKING'].includes(question.responseType) &&
      question.options.length < POLL_LIMITS.minOptions
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least two choices are required',
        path: ['options'],
      });
    }
    const optionIds = new Set<string>();
    const optionLabels = new Set<string>();

    question.options.forEach((option, index) => {
      if (optionIds.has(option.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate choice ID',
          path: ['options', index, 'id'],
        });
      }
      optionIds.add(option.id);

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
    sortResultsByVotes: z.boolean().default(false),
    questions: z
      .array(pollQuestionDraftSchema)
      .min(1, "At least one question is required")
      .max(POLL_LIMITS.maxQuestions, "Too many questions"),
  })
  .strict()
  .superRefine((draft, context) => {
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

export const normalizePollDraft = (draft: unknown): PollDraft =>
  pollDraftSchema.parse(draft);

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

export const normalizePollSchedule = (schedule: unknown): PollSchedule =>
  pollScheduleSchema.parse(schedule);

export const pollResponseSchema = z
  .object({
    questionId: stableIdSchema,
    responseType: z.enum(POLL_NON_CHOICE_RESPONSE_TYPES),
    textAnswer: z.string().trim().min(1).max(5000).optional(),
    rankedOptionIds: z.array(stableIdSchema).min(2).optional(),
    rating: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  .superRefine((response, context) => {
    const hasDuplicates = (values: readonly string[] | undefined): boolean =>
      !!values && new Set(values).size !== values.length;
    const hasOnly = (key: "textAnswer" | "rankedOptionIds" | "rating") => {
      const keys = ["textAnswer", "rankedOptionIds", "rating"] as const;
      return keys.every(
        (candidate) => candidate === key || response[candidate] === undefined,
      );
    };
    if (
      (response.responseType === "SHORT_TEXT" ||
        response.responseType === "Q_AND_A") &&
      (!response.textAnswer || !hasOnly("textAnswer"))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Text responses require an answer",
      });
    }
    if (
      response.responseType === "RANKING" &&
      (!response.rankedOptionIds || !hasOnly("rankedOptionIds"))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ranking responses require ranked options",
      });
    }
    if (hasDuplicates(response.rankedOptionIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ranking responses cannot contain duplicate option IDs",
        path: ["rankedOptionIds"],
      });
    }
    if (
      response.responseType === "RATING_1_TO_5" &&
      (response.rating === undefined || !hasOnly("rating"))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Rating responses require a rating from 1 to 5",
      });
    }
  });

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
