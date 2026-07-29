import { z } from 'zod';

/**
 * Question option schema
 */
export const QuestionOptionSchema = z.object({
  id: z.string().min(1).max(100).describe('Unique identifier for this option'),
  label: z.string().min(1).max(500).describe('Display label shown to the user'),
  description: z.string().max(1000).optional().describe('Optional additional description for this option'),
});

/**
 * Question type - single select from options
 */
export const SingleSelectQuestionSchema = z.object({
  type: z.literal('single_select').describe('Question type: single_select for choosing one option'),
  id: z.string().min(1).max(100).describe('Unique identifier for this question'),
  question: z.string().min(1).max(1000).describe('The question text displayed to the user'),
  description: z.string().max(2000).optional().describe('Optional additional context or explanation'),
  options: z.array(QuestionOptionSchema).min(2).max(50).describe('List of options the user can choose from (minimum 2)'),
});

/**
 * Question type - multi select from options
 */
export const MultiSelectQuestionSchema = z.object({
  type: z.literal('multi_select').describe('Question type: multi_select for choosing multiple options'),
  id: z.string().min(1).max(100).describe('Unique identifier for this question'),
  question: z.string().min(1).max(1000).describe('The question text displayed to the user'),
  description: z.string().max(2000).optional().describe('Optional additional context or explanation'),
  options: z.array(QuestionOptionSchema).min(2).max(50).describe('List of options the user can choose from (minimum 2)'),
});

/**
 * Question type - open-ended text answer
 */
export const TextQuestionSchema = z.object({
  type: z.literal('text').describe('Question type: text for open-ended free-form text answers'),
  id: z.string().min(1).max(100).describe('Unique identifier for this question'),
  question: z.string().min(1).max(1000).describe('The question text displayed to the user'),
  description: z.string().max(2000).optional().describe('Optional additional context or explanation'),
});

/**
 * Union of all question types
 */
export const QuestionSchema = z.discriminatedUnion('type', [
  SingleSelectQuestionSchema,
  MultiSelectQuestionSchema,
  TextQuestionSchema,
]);

/**
 * Question group - a step with a heading and multiple questions
 */
export const QuestionGroupSchema = z.object({
  id: z.string().min(1).max(100).describe('Unique identifier for this question group'),
  heading: z.string().min(1).max(500).describe('Heading displayed for this group/step'),
  description: z.string().max(2000).optional().describe('Optional description for this group'),
  questions: z.array(QuestionSchema).min(1).max(20).describe('List of questions in this group (minimum 1, maximum 20)'),
});

/**
 * Answer to a single question
 * For single/multi select with custom option, the customText field contains the user's written answer
 */
export const QuestionAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('single_select'),
    questionId: z.string(),
    selectedOptionId: z.string(),
    customText: z.string().optional(), // For "Other" option where user writes their own answer
  }),
  z.object({
    type: z.literal('multi_select'),
    questionId: z.string(),
    selectedOptionIds: z.array(z.string()),
    customText: z.string().optional(), // For "Other" option where user writes their own answer
  }),
  z.object({
    type: z.literal('text'),
    questionId: z.string(),
    text: z.string(), // The user's open-ended text answer
  }),
]);

/**
 * Input schema for ask_question tool
 * 
 * This tool allows you to ask the user interactive questions with a menu-based UI.
 * The questions are presented in groups (steps), each with a heading.
 * 
 * Question types:
 * - text: Open-ended question where the user types a free-form text answer
 * - single_select: User must choose exactly one option from the list
 * - multi_select: User can choose one or more options from the list
 * 
 * All select questions automatically include an "Other" option where users can 
 * write their own custom answer if none of the provided options fit.
 * 
 * The tool works in two phases:
 * 1. First call: Provide question groups to display to the user
 * 2. Second call: The tool returns with the user's answers
 */
export const AskQuestionInputSchema = z.object({
  groups: z.array(QuestionGroupSchema).min(1).max(10).describe('Question groups to display to the user. Each group is a step with a heading and one or more questions.'),
  answers: z.array(QuestionAnswerSchema).optional().describe('User answers - only provided when the tool is called a second time to submit responses'),
});

/**
 * Output schema for ask_question tool - when questions are asked (needs frontend)
 */
export const AskQuestionPendingOutputSchema = z.object({
  _requiresUserInput: z.literal(true),
  _toolName: z.literal('ask_question'),
  questionGroups: z.array(QuestionGroupSchema),
});

/**
 * Output schema for ask_question tool - when answers are received
 */
export const AskQuestionCompletedOutputSchema = z.object({
  success: z.literal(true),
  answers: z.array(QuestionAnswerSchema),
  completedAt: z.string(),
});

/**
 * Output schema for ask_question tool - when validation fails
 */
export const AskQuestionFailedOutputSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum(['validation_failed', 'missing_required', 'invalid_answers']),
    message: z.string(),
    details: z.array(z.string()).optional(),
  }),
});

/**
 * Union of all output schemas
 */
export const AskQuestionOutputSchema = z.union([
  AskQuestionPendingOutputSchema,
  AskQuestionCompletedOutputSchema,
  AskQuestionFailedOutputSchema,
]);

/**
 * LLM output schema - minimal info for LLM
 */
export const AskQuestionLLMOutputSchema = z.object({
  message: z.string(),
  answers: z.array(z.object({
    questionId: z.string(),
    answer: z.union([z.string(), z.array(z.string())]),
  })).optional(),
  error: z.string().optional(),
});

// Type exports
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type SingleSelectQuestion = z.infer<typeof SingleSelectQuestionSchema>;
export type MultiSelectQuestion = z.infer<typeof MultiSelectQuestionSchema>;
export type TextQuestion = z.infer<typeof TextQuestionSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionGroup = z.infer<typeof QuestionGroupSchema>;
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;
export type AskQuestionInput = z.infer<typeof AskQuestionInputSchema>;
export type AskQuestionPendingOutput = z.infer<typeof AskQuestionPendingOutputSchema>;
export type AskQuestionCompletedOutput = z.infer<typeof AskQuestionCompletedOutputSchema>;
export type AskQuestionFailedOutput = z.infer<typeof AskQuestionFailedOutputSchema>;
export type AskQuestionOutput = z.infer<typeof AskQuestionOutputSchema>;
export type AskQuestionLLMOutput = z.infer<typeof AskQuestionLLMOutputSchema>;
