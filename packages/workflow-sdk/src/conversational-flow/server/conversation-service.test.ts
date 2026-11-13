/**
 * Conversations driven end to end through a real runtime: in-memory persistence
 * and event bus, a background "worker" that picks jobs off the queue as the
 * host's would, and a stand-in for the host's agent step behind the AI router.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { WorkflowRuntime } from '../../runtime/workflow-runtime.js';
import { WorkflowExecutor } from '../../engine/workflow-executor.js';
import { ServiceRegistry } from '../../engine/service-registry.js';
import { InMemoryPersistenceAdapter } from '../../persistence/in-memory-adapter.js';
import { InMemoryEventBus } from '../../events/in-memory-adapter.js';
import { executionTopic } from '../../events/types.js';
import { AllowAllAuthorizer } from '../../authz/default.js';
import { SYSTEM } from '../../authz/types.js';
import { HostAgentStep } from '../../agents/host-agent-step.js';
import { BaseAgentProvider, type AgentRunEvent, type AgentRunInput } from '../../agents/provider.js';
import { testRegistry } from '../../testing/test-connector.js';
import { createWorkflowRouter } from '../../router/workflow-router.js';
import type { QueueAdapter, SchedulerAdapter } from '../../persistence/types.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { createConversationalFlow } from '../create.js';
import { addOption } from '../edit/options.js';
import { setEndMessage } from '../edit/endings.js';
import { setAbout, setPromptSays, setTypingAllowed } from '../edit/prompts.js';
import { scopeRouter } from '../edit/routers.js';
import type { StartConversation } from './conversation-service.js';
import type { Turn } from '../turn.js';
import { addScreen } from '../edit/screens.js';
import { TurnAnswerError, readTranscript, readTurn, streamEventOf, type ConversationStreamEvent, type Turn } from '../turn.js';
import { readConversationalFlow } from '../read.js';
import { ConversationConflictError, ConversationService } from './conversation-service.js';
import { ApprovalRequirement } from '../../types/approval.js';

/**
 * The host's agent, behind the real host agent step: routes typed text (JSON,
 * checked against the router's schema), and answers Ask AI questions saying
 * which turn of the conversation it is on.
 */
class FakeAgents extends BaseAgentProvider<typeof FakeAgentConfig> {
  readonly name = 'Fake agents';
  readonly configSchema = FakeAgentConfig;
  async *run(_config: z.infer<typeof FakeAgentConfig>, input: AgentRunInput): AsyncIterable<AgentRunEvent> {
    const done = (text: string): AgentRunEvent => ({ type: 'done', result: { text, toolCalls: [], turnCount: 1, usage: { inputTokens: 0, outputTokens: 0 } } });
    if (input.conversation) {
      const asked = input.conversation.turn === 0 ? (/Their question: (.*)$/.exec(input.task)?.[1] ?? '') : input.task;
      yield done(`(${String(input.conversation.turn)}) about “${asked}”`);
      return;
    }
    const typed = /typed: "(.*)"/.exec(input.task)?.[1] ?? '';
    yield done(
      /pay|charge/i.test(typed)
        ? JSON.stringify({ screen: 'payments', reason: 'They mention a charge.' })
        : /person|human/i.test(typed)
          ? JSON.stringify({ screen: 'talk_to_a_person', reason: 'They ask for a person.' })
          : JSON.stringify({ screen: 'start', reason: 'Nothing specific.' }),
    );
  }
}
const FakeAgentConfig = z.object({ agentSlug: z.string() });

/** Start → Payments (a message) → Finish; plus a Menu with a screen beneath it. */
function supportFlow(): WorkflowConfig {
  let { config } = createConversationalFlow({ agentSlug: 'router', greeting: 'Hi! How can I help?' });
  config = addScreen(config, { title: 'Payments', parent: 'start', type: 'message' }).config;
  config = setPromptSays(config, 'ask_payments', ['Refunds take 5–7 days.']);
  const report = addScreen(config, { title: 'Report a trip', parent: 'start', type: 'menu' });
  config = report.config;
  const follow = addScreen(config, { title: 'Unsafe driving', parent: report.screenId });
  config = setPromptSays(follow.config, `ask_${follow.screenId}`, ['When did it happen?']);
  return config;
}

/**
 * A persistence adapter whose writes cost something, as a real database's do.
 *
 * The in-memory adapter finishes a write in the same tick, which hides every gap
 * between an event and the row it announces — so a waiter that sleeps out its
 * backstop on every turn still looks instant here. One test buys the latency
 * back; the rest stay fast.
 */
function withWriteLatency(inner: InMemoryPersistenceAdapter, ms: number): InMemoryPersistenceAdapter {
  const costly = new Set(['createExecution', 'updateExecutionStatus', 'persistState', 'upsertStep']);
  return new Proxy(inner, {
    get(target, key) {
      const value = (target as unknown as Record<string, unknown>)[key as string];
      if (typeof value !== 'function' || !costly.has(String(key))) return value;
      return async (...args: unknown[]) => {
        const out: unknown = await (value as (...a: unknown[]) => unknown).apply(target, args);
        await new Promise((resolve) => setTimeout(resolve, ms));
        return out;
      };
    },
  });
}

