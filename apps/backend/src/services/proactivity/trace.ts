import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { askDecision } from '@/services/decision/ask';
import type { DecisionQuestion } from '@/services/decision/types';
import type { XorClient } from './policy';

/** One XOR request as it was made: kept so a message's whole journey can be traced. */
export interface XorCall {
  state: string | Record<string, unknown>;
  questions: Record<string, DecisionQuestion>;
  /** Probability of yes per question key; empty when XOR did not answer. */
  probabilities: Record<string, number>;
  durationMs: number;
  failed: boolean;
}

export type XorStep = 'gate' | 'bump_gate' | 'route' | 'before_posting' | 'follow_up';

/** An XOR client that remembers each request, for the policy to ask through. */
export class XorRecorder {
  private calls: XorCall[] = [];

  readonly client: XorClient = async (state, questions, timeoutMs) => {
    const started = Date.now();
    const answers = await askDecision('agent_proactivity', state, questions, timeoutMs);
    const probabilities: Record<string, number> = {};
    for (const [key, answer] of Object.entries(answers ?? {})) {
      if (answer?.type === 'noul') probabilities[key] = answer.noul;
      if (answer?.type === 'choice') {
        for (const [option, p] of Object.entries(answer.probabilities)) {
          probabilities[`${key}_${option}`] = p;
        }
      }
    }
    this.calls.push({
      state,
      questions,
      probabilities,
      durationMs: Date.now() - started,
      failed: answers === null,
    });
    return answers;
  };

  /** The requests made since the last take. */
  take(): XorCall[] {
    return this.calls.splice(0);
  }
}

/** What XOR read, as text: the conversation, or each part of it by name. */
const inputText = (state: XorCall['state']): string =>
  typeof state === 'string'
    ? state
    : Object.entries(state)
        .map(
          ([name, value]) =>
            `${name}:\n${typeof value === 'string' ? value : JSON.stringify(value)}`
        )
        .join('\n\n');

/** Store a step's XOR requests against its decision. Never fails the decision. */
export async function saveXorCalls(
  decision: { id: string; workspaceId: string; channelId: string },
  step: XorStep,
  calls: XorCall[],
  agentSlug?: string
): Promise<void> {
  for (const call of calls) {
    try {
      const row = await db.agentProactivityXorCall.create({
        data: {
          workspaceId: decision.workspaceId,
          decisionId: decision.id,
          channelId: decision.channelId,
          step,
          ...(agentSlug ? { agentSlug } : {}),
          input: inputText(call.state),
          durationMs: call.durationMs,
          failed: call.failed,
        },
        select: { id: true },
      });
      await db.agentProactivityXorQuestion.createMany({
        data: Object.entries(call.questions).flatMap(([key, question]) =>
          // A choice is saved as a row per option, its text quoted as a yes/no's would be.
          (question.type === 'choice'
            ? Object.entries(question.criteria).map(([option, text]) => ({
                key: `${key}_${option}`,
                instructions: `${question.instructions}\n"""\n${text}\n"""`,
              }))
            : [{ key, instructions: question.instructions }]
          ).map((q) => ({
            workspaceId: decision.workspaceId,
            callId: row.id,
            channelId: decision.channelId,
            ...q,
            criteriaTrue: question.type === 'noul' ? (question.criteria?.true ?? null) : null,
            criteriaFalse: question.type === 'noul' ? (question.criteria?.false ?? null) : null,
            probability: call.probabilities[q.key] ?? null,
          }))
        ),
      });
    } catch (error) {
      logger.warn('[Proactivity] could not save an XOR call for tracing', {
        decisionId: decision.id,
        step,
        error,
      });
    }
  }
}
