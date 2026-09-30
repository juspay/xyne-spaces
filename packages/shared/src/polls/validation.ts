import { z } from 'zod';

import { POLL_LIMITS, type PollDraft } from './types.js';
import { normalizePollChoice } from './policy.js';

const stableIdSchema = z.string().trim().min(1, 'A stable ID is required');

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
    options: z
      .array(pollOptionDraftSchema)
      .min(POLL_LIMITS.minOptions, 'At least two choices are required')
      .max(POLL_LIMITS.maxOptions, 'Too many choices'),
  })
  .strict()
  .superRefine((question, context) => {
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
    allowComments: z.boolean(),
    allowMultipleVotes: z.boolean(),
    allowAudienceChoices: z.boolean(),
    questions: z
      .array(pollQuestionDraftSchema)
      .min(1, 'At least one question is required')
      .max(POLL_LIMITS.maxQuestions, 'Too many questions'),
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

export const buildPollMessageSummary = (draft: PollDraft): string => {
  const [firstQuestion] = draft.questions;
  const additionalQuestionCount = draft.questions.length - 1;
  const suffix =
    additionalQuestionCount > 0
      ? ` (+${additionalQuestionCount} more)`
      : '';

  return `Poll: ${firstQuestion.question}${suffix}`;
};