function harness(opts: { writeLatencyMs?: number } = {}) {
  const persistence = opts.writeLatencyMs
    ? withWriteLatency(new InMemoryPersistenceAdapter(), opts.writeLatencyMs)
    : new InMemoryPersistenceAdapter();
  const eventBus = new InMemoryEventBus();
  const connectors = testRegistry({ steps: [new HostAgentStep(new FakeAgents(), { type: 'RUN_AGENT' })] });
  const services = new ServiceRegistry();
  const executor = new WorkflowExecutor(persistence, connectors, services, { eventBus });
  let runtime: WorkflowRuntime;
  // One job at a time per run, a moment after it is queued — as a worker would.
  let work = Promise.resolve();
  let paused = false;
  const queue: QueueAdapter = {
    async enqueue({ executionId }) {
      if (paused) return;
      setTimeout(() => {
        work = work.then(() => runtime.processJob(executionId).then(() => undefined)).catch(() => undefined);
      }, 0);
    },
  };
  const scheduler: SchedulerAdapter = { async schedule() {}, async unschedule() {} };
  runtime = new WorkflowRuntime({
    persistence,
    authorizer: new AllowAllAuthorizer(),
    queue,
    scheduler,
    services,
    connectors,
    executor,
    eventBus,
    config: {
      baseUrl: 'https://api.example.com',
      approval: { default: ApprovalRequirement.NOT_REQUIRED },
    },
  });
  return {
    runtime,
    eventBus,
    conversations: new ConversationService(runtime),
    /** Stop the worker: replies are accepted but not applied. */
    pauseWorker: () => {
      paused = true;
    },
  };
}

async function flowWorkflow(runtime: WorkflowRuntime): Promise<string> {
  const folder = await runtime.createFolder(SYSTEM, { name: 'Flows' });
  const wf = await runtime.createWorkflow(SYSTEM, { name: 'Support', config: supportFlow(), folderId: folder.id });
  return wf.id;
}

const WAIT = 5_000;

/**
 * Start, and take the first turn — which carries the conversation's id, so
 * nothing here has to hold both.
 */
const opened = async (h: ReturnType<typeof harness>, input: StartConversation): Promise<Turn> =>
  (await h.conversations.start(SYSTEM, input, WAIT)).turn;

/** Open, then say something: what used to be `text` on start, in its two honest halves. */
const startedBySaying = async (h: ReturnType<typeof harness>, workflowId: string, text: string): Promise<Turn> => {
  const first = await opened(h, { workflowId });
  return h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, text }, WAIT);
};

