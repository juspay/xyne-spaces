import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { askJev, type JevAnswer, type JevQuestion } from '@/services/queryIntent/jevClient';
import { logger } from '@/utils/logger';

const JEV_TIMEOUT_MS = 10_000;
const QUESTION_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

// Schemas are built fresh per use: a shared instance becomes a JSON-schema $ref the step form can't follow.
const optionSchema = () =>
  z.object({
    value: z.string().min(1).max(60).describe('Short id returned as the answer, e.g. "payment".'),
    description: z
      .string()
      .min(1)
      .max(200)
      .describe('When this option fits, e.g. "Payment failed or money deducted". Jev picks by this.'),
    text: z
      .string()
      .max(2000)
      .optional()
      .describe('Optional text returned when this option is picked, e.g. a reply. {{...}} variables are filled in.'),
  });

const questionSchema = () =>
  z.object({
    key: z
      .string()
      .max(40)
      .regex(QUESTION_KEY, 'Use letters, numbers and _, starting with a letter.')
      .describe('Name of this answer in later steps, e.g. "category".'),
    type: z
      .enum(['yes_no', 'choice', 'score'])
      .describe('yes_no: is it true? choice: pick one option. score: place the text on ordered levels.'),
    question: z.string().min(1).max(500).describe('What to ask about the text.'),
    options: z
      .array(optionSchema())
      .max(100)
      .optional()
      .describe('choice only: the options Jev picks from.'),
    levels: z
      .array(z.string().min(1).max(200))
      .max(10)
      .optional()
      .describe('score only: levels from lowest to highest, e.g. "Not urgent", "Urgent".'),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe('yes_no: the answer is yes at or above this. choice and score: below this confidence there is no answer.'),
  });

const AskJevConfigSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(20_000)
    .describe('What Jev reads. Mix plain text and {{...}} variables, e.g. "Rating: {{trigger.email.rating}} Review: {{trigger.email.body}}".'),
  questions: z
    .array(questionSchema())
    .min(1)
    .max(10)
    .describe('Asked together in one Jev call. Each answer is under its key in this step\'s output.'),
});

type AskJevConfig = z.infer<typeof AskJevConfigSchema>;
type QuestionConfig = AskJevConfig['questions'][number];
type OptionConfig = NonNullable<QuestionConfig['options']>[number];

const AnswerOutputSchema = z.object({
  /** Jev gave a usable answer. */
  answered: z.boolean(),
  /** yes_no: true/false. choice: the option's value. score: the level. Null when unanswered or below threshold. */
  answer: z.union([z.string(), z.boolean()]).nullable(),
  /** answer is set (for yes_no: Jev answered). */
  confident: z.boolean(),
  /** yes_no: probability of yes. choice and score: Jev's confidence in its pick. */
  confidence: z.number().nullable(),
  /** score: 0 at the lowest level, 1 at the highest. yes_no: probability of yes. */
  score: z.number().nullable(),
  /** choice: the picked option's text, when confident. */
  text: z.string().nullable(),
});

type AnswerOutput = z.infer<typeof AnswerOutputSchema>;
type AskJevOutput = Record<string, AnswerOutput>;

const UNANSWERED: AnswerOutput = {
  answered: false,
  answer: null,
  confident: false,
  confidence: null,
  score: null,
  text: null,
};

/** Output schema keyed by the configured question keys, so later steps can reference each answer. */
export function buildAskJevOutputSchema(config: unknown): z.ZodTypeAny {
  const questions = (config as { questions?: unknown } | null)?.questions;
  const keys = Array.isArray(questions)
    ? questions
        .map(question => (question as { key?: unknown } | null)?.key)
        .filter((key): key is string => typeof key === 'string' && QUESTION_KEY.test(key))
    : [];
  return z.object(Object.fromEntries(keys.map(key => [key, AnswerOutputSchema])));
}

