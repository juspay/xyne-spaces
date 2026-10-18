import type { JevAnswer, JevQuestion } from '@/services/queryIntent/jevClient';
import type { EmailMetadata } from '@/types/classification';

export const DECISION_ENGINES = ['xor', 'jev', 'llm'] as const;
export type DecisionEngine = (typeof DECISION_ENGINES)[number];
export type ClassifierEngine = Exclude<DecisionEngine, 'llm'>;

/** Decided through `decide()`, with an LLM prompt of their own and a ground truth to settle against. */
export type TaskFeature = 'email_category' | 'email_priority';

/** Typed questions answered by the configured engine through `askDecision()`; evaluated by agreement only. */
export type QuestionFeature =
  | 'search_intent'
  | 'related_context_gate'
  | 'related_context_verdict'
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
  confidence?: number;
  error?: unknown;
}

export interface LlmReply<T> {
  answer: T | null;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** One engine's answer as compared with the others'. */
export interface ComparedAnswer {
  engine: DecisionEngine;
  /** Null when the engine gave no answer. */
  label: string | null;
  confidence?: number;
}

/** What XOR and Jev are asked: the same content the LLM gets, as typed questions. */
export interface DecisionQuestion {
  state: string;
  questions: Record<string, JevQuestion>;
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
  question: DecisionQuestion | null;
  readAnswers(answers: Record<string, JevAnswer>, engine: ClassifierEngine): T | null;
  askLlm(): Promise<LlmReply<T>>;
  toLabel(answer: T): string;
}