describe('ConversationService', () => {
  let h: ReturnType<typeof harness>;
  let workflowId: string;

  beforeEach(async () => {
    h = harness();
    workflowId = await flowWorkflow(h.runtime);
  });

  /** Open with a message: start, then answer the first turn as typed text. */
  const said = async (text: string): Promise<Turn> => {
    const first = await opened(h, { workflowId });
    return h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, text }, WAIT);
  };

  it('starts on the first screen: what it says, what can be tapped, that typing is allowed', async () => {
    const turn = await opened(h, { workflowId });
    expect(turn.status).toBe('awaiting_reply');
    expect(turn.turnId).toMatch(/ask_start$/);
    expect(turn.screen).toEqual({ id: 'start', title: 'Start', kind: 'menu', path: ['Start'] });
    expect(turn.messages).toEqual([{ role: 'assistant', source: 'flow', text: 'Hi! How can I help?', header: 'Start' }]);
    expect(turn.reply?.options).toEqual([
      { id: 'payments', label: 'Payments', kind: 'next' },
      { id: 'report_a_trip', label: 'Report a trip', kind: 'next' },
    ]);
    expect(turn.reply?.text.allowed).toBe(true);
    expect(turn.events).toEqual([]);
  });

  it('follows a tap to the next screen and says what was tapped; back and finish are marked', async () => {
    const first = await opened(h, { workflowId });
    const next = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'payments' }, WAIT);
    expect(next.screen).toMatchObject({ id: 'payments', path: ['Start', 'Payments'] });
    expect(next.events).toEqual([{ type: 'tapped', optionId: 'payments', label: 'Payments' }]);
    expect(next.reply?.options.map((o) => [o.id, o.kind])).toEqual([
      ['start', 'back'],
      ['done', 'finish'],
    ]);
  });

  it('finishes with the outcome the flow carried', async () => {
    const first = await opened(h, { workflowId });
    const payments = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'payments' }, WAIT);
    const done = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: payments.turnId!, choice: 'done' }, WAIT);
    expect(done).toMatchObject({ status: 'finished', turnId: null, outcome: { outcome: 'done' } });
    expect(done.events).toEqual([{ type: 'tapped', optionId: 'done', label: 'That’s all' }]);
  });

  it('routes an opening message through the AI router, and says where and why', async () => {
    const turn = await said('I was charged twice');
    expect(turn.screen?.id).toBe('payments');
    expect(turn.events).toEqual([
      { type: 'typed', text: 'I was charged twice' },
      { type: 'routed', to: 'payments', title: 'Payments', reason: 'They mention a charge.', by: 'AI router' },
    ]);
  });

  it('follows an answer onto the screen it opens', async () => {
    const first = await opened(h, { workflowId });
    const q1 = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'report_a_trip' }, WAIT);
    expect(q1.screen).toMatchObject({ id: 'report_a_trip' });
    const q2 = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: q1.turnId!, choice: 'unsafe_driving' }, WAIT);
    expect(q2).toMatchObject({ screen: { id: 'unsafe_driving' }, messages: [{ text: 'When did it happen?' }] });
    expect(q2.events).toEqual([{ type: 'tapped', optionId: 'unsafe_driving', label: 'Unsafe driving' }]);
  });

  it('treats the same answer sent again as a retry, and a different one as a conflict', async () => {
    const first = await opened(h, { workflowId });
    const answer = { turnId: first.turnId!, choice: 'payments' };
    const next = await h.conversations.answer(SYSTEM, first.conversationId, answer, WAIT);
    const again = await h.conversations.answer(SYSTEM, first.conversationId, answer, WAIT);
    expect(again.turnId).toBe(next.turnId);

    const late = h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'report_a_trip' }, WAIT);
    await expect(late).rejects.toBeInstanceOf(ConversationConflictError);
    await expect(late).rejects.toMatchObject({ turn: { turnId: next.turnId } });
  });

  it('refuses an answer the turn does not offer', async () => {
    const first = await opened(h, { workflowId });
    await expect(h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'nowhere' }, WAIT)).rejects.toBeInstanceOf(TurnAnswerError);
    await expect(h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId! }, WAIT)).rejects.toBeInstanceOf(TurnAnswerError);
  });

  it('answers `working` when the next turn is not ready in time, then shows it once it is', async () => {
    const first = await opened(h, { workflowId });
    h.pauseWorker();
    const pending = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'payments' }, 50);
    expect(pending).toMatchObject({ status: 'working', turnId: null, retryAfterMs: 1000 });
    expect(pending.events).toEqual([{ type: 'tapped', optionId: 'payments', label: 'Payments' }]);
    // The reply is recorded, so asking again with it is still a retry, not a conflict.
    const retried = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'payments' }, 50);
    expect(retried.status).toBe('working');
  });

  it('ends a conversation on request', async () => {
    const first = await opened(h, { workflowId });
    const ended = await h.conversations.end(SYSTEM, first.conversationId);
    expect(ended).toMatchObject({ status: 'ended', turnId: null });
  });

  it('keeps a transcript of what was asked and answered', async () => {
    const first = await opened(h, { workflowId });
    await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'payments' }, WAIT);
    const transcript = await h.conversations.transcript(SYSTEM, first.conversationId);
    expect(transcript.entries).toEqual([
      { type: 'asked', turnId: first.turnId, text: 'Hi! How can I help?', screen: 'start' },
      { type: 'tapped', optionId: 'payments', label: 'Payments' },
      { type: 'asked', turnId: expect.stringMatching(/ask_payments$/), text: 'Refunds take 5–7 days.', screen: 'payments' },
    ]);
  });

  it('rebuilds the order of the conversation when storage returns records in any order', async () => {
    const turn = await said('I was charged twice');
    const detail = (await h.runtime.getExecutionDetail(SYSTEM, turn.conversationId))!;
    const run = { id: detail.execution.id, status: detail.execution.status, steps: detail.steps, config: detail.config };
    const shuffled = { ...run, steps: [...run.steps].reverse() };
    expect(readTranscript(shuffled)).toEqual(readTranscript(run));
    expect(readTurn(shuffled).events).toEqual([
      { type: 'typed', text: 'I was charged twice' },
      { type: 'routed', to: 'payments', title: 'Payments', reason: 'They mention a charge.', by: 'AI router' },
    ]);
    expect(readTranscript(shuffled).entries.map((e) => e.type)).toEqual(['asked', 'typed', 'routed', 'asked']);
  });

  it('records where the run came from on the run itself', async () => {
    const first = await opened(h, { workflowId, context: { merchantId: 'm_1', user: 'u_1' } });
    const detail = await h.runtime.getExecutionDetail(SYSTEM, first.conversationId);
    // Exactly what a manual trigger would have carried — nothing added on the way.
    expect(detail?.triggerData).toMatchObject({ context: { merchantId: 'm_1', user: 'u_1' } });
    // …and nothing this layer invented on the way through.
    expect(Object.keys(detail?.triggerData as object).sort()).toEqual(['context', 'type']);
  });
});