/** Config mistakes the schema can't express; caught here so the run fails with a clear reason. */
function assertQuestionsUsable(questions: QuestionConfig[]): void {
  const seen = new Set<string>();
  for (const question of questions) {
    if (seen.has(question.key)) throw new Error(`Two questions use the key "${question.key}"`);
    seen.add(question.key);
    if (question.type === 'choice' && !question.options?.length) {
      throw new Error(`Question "${question.key}" is a choice question with no options`);
    }
    if (question.type === 'score' && (question.levels?.length ?? 0) < 2) {
      throw new Error(`Question "${question.key}" is a score question with fewer than 2 levels`);
    }
  }
}

const shuffle = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

function toJevQuestion(question: QuestionConfig, options: OptionConfig[]): JevQuestion {
  if (question.type === 'yes_no') return { type: 'noul', instructions: question.question };
  if (question.type === 'score') {
    return { type: 'score', instructions: question.question, criteria: question.levels ?? [] };
  }
  // Keyed by position, not the user's value, so any value is safe; shuffled against position bias.
  return {
    type: 'choice',
    instructions: question.question,
    criteria: Object.fromEntries(
      shuffle(options.map((option, index): [string, string] => [`o${index}`, option.description])),
    ),
  };
}

function toOutput(
  question: QuestionConfig,
  options: OptionConfig[],
  answer: JevAnswer | undefined,
): AnswerOutput {
  if (!answer) return UNANSWERED;

  if (answer.type === 'noul') {
    return {
      ...UNANSWERED,
      answered: true,
      answer: answer.noul >= question.threshold,
      confident: true,
      confidence: answer.noul,
      score: answer.noul,
    };
  }

  const confidence = answer.confidence ?? null;
  const confident = confidence !== null && confidence >= question.threshold;

  if (answer.type === 'score') {
    return {
      ...UNANSWERED,
      answered: true,
      answer: confident ? (question.levels?.[answer.level] ?? null) : null,
      confident,
      confidence,
      score: answer.score,
    };
  }

  // askJev only returns a choice that is one of our keys, so the index is valid.
  const option = options[Number(answer.choice.slice(1))]!;
  return {
    ...UNANSWERED,
    answered: true,
    answer: confident ? option.value : null,
    confident,
    confidence,
    text: confident ? (option.text ?? null) : null,
  };
}

export class AskJevStep extends BaseActionStep<typeof AskJevConfigSchema, AskJevOutput> {
  readonly type = 'ASK_JEV';
  readonly configSchema = AskJevConfigSchema;
  readonly outputSchema = z.record(AnswerOutputSchema);
  readonly name = 'Ask Jev';
  readonly description =
    'Asks Jev yes/no, choice or score questions about a text, all in one call. Each answer is under its question key; a choice option can carry text such as a reply.';
  readonly category = StepCategory.AI;
  readonly icon = 'Sparkles';

  async execute(config: z.infer<typeof AskJevConfigSchema>): Promise<AskJevOutput> {
    const questions = config.questions;
    assertQuestionsUsable(questions);

    const asked: Record<string, JevQuestion> = Object.fromEntries(
      questions.map(question => [question.key, toJevQuestion(question, question.options ?? [])]),
    );

    const text = config.text.trim();
    const answers =
      text
        ? // Independent questions: an unusable answer to one must not discard the others.
          await askJev(text, asked, JEV_TIMEOUT_MS, undefined, { partial: true })
        : null;

    const output: AskJevOutput = {};
    for (const question of questions) {
      output[question.key] = toOutput(question, question.options ?? [], answers?.[question.key]);
    }

    logger.info('[automations] ASK_JEV answered', {
      answers: Object.fromEntries(
        Object.entries(output).map(([key, value]) => [
          key,
          { answered: value.answered, confident: value.confident, confidence: value.confidence },
        ]),
      ),
    });
    return output;
  }
}

export const askJevStep = new AskJevStep();
