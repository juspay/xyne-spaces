/**
 * Ask-question card — renders an agent's question as a FlowUI v2.0
 * `ask_question` component (dashboard: components/flowUI/nodes/AskQuestionNode.tsx).
 *
 * Lifecycle is phase-discriminated:
 *   pending  → interactive: user picks one option, then submits.
 *   answered → read-only outcome showing the selected answer.
 *
 * Post once via Spaces postMessage({ flow }), then re-render IN PLACE via
 * updateMessage({ flowJSON }) as the phase changes (same screenId
 * `agent-question` + same component id `ask-question` → the card updates without
 * a new message). Source-of-truth schema + zod validation lives in
 * @xyne/shared: shared/src/validation/flowSchema.ts (`askQuestionComponentSchema`).
 */

import { FlowBuilder, type FlowComponent, type FlowDefinition } from './builder.js';

/** Stable component id — the state.values key AskQuestionNode reads/writes and
 *  the key flow-action.ts reads the user's selection from. */
export const ASK_QUESTION_COMPONENT_ID = 'ask-question';

/** Phase of the ask-question card — picks the component layout. */
export type AskQuestionPhase = 'pending' | 'answered';

export interface AskQuestionContext {
  questionId: string;
  agentSlug: string;
  channelId: string;
  conversationId: string;
  userId: string;
  spacesAppId?: string | undefined;
}

/**
 * Build the ask-question card as a single `ask_question` component.
 * `opts.context` carries flow-level routing (actionType 'user-answer' +
 * questionId/agentSlug/conversationId/channelId/userId/spacesAppId) that
 * flow-action.ts reads on submit.
 */
export function buildAskQuestionFlow(
  question: string,
  options: string[],
  context: AskQuestionContext,
  opts?: {
    phase?: AskQuestionPhase;
    answer?: string;
    answeredBy?: string;
    answeredAt?: string;
    screenId?: string;
  },
): FlowDefinition {
  const phase: AskQuestionPhase = opts?.phase ?? 'pending';
  const screenId = opts?.screenId ?? `agent-question-${context.questionId}`;

  const props: Record<string, unknown> =
    phase === 'pending'
      ? {
          phase: 'pending',
          question,
          options,
        }
      : {
          phase: 'answered',
          question,
          answer: opts?.answer ?? '',
          ...(opts?.answeredBy ? { answeredBy: opts.answeredBy } : {}),
          ...(opts?.answeredAt ? { answeredAt: opts.answeredAt } : {}),
        };

  const component: FlowComponent = {
    id: ASK_QUESTION_COMPONENT_ID,
    type: 'ask_question',
    props,
  };

  return new FlowBuilder(screenId)
    .setTitle('Question')
    .addComponent(component)
    .setData({
      actionType: 'user-answer',
      questionId: context.questionId,
      agentSlug: context.agentSlug,
      channelId: context.channelId,
      conversationId: context.conversationId,
      userId: context.userId,
      ...(context.spacesAppId ? { spacesAppId: context.spacesAppId } : {}),
    })
    .build();
}