describe('Ask AI', () => {
  async function askAiWorkflow(runtime: WorkflowRuntime): Promise<string> {
    const { config } = addScreen(supportFlow(), { title: 'Ask about payments', parent: 'start', type: 'ask-ai' });
    const folder = await runtime.createFolder(SYSTEM, { name: 'Flows' });
    return (await runtime.createWorkflow(SYSTEM, { name: 'Support', config, folderId: folder.id })).id;
  }

  it('asks, answers, continues the same conversation with a reply, and leaves by a way out', async () => {
    const h = harness();
    const workflowId = await askAiWorkflow(h.runtime);
    const first = await opened(h, { workflowId });
    const intro = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'ask_about_payments' }, WAIT);
    expect(intro).toMatchObject({ screen: { id: 'ask_about_payments', kind: 'ask-ai' }, messages: [{ source: 'flow', text: 'Ask me anything about ask about payments.' }] });
    expect(intro.reply?.options).toEqual([{ id: 'start', label: 'Start', kind: 'back' }]);

    const answered = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: intro.turnId!, text: 'How do refunds work?' }, WAIT);
    expect(answered.turnId).toMatch(/ai_ask_about_payments#t0$/);
    expect(answered.messages).toEqual([{ role: 'assistant', source: 'agent', text: '(0) about “How do refunds work?”' }]);
    expect(answered.events).toEqual([{ type: 'typed', text: 'How do refunds work?' }]);
    expect(answered.reply).toMatchObject({ options: [{ id: 'start', label: 'Start', kind: 'back' }], text: { allowed: true, label: 'Ask something else' } });

    const followUp = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: answered.turnId!, text: 'And for a cancelled trip?' }, WAIT);
    expect(followUp.turnId).toMatch(/ai_ask_about_payments#t1$/);
    expect(followUp.messages[0]!.text).toBe('(1) about “And for a cancelled trip?”');
    expect(followUp.events).toEqual([{ type: 'typed', text: 'And for a cancelled trip?' }]);

    // Sending that reply again is a retry, not a new question; a different one to the old turn is a conflict.
    const again = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: answered.turnId!, text: 'And for a cancelled trip?' }, WAIT);
    expect(again.turnId).toBe(followUp.turnId);
    await expect(h.conversations.answer(SYSTEM, first.conversationId, { turnId: answered.turnId!, text: 'Something else' }, WAIT)).rejects.toBeInstanceOf(ConversationConflictError);

    const left = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: followUp.turnId!, choice: 'start' }, WAIT);
    expect(left.screen?.id).toBe('start');
    expect(left.events).toEqual([{ type: 'tapped', optionId: 'start', label: 'Start' }]);

    const transcript = await h.conversations.transcript(SYSTEM, first.conversationId);
    expect(transcript.entries.map((e) => (e.type === 'asked' ? `asked:${e.text}` : e.type === 'typed' ? `typed:${e.text}` : e.type === 'tapped' ? `tapped:${e.label}` : e.type))).toEqual([
      'asked:Hi! How can I help?',
      'tapped:Ask about payments',
      'asked:Ask me anything about ask about payments.',
      'typed:How do refunds work?',
      // Once the conversation ends the step keeps only its output — the last
      // answer and the choice; earlier turns live in the agent's conversation.
      'asked:(1) about “And for a cancelled trip?”',
      'tapped:Start',
      'asked:Hi! How can I help?',
    ]);
  });

  it('refuses form values on a review turn', async () => {
    const h = harness();
    const workflowId = await askAiWorkflow(h.runtime);
    const first = await opened(h, { workflowId });
    const intro = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'ask_about_payments' }, WAIT);
    const answered = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: intro.turnId!, text: 'Hi' }, WAIT);
    await expect(h.conversations.answer(SYSTEM, first.conversationId, { turnId: answered.turnId!, values: { x: 1 } }, WAIT)).rejects.toBeInstanceOf(TurnAnswerError);
  });
});

