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

/** A step's target: a channel or thread that was found, or what an earlier step produced. */
type Target = Extract<Operation, { op: 'navigate' }>['target'];

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

/** One step as the user sees it while the plan runs. */
export interface PlanStep {
  label: string;
  status: 'waiting' | 'running' | 'done' | 'failed';
}

/** Runs the plan, reporting every step's status to `onProgress` as it changes. */
export async function runPlan(
  plan: Plan,
  actions: AppActions,
  onProgress: (steps: PlanStep[]) => void = () => undefined,
): Promise<OperationResult[]> {
  const labels = plan.map(step => stepLabels(step, plan));
  let steps: PlanStep[] = labels.map(({ doing }) => ({ label: doing, status: 'waiting' }));
  const show = (index: number, status: PlanStep['status']): void => {
    const { doing, done } = labels[index] ?? { doing: '', done: '' };
    steps = steps.map((step, at) =>
      at === index ? { label: status === 'done' ? done : doing, status } : step,
    );
    onProgress(steps);
  };
  onProgress(steps);

  const results: OperationResult[] = [];
  for (const [index, step] of plan.entries()) {
    show(index, 'running');
    try {
      const produced = await runStep(step, results, actions);
      results.push(produced ? { ok: true, produced } : { ok: true });
      show(index, 'done');
    } catch (error) {
      results.push({ ok: false, error: getApiErrorMessage(error, 'something went wrong') });
      show(index, 'failed');
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
function conversationOf(target: Target, earlier: readonly OperationResult[]): Conversation {
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

const MAX_QUOTED = 40;

/** What a step says while it runs, and once it is done. */
function stepLabels(step: Operation, plan: Plan): { doing: string; done: string } {
  switch (step.op) {
    case 'open_or_create_dm':
      return {
        doing: `Finding your DM with ${step.user.name}`,
        done: `Found your DM with ${step.user.name}`,
      };
    case 'create_channel': {
      const withMembers = step.members.length
        ? ` with ${step.members.map(member => member.name).join(', ')}`
        : '';
      return {
        doing: `Creating “${step.name}”${withMembers}`,
        done: `Created “${step.name}”${withMembers}`,
      };
    }
    case 'navigate': {
      const place = placeOf(step.target, plan);
      return { doing: `Opening ${place}`, done: `Opened ${place}` };
    }
    case 'send_message': {
      const text =
        step.text.length > MAX_QUOTED ? `${step.text.slice(0, MAX_QUOTED - 1)}…` : step.text;
      return { doing: `Sending “${text}”`, done: `Sent “${text}”` };
    }
  }
}

function placeOf(target: Target, plan: Plan): string {
  if ('fromStep' in target) {
    const origin = plan[target.fromStep];
    if (origin?.op === 'open_or_create_dm') return `your DM with ${origin.user.name}`;
    if (origin?.op === 'create_channel') return `“${origin.name}”`;
    return 'it';
  }
  return target.kind === 'thread' ? 'the thread' : `#${target.name}`;
}
