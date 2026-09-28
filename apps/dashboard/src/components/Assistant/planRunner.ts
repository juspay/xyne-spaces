import type {
  ChannelRef,
  Operation,
  OperationResult,
  PersonRef,
  Plan,
} from '@xyne/shared/assistant';
import { getApiErrorMessage } from '../../utils/apiError';

/**
 * Runs a plan from the assistant, step by step, with the user's own session. Each step is one
 * of the app's existing actions, supplied as `AppActions`, so the assistant can do nothing
 * the user could not do by hand.
 *
 * It stops at the first failure: later steps depend on earlier ones ("send in the DM that step
 * 0 opened"). The results go back to the backend, which turns them into the reply.
 */

export interface NewChannel {
  name: string;
  visibility: 'public' | 'private';
  members: PersonRef[];
}

/** Where a step acts: a channel or DM, or a thread inside one. */
export interface Conversation {
  channelId: string;
  threadId?: string;
}

export interface AppActions {
  /** The DM with this person, created if there is none, and reopened if it was closed. */
  openOrCreateDm(user: PersonRef): Promise<ChannelRef>;
  createChannel(channel: NewChannel): Promise<ChannelRef>;
  /** A new top-level message, @mentioning `mentions` first. Resolves once the server has it. */
  sendMessage(channelId: string, text: string, mentions: readonly PersonRef[]): Promise<void>;
  navigate(to: Conversation): void;
}

export async function runPlan(plan: Plan, actions: AppActions): Promise<OperationResult[]> {
  const results: OperationResult[] = [];
  for (const step of plan) {
    try {
      const produced = await runStep(step, results, actions);
      results.push(produced ? { ok: true, produced } : { ok: true });
    } catch (error) {
      results.push({ ok: false, error: getApiErrorMessage(error, 'something went wrong') });
      break;
    }
  }
  return results;
}

async function runStep(
  step: Operation,
  earlier: readonly OperationResult[],
  actions: AppActions,
): Promise<ChannelRef | undefined> {
  switch (step.op) {
    case 'open_or_create_dm':
      return actions.openOrCreateDm(step.user);
    case 'create_channel':
      return actions.createChannel({
        name: step.name,
        visibility: step.visibility,
        members: step.members,
      });
    case 'send_message': {
      const { channelId, threadId } = conversationOf(step.target, earlier);
      if (threadId) throw new Error('replies in a thread aren’t supported yet');
      await actions.sendMessage(channelId, step.text, step.mentions ?? []);
      return undefined;
    }
    case 'navigate':
      actions.navigate(conversationOf(step.target, earlier));
      return undefined;
  }
}

/** Where a step acts: a channel or thread that was found, or what an earlier step produced. */
function conversationOf(
  target: Extract<Operation, { op: 'navigate' }>['target'],
  earlier: readonly OperationResult[],
): Conversation {
  if ('fromStep' in target) {
    const produced = earlier[target.fromStep]?.produced;
    if (produced?.kind !== 'channel') {
      throw new Error(`step ${target.fromStep} did not open a conversation`);
    }
    return { channelId: produced.id };
  }
  return target.kind === 'thread'
    ? { channelId: target.channelId, threadId: target.id }
    : { channelId: target.id };
}