describe('streaming', () => {
  const flow = readConversationalFlow(supportFlow())!;
  const progress = (stepName: string, type: string, payload: Record<string, unknown>) =>
    ({ event: 'step_progress', data: { stepName, type, payload } }) as const;

  it('says which step is working, and passes on what an agent writes, thinks and uses', () => {
    expect(streamEventOf({ event: 'step_started', data: { stepName: 'classify', stepType: 'RUN_AGENT' } }, flow)).toEqual({ type: 'working', kind: 'router', step: 'classify', title: 'AI router' });
    expect(streamEventOf({ event: 'step_started', data: { stepName: 'lookup', stepType: 'HTTP_REQUEST' } }, flow)).toEqual({ type: 'working', kind: 'step', step: 'lookup' });
    expect(streamEventOf({ event: 'step_started', data: { stepName: 'ask_start', stepType: 'WAIT' } }, flow)).toBeNull();
    expect(streamEventOf(progress('answer', 'substep', { type: 'message', content: 'Refunds take' }), flow)).toEqual({ type: 'text', delta: 'Refunds take' });
    expect(streamEventOf(progress('answer', 'thinking', { phase: 'start' }), flow)).toEqual({ type: 'thinking' });
    expect(streamEventOf(progress('answer', 'tool_call', { tool: 'search', phase: 'end' }), flow)).toEqual({ type: 'tool', tool: 'search', phase: 'end' });
  });

  it('never streams what the AI router writes — that is the flow’s decision, not a message', () => {
    expect(streamEventOf(progress('classify', 'substep', { type: 'message', content: '{"screen":"payments"}' }), flow)).toBeNull();
  });

  it('follows a conversation: the turn, the router at work, the next turn, and stops when it ends', async () => {
    const h = harness();
    const workflowId = await flowWorkflow(h.runtime);
    const first = await opened(h, { workflowId });
    const seen: ConversationStreamEvent[] = [];
    const following = (async () => {
      for await (const event of h.conversations.stream(SYSTEM, first.conversationId)) {
        if (!event) continue;
        seen.push(event);
        if (event.type === 'turn' && event.turn.screen?.id === 'payments') break;
      }
    })();
    await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, text: 'I was charged twice' }, 0);
    await following;

    expect(seen[0]).toMatchObject({ type: 'turn', turn: { turnId: first.turnId } });
    expect(seen).toContainEqual({ type: 'working', kind: 'router', step: 'classify', title: 'AI router' });
    expect(seen.at(-1)).toMatchObject({ type: 'turn', turn: { screen: { id: 'payments' }, events: [{ type: 'typed' }, { type: 'routed', to: 'payments' }] } });

    const ended: ConversationStreamEvent[] = [];
    const tail = (async () => {
      for await (const event of h.conversations.stream(SYSTEM, first.conversationId)) if (event) ended.push(event);
    })();
    await h.conversations.end(SYSTEM, first.conversationId);
    await tail;
    expect(ended.at(-1)).toMatchObject({ type: 'turn', turn: { status: 'ended' } });
  });

  /**
   * The difference that lets an integrator write one loop: a stream that answers
   * an action ends when it is someone's move, so the close *is* the "your turn"
   * signal and a reply arrives once, on the connection that asked for it.
   */
  it('ends at their move when it is answering an action, and runs on when it is watching', async () => {
    const h = harness();
    const workflowId = await flowWorkflow(h.runtime);
    const first = await opened(h, { workflowId });

    // Answering: it closes by itself, with the turn it reached.
    const reply: ConversationStreamEvent[] = [];
    const replying = (async () => {
      for await (const event of h.conversations.stream(SYSTEM, first.conversationId, 'their-move', first.turnId!)) if (event) reply.push(event);
    })();
    await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, text: 'I was charged twice' }, 0);
    await replying;

    expect(reply.at(-1)).toMatchObject({ type: 'turn', turn: { screen: { id: 'payments' }, status: 'awaiting_reply' } });
    // Only what happened after the action: the turn just answered is not replayed.
    expect(reply.filter((e) => e.type === 'turn' && e.turn.turnId === first.turnId)).toHaveLength(0);
    expect(reply).toContainEqual({ type: 'working', kind: 'router', step: 'classify', title: 'AI router' });

    // Watching: the same conversation, and it is still going.
    const watched: ConversationStreamEvent[] = [];
    const watching = (async () => {
      for await (const event of h.conversations.stream(SYSTEM, first.conversationId, 'the-end')) if (event) watched.push(event);
    })();
    await h.conversations.end(SYSTEM, first.conversationId);
    await watching;
    expect(watched.at(-1)).toMatchObject({ type: 'turn', turn: { status: 'ended' } });
  });

  it('a stream that fails after it has begun says so as an event, not a status', async () => {
    const h = harness();
    const workflowId = await flowWorkflow(h.runtime);
    const first = await opened(h, { workflowId });
    const seen: ConversationStreamEvent[] = [];
    // The second read is the one inside the loop; break it there.
    let reads = 0;
    vi.spyOn(h.runtime, 'getExecutionDetail').mockImplementation(async function (this: unknown, ...args: Parameters<typeof h.runtime.getExecutionDetail>) {
      reads += 1;
      if (reads > 1) throw new Error('storage went away');
      return h.runtime.constructor.prototype.getExecutionDetail.apply(h.runtime, args) as never;
    });

    for await (const event of h.conversations.stream(SYSTEM, first.conversationId, 'the-end')) {
      if (event) seen.push(event);
      if (seen.some((e) => e.type === 'error')) break;
    }
    expect(seen[0]).toMatchObject({ type: 'turn' });
    expect(seen.at(-1)).toMatchObject({ type: 'error', code: 'stream_failed' });
  });

  it('streams over HTTP as server-sent events, and refuses an unknown conversation with a status', async () => {
    const h = harness();
    const workflowId = await flowWorkflow(h.runtime);
    const first = await opened(h, { workflowId });
    const route = createWorkflowRouter(h.runtime, {}).find((r) => r.method === 'GET' && r.path === '/conversations/:id')!;

    const ok = await route.handler({ params: { id: first.conversationId }, query: { stream: '1' }, body: undefined, headers: {} }, SYSTEM);
    expect(ok.status).toBe(200);
    expect(ok.headers?.['Content-Type']).toBe('text/event-stream');
    const frames = ok.stream![Symbol.asyncIterator]();
    const opening = await frames.next();
    expect(opening.value).toMatch(/^event: turn\ndata: \{"type":"turn","turn":\{"conversationId":/);
    await frames.return?.(undefined);

    const missing = await route.handler({ params: { id: 'no_such_run' }, query: { stream: '1' }, body: undefined, headers: {} }, SYSTEM);
    expect(missing.status).toBe(404);
  });
});

describe('resume', () => {
  it('refuses a second answer to a gate whose first answer has not been applied yet', async () => {
    const h = harness();
    const workflowId = await flowWorkflow(h.runtime);
    const first = await opened(h, { workflowId });
    h.pauseWorker();
    const data = { action: 'approve' as const, data: { choice: 'payments', message: '' } };
    await h.runtime.resume(SYSTEM, first.conversationId, { data, nodePath: first.turnId! });
    await expect(h.runtime.resume(SYSTEM, first.conversationId, { data, nodePath: first.turnId! })).rejects.toThrow(/already has an answer waiting/);
  });
});

