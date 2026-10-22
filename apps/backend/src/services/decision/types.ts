import type { EmailMetadata } from '@/types/classification';

/** A yes/no question. */
export interface YesNoQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true?: string; false?: string };
}

/** Pick one of up to 255 options, each keyed by id and described in plain words. */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

/** Where the state falls on ordered levels, lowest first (`criteria[0]` is the lowest). */
export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

/** A typed question any engine answers: yes/no, choice, or score. */
export type DecisionQuestion = YesNoQuestion | ChoiceQuestion | ScoreQuestion;

/** An engine's answer to a DecisionQuestion, in the same shape whichever engine gave it. */
export type DecisionAnswer =
  | { type: 'noul'; noul: number }
  | {
      type: 'choice';
      choice: string;
      /** Probability per option id. */
      probabilities: Record<string, number>;
      /** The engine's confidence in `choice`, when it gave one. */
      confidence?: number;
    }
  | {
      type: 'score';
      /** 0 at the lowest level, 1 at the highest. */
      score: number;
      /** Index into `criteria` of the most likely level. */
      level: number;
      /** The engine's confidence in `level`, when it gave one. */
      confidence?: number;
    };

/** Where a classifier request goes. */
export interface ClassifierTarget {
  url: string;
  apiKey: string;
  model: string;
}

/** Why an engine came back empty; a caller cancelling it is not a failure. */
export type AskFailure =
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'status'; status: number }
  | { kind: 'unusable' };

export const DECISION_ENGINES = ['xor', 'jev', 'llm'] as const;
export type DecisionEngine = (typeof DECISION_ENGINES)[number];
/** The engines that take typed questions over the Jev wire format. */
export type ClassifierEngine = Exclude<DecisionEngine, 'llm'>;

/** Decided through `decide()`: the feature's own LLM prompt, or the configured engine when its CAC switch is on. */
export type TaskFeature = 'email_category' | 'email_priority';

/** Typed questions answered by the configured engine through `askDecision()`. */
export type QuestionFeature =
  | 'search_intent'
  | 'related_context_gate'
  | 'related_context_verdict'
  | 'discussion_title'
  | 'assistant_route'
  | 'ticket_duplicate'
  | 'desk_tags'
  | 'radar_dedup'
  | 'automation_step'
  | 'summary_template'
  | 'ticket_fields';

export type DecisionFeature = TaskFeature | QuestionFeature;

/**
 * answered: a usable answer. abstained: a reply without one. failed: no reply (timeout,
 * network, error status, LLM threw). unavailable: not configured, or the task can't be put to it.
 */
export type RunOutcome = 'answered' | 'abstained' | 'failed' | 'unavailable';

export interface EngineRun<T> {
  engine: DecisionEngine;
  outcome: RunOutcome;
  answer: T | null;
  latencyMs: number;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** How sure a classifier engine was, 0.5 to 1; the LLM gives none. */
  confidence?: number;
  /** What the LLM threw; rethrown when it was the live answer. Never persisted. */
  error?: unknown;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmReply<T> {
  answer: T | null;
  model: string;
  usage?: TokenUsage;
}

/** One engine's answer as compared with the others'. */
export interface ComparedAnswer {
  engine: DecisionEngine;
  /** Null when the engine gave no answer. */
  label: string | null;
  confidence?: number;
  model?: string;
}

/** What XOR and Jev are asked: the same content the LLM gets, as typed questions. */
export interface TaskQuestion {
  state: string;
  questions: Record<string, DecisionQuestion>;
}

/** What the evaluation worker rebuilds a task from. It goes through Redis, so plain data only. */
export interface TaskInput {
  channelId: string;
  emailSubject: string;
  emailBody: string;
  emailMetadata?: EmailMetadata;
  modelName: string;
}

/** One decision, described once so every engine gets exactly the same input. */
export interface DecisionTask<T> {
  feature: TaskFeature;
  input: TaskInput;
  /** Null when the task can't be put as typed questions; the task's own LLM still answers live. */
  question: TaskQuestion | null;
  readAnswers(answers: Record<string, DecisionAnswer>, engine: DecisionEngine): T | null;
  /** May throw; the throw is the run's failure. */
  askLlm(): Promise<LlmReply<T>>;
  /** Stable form of an answer, compared across engines and with the human's. */
  toLabel(answer: T): string;
}