describe('waiting for the next turn', () => {
  /**
   * `execution_paused` is published while the step row is written — a moment
   * before the execution row carries EXTERNAL_WAIT, which is what `readTurn`
   * needs. So the run's own status change has to reach the run's own topic, or a
   * waiter woken by the pause alone has nothing left to wake it.
   */
  it('announces the run’s status change on the run’s own topic', async () => {
    const h = harness();
    const workflowId = await flowWorkflow(h.runtime);
    const first = await opened(h, { workflowId });

    const events: Array<{ event: string; status?: unknown }> = [];
    await h.eventBus.subscribe(executionTopic(first.conversationId), (event) => {
      events.push({ event: event.event, status: (event.data as Record<string, unknown>)['status'] });
    });
    await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'payments' }, WAIT);

    expect(events.map((e) => e.event)).toContain('execution_paused');
    // Published after the pass returns, so it can land a moment after the turn
    // is already answerable — which is the point: it is the later of the two.
    await vi.waitFor(() =>
      expect(events).toEqual(
        expect.arrayContaining([{ event: 'run_changed', status: 'EXTERNAL_WAIT' }]),
      ),
    );
  });

  it('opens the next turn without waiting out the backstop when writes cost something', async () => {
    const h = harness({ writeLatencyMs: 15 });
    const workflowId = await flowWorkflow(h.runtime);
    const first = await opened(h, { workflowId });

    const started = Date.now();
    const next = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'payments' }, WAIT);
    const took = Date.now() - started;

    expect(next.status).toBe('awaiting_reply');
    // The backstop is 3s. Before the run's status reached the run's topic this
    // slept all of it, on every turn, and no test noticed.
    expect(took).toBeLessThan(1_500);
  });
});

describe('conversation routes', () => {
  it('answer over HTTP, with 409 carrying the current turn and 400 for a bad answer', async () => {
    const h = harness();
    const workflowId = await flowWorkflow(h.runtime);
    const routes = createWorkflowRouter(h.runtime, {});
    const call = (method: string, path: string, params: Record<string, string>, body?: unknown) => {
      const route = routes.find((r) => r.method === method && r.path === path)!;
      return route.handler({ params, query: {}, body, headers: {} }, SYSTEM);
    };

    const started = await call('POST', '/conversations', {}, { workflowId, waitMs: WAIT });
    expect(started.status).toBe(201);
    const turn = started.body as Turn;

    const replied = await call('POST', '/conversations', {}, { conversationId: turn.conversationId, turnId: turn.turnId, choice: 'payments', waitMs: WAIT });
    expect(replied.status).toBe(200);

    const conflict = await call('POST', '/conversations', {}, { conversationId: turn.conversationId, turnId: turn.turnId, choice: 'report_a_trip' });
    expect(conflict.status).toBe(409);
    expect((conflict.body as { turn: Turn }).turn.turnId).toBe((replied.body as Turn).turnId);

    const bad = await call('POST', '/conversations', {}, { conversationId: turn.conversationId, turnId: (replied.body as Turn).turnId, choice: 'nowhere' });
    expect(bad.status).toBe(400);

    const missing = await call('GET', '/conversations/:id', { id: 'no_such_run' });
    expect(missing.status).toBe(404);
  });
});

describe('Hand off', () => {
  async function handoffWorkflow(runtime: WorkflowRuntime): Promise<string> {
    const { config } = addScreen(supportFlow(), { title: 'Talk to a person', parent: 'start', type: 'handoff' });
    const folder = await runtime.createFolder(SYSTEM, { name: 'Flows' });
    return (await runtime.createWorkflow(SYSTEM, { name: 'Support', config, folderId: folder.id })).id;
  }

  async function handOff(h: ReturnType<typeof harness>) {
    const workflowId = await handoffWorkflow(h.runtime);
    const first = await opened(h, { workflowId });
    const handed = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'talk_to_a_person' }, WAIT);
    return { first, handed, id: first.conversationId };
  }

  it('waits for the person, carrying the conversation so far and where it can go next', async () => {
    const h = harness();
    const { first, handed } = await handOff(h);
    expect(handed).toMatchObject({ status: 'handed_off', turnId: expect.stringMatching(/handoff_talk_to_a_person$/), messages: [] });
    expect(handed.handoff).toEqual({
      context: [
        { type: 'asked', turnId: first.turnId, text: 'Hi! How can I help?', screen: 'start' },
        { type: 'tapped', optionId: 'talk_to_a_person', label: 'Talk to a person' },
      ],
    });
    expect(handed.reply).toEqual({
      options: [
        { id: 'done', label: 'Finish', kind: 'finish' },
        { id: 'start', label: 'Start', kind: 'back' },
        { id: 'payments', label: 'Payments', kind: 'next' },
        { id: 'report_a_trip', label: 'Report a trip', kind: 'next' },
        // A follow-up is a screen of its own now, so a person can be sent to it.
        { id: 'unsafe_driving', label: 'Report a trip › Unsafe driving', kind: 'next' },
      ],
      text: { allowed: false },
    });
  });

  it('closes when the person is done', async () => {
    const h = harness();
    const { id, handed } = await handOff(h);
    const closed = await h.conversations.answer(SYSTEM, id, { turnId: handed.turnId!, choice: 'done' }, WAIT);
    expect(closed).toMatchObject({ status: 'finished', outcome: { outcome: 'done' } });
    expect(closed.events).toEqual([{ type: 'handed_back', to: 'done', title: 'Finish' }]);
  });

  it('hands back to the flow on the screen the person chose', async () => {
    const h = harness();
    const { id, handed } = await handOff(h);
    const back = await h.conversations.answer(SYSTEM, id, { turnId: handed.turnId!, choice: 'payments' }, WAIT);
    expect(back).toMatchObject({ status: 'awaiting_reply', screen: { id: 'payments' }, messages: [{ text: 'Refunds take 5–7 days.' }] });
    expect(back.events).toEqual([{ type: 'handed_back', to: 'payments', title: 'Payments' }]);
    expect((await h.conversations.transcript(SYSTEM, id)).entries.map((e) => e.type)).toEqual(['asked', 'tapped', 'handed_back', 'asked']);
  });

  it('takes no typed text while a person has it, and one answer only', async () => {
    const h = harness();
    const { id, handed } = await handOff(h);
    await expect(h.conversations.answer(SYSTEM, id, { turnId: handed.turnId!, text: 'hello?' }, WAIT)).rejects.toBeInstanceOf(TurnAnswerError);
    await h.conversations.answer(SYSTEM, id, { turnId: handed.turnId!, choice: 'payments' }, WAIT);
    await expect(h.conversations.answer(SYSTEM, id, { turnId: handed.turnId!, choice: 'done' }, WAIT)).rejects.toBeInstanceOf(ConversationConflictError);
  });

  it('is reached by typing, saying why', async () => {
    const h = harness();
    const workflowId = await handoffWorkflow(h.runtime);
    const turn = await startedBySaying(h, workflowId, 'Let me talk to a human');
    expect(turn.status).toBe('handed_off');
    expect(turn.handoff!.context.slice(1)).toEqual([
      { type: 'typed', text: 'Let me talk to a human' },
      { type: 'routed', to: 'talk_to_a_person', title: 'Talk to a person', reason: 'They ask for a person.', by: 'AI router' },
    ]);
  });

  it('keeps the stream open through it', async () => {
    const h = harness();
    const { id, handed } = await handOff(h);
    const seen: ConversationStreamEvent[] = [];
    const reading = (async () => {
      for await (const event of h.conversations.stream(SYSTEM, id)) {
        if (!event) continue;
        seen.push(event);
        if (event.type === 'turn' && event.turn.status === 'finished') break;
      }
    })();
    await new Promise((r) => setTimeout(r, 50));
    await h.conversations.answer(SYSTEM, id, { turnId: handed.turnId!, choice: 'done' }, 0);
    await reading;
    expect(seen.filter((e) => e.type === 'turn').map((e) => (e as { turn: Turn }).turn.status)).toEqual(['handed_off', 'finished']);
  });
});

describe('a flow that routes with the classifier', () => {
  /** The classifier service, stubbed: it answers with the class and how sure it was. */
  function stubClassifier(answer: { choice: string; confidence: number }) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { class: { type: 'choice', choice: answer.choice, probabilities: { [answer.choice]: answer.confidence }, confidence: answer.confidence } },
          usage: { input_tokens: 120, output_tokens: 8 },
        }),
    } as unknown as Response);
  }

  async function classifierWorkflow(runtime: WorkflowRuntime): Promise<string> {
    const { config } = createConversationalFlow({
      router: { kind: 'classifier', model: 'jev-latest', minConfidence: 0.5 },
    });
    const withPayments = addScreen(config, { title: 'Payments', parent: 'start', type: 'message' }).config;
    const ready = setPromptSays(withPayments, 'ask_payments', ['Refunds take 5–7 days.']);
    const folder = await runtime.createFolder(SYSTEM, { name: 'Flows' });
    return (await runtime.createWorkflow(SYSTEM, { name: 'Support', config: ready, folderId: folder.id })).id;
  }

  afterEach(() => vi.restoreAllMocks());

  it('sends what they typed to the classifier and opens the class it answers', async () => {
    const h = harness();
    const workflowId = await classifierWorkflow(h.runtime);
    const fetchSpy = stubClassifier({ choice: 'payments', confidence: 0.86 });

    const turn = await startedBySaying(h, workflowId, 'where is my refund');

    const [, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { state: string; questions: { class: { criteria: Record<string, string> } } };
    expect(body.state).toBe('where is my refund');
    expect(Object.keys(body.questions.class.criteria)).toEqual(['start', 'payments']);

    expect(turn.screen?.id).toBe('payments');
    expect(turn.messages[0]!.text).toBe('Refunds take 5–7 days.');
    expect(turn.events).toEqual([
      { type: 'typed', text: 'where is my refund' },
      { type: 'routed', to: 'payments', title: 'Payments', confidence: 0.86, by: 'AI router' },
    ]);
  });

  it('sends them back to the first screen when the model is unsure', async () => {
    const h = harness();
    const workflowId = await classifierWorkflow(h.runtime);
    stubClassifier({ choice: 'payments', confidence: 0.21 });

    const turn = await startedBySaying(h, workflowId, 'hm');
    expect(turn.screen?.id).toBe('start');
    expect(turn.events.at(-1)).toMatchObject({ type: 'routed', to: 'start', confidence: 0.21 });
  });
});

describe('a screen that only takes options', () => {
  it('says typing is not allowed, and refuses it', async () => {
    const h = harness();
    const folder = await h.runtime.createFolder(SYSTEM, { name: 'Flows' });
    const config = setTypingAllowed(supportFlow(), 'payments', false);
    const workflowId = (await h.runtime.createWorkflow(SYSTEM, { name: 'Support', config, folderId: folder.id })).id;

    const first = await opened(h, { workflowId });
    expect(first.reply?.text.allowed).toBe(true);

    const payments = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'payments' }, WAIT);
    expect(payments.screen?.id).toBe('payments');
    expect(payments.reply?.text).toEqual({ allowed: false });
    expect(payments.reply!.options.length).toBeGreaterThan(0);

    await expect(
      h.conversations.answer(SYSTEM, first.conversationId, { turnId: payments.turnId!, text: 'but I want to type' }, WAIT),
    ).rejects.toThrow(/doesn’t take typed text/);

    // Tapping still works, so the screen is answerable.
    const done = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: payments.turnId!, choice: 'done' }, WAIT);
    expect(done.status).toBe('finished');
  });
});

describe('a section that keeps typed messages inside it', () => {
  /** The classifier service, stubbed: it answers with the class and how sure it was. */
  function stub(choice: string, confidence = 0.9) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { class: { type: 'choice', choice, probabilities: { [choice]: confidence }, confidence } },
          usage: { input_tokens: 90, output_tokens: 6 },
        }),
    } as unknown as Response);
  }

  async function scopedWorkflow(runtime: WorkflowRuntime): Promise<string> {
    let config = createConversationalFlow({ router: { kind: 'classifier', model: 'jev-latest' } }).config;
    config = addScreen(config, { title: 'Payments', parent: 'start', type: 'menu' }).config;
    config = addScreen(config, { title: 'Refunds', parent: 'payments', type: 'message' }).config;
    config = setPromptSays(config, 'ask_refunds', ['Refunds take 5–7 days.']);
    config = addScreen(config, { title: 'Rides', parent: 'start', type: 'message' }).config;
    config = scopeRouter(config, 'payments', true);
    const folder = await runtime.createFolder(SYSTEM, { name: 'Flows' });
    return (await runtime.createWorkflow(SYSTEM, { name: 'Support', config, folderId: folder.id })).id;
  }

  afterEach(() => vi.restoreAllMocks());

  it('asks the section’s own router, which is never offered another section', async () => {
    const h = harness();
    const workflowId = await scopedWorkflow(h.runtime);

    // Down into the section by tapping, then type.
    const first = await opened(h, { workflowId });
    const payments = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'payments' }, WAIT);
    const fetchSpy = stub('refunds');
    const answered = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: payments.turnId!, text: 'where is my refund' }, WAIT);

    const [, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { questions: { class: { criteria: Record<string, string> } } };
    const offered = Object.keys(body.questions.class.criteria);
    expect(offered).toEqual(expect.arrayContaining(['payments', 'refunds', 'start']));
    expect(offered).not.toContain('rides');

    expect(answered.screen?.id).toBe('refunds');
    expect(answered.events.at(-1)).toMatchObject({ type: 'routed', to: 'refunds', by: 'Payments — typed messages' });
  });

  it('still sees the whole flow from the first screen', async () => {
    const h = harness();
    const workflowId = await scopedWorkflow(h.runtime);
    const fetchSpy = stub('refunds');
    const turn = await startedBySaying(h, workflowId, 'where is my refund');

    const [, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { questions: { class: { criteria: Record<string, string> } } };
    // The flow's router reaches inside the section, or typing at the top could
    // only ever open Payments itself.
    expect(Object.keys(body.questions.class.criteria)).toEqual(expect.arrayContaining(['refunds', 'rides']));
    expect(turn.screen?.id).toBe('refunds');
  });
});

describe('a conversation that ends itself', () => {
  function stubEnding(choice: string) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { class: { type: 'choice', choice, probabilities: { [choice]: 0.94 }, confidence: 0.94 } },
          usage: { input_tokens: 70, output_tokens: 5 },
        }),
    } as unknown as Response);
  }

  async function endingWorkflow(runtime: WorkflowRuntime): Promise<string> {
    let config = createConversationalFlow({ router: { kind: 'classifier', model: 'jev-latest' } }).config;
    config = setEndMessage(config, 'done', 'Glad that helped — closing this here.');
    config = setAbout(config, 'done', 'they say they are done and need nothing else');
    config = addOption(config, 'ask_start', { label: 'That’s all', screen: 'done' });
    const folder = await runtime.createFolder(SYSTEM, { name: 'Flows' });
    return (await runtime.createWorkflow(SYSTEM, { name: 'Support', config, folderId: folder.id })).id;
  }

  afterEach(() => vi.restoreAllMocks());

  it('says goodbye when they tap their way out', async () => {
    const h = harness();
    const workflowId = await endingWorkflow(h.runtime);
    const first = await opened(h, { workflowId });
    const done = await h.conversations.answer(SYSTEM, first.conversationId, { turnId: first.turnId!, choice: 'done' }, WAIT);

    expect(done.status).toBe('finished');
    expect(done.messages).toEqual([
      { role: 'assistant', source: 'flow', text: 'Glad that helped — closing this here.' },
    ]);
    // The farewell reaches the integrator in the outcome as well.
    expect(done.outcome).toMatchObject({ outcome: 'done', message: 'Glad that helped — closing this here.' });
  });

  it('ends when they type that they are done, and the model is told what that means', async () => {
    const h = harness();
    const workflowId = await endingWorkflow(h.runtime);
    const fetchSpy = stubEnding('done');
    const turn = await startedBySaying(h, workflowId, 'that is all thanks');

    const [, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    const criteria = (JSON.parse(String(init.body)) as { questions: { class: { criteria: Record<string, string> } } }).questions.class.criteria;
    expect(criteria['done']).toBe('Ends the conversation — they say they are done and need nothing else');

    expect(turn.status).toBe('finished');
    expect(turn.messages[0]!.text).toBe('Glad that helped — closing this here.');
    expect(turn.events).toEqual([
      { type: 'typed', text: 'that is all thanks' },
      { type: 'routed', to: 'done', title: 'Finish', confidence: 0.94, by: 'AI router' },
    ]);
  });
});
