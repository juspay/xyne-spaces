/**
 * Conversations over workflow runs, for callers who want a chatbot: start one,
 * get a turn, answer it, get the next.
 *
 * A thin layer over the runtime and nothing else — a conversation is an
 * execution, a turn is its paused step, an answer is a resume of that step, and
 * waiting for the next turn is the execution's own event stream. Every call goes
 * through the runtime's guarded methods, so the host's authorizer decides who
 * may do what, exactly as it does for the run itself.
 */
import type { WorkflowRuntime } from '../../runtime/workflow-runtime.js';
import { ResourceNotFoundError } from '../../authz/default.js';
import type { ResumePayload } from '../../common/resume-payload.js';
import { executionTopic, type BusEvent } from '../../events/types.js';
import { createEventChannel } from '../../util/event-channel.js';
import { readConversationalFlow } from '../read.js';
import {
  answerFor,
  answeredWith,
  readTranscript,
  readTurn,
  streamEventOf,
  type ConversationStreamEvent,
  type RunView,
  type Transcript,
  type Turn,
  type TurnAnswer,
} from '../turn.js';

export interface StartConversation {
  workflowId: string;
  /**
   * What the conversation is started with — the trigger's own payload, exactly
   * as `POST /workflows/:id/trigger` takes it, validated against the same
   * `inputSchema` and read as `{{trigger.context.<key>}}`.
   *
   * Everything the caller wants to carry goes here: an order id, who is asking,
   * their ticket. One place, which is the place the builder can offer in its
   * value picker and the validator can check.
   */
  context?: Record<string, unknown>;
}

export interface AnswerTurn extends TurnAnswer {
  turnId: string;
}

/** The answer is for a turn that is no longer open, and isn't a retry of the answer it got. */
export class ConversationConflictError extends Error {
  override readonly name = 'ConversationConflictError';
  constructor(readonly turn: Turn) {
    super('That turn has already been answered or is no longer open.');
  }
}

/** Longest a call waits for the next turn before answering `working`. */
export const MAX_WAIT_MS = 25_000;

/** Re-read this often while waiting, in case the bus dropped an event (it delivers at most once). */
const BACKSTOP_MS = 3_000;

/**
 * Events after which the turn can have changed: the run paused, or ended.
 *
 * `run_changed` is the one that says the execution row itself carries the new
 * status, which is what {@link readTurn} needs before it will open a turn. The
 * pause events are published a moment earlier, while the step row is written —
 * so a reader woken only by those reads the turn as still working, and nothing
 * further arrives to wake it.
 */
const TURN_EVENTS = new Set([
  'execution_paused',
  'execution_completed',
  'execution_failed',
  'execution_cancelled',
  'run_changed',
]);

/** A step is marked paused a moment before its run is; look again this soon. */
const SETTLE_MS = 250;

const FINAL = new Set<Turn['status']>(['finished', 'failed', 'ended']);

/** Turns that can be answered: the customer's, or — handed off — the person's who has it. */
const OPEN = new Set<Turn['status']>(['awaiting_reply', 'handed_off']);

export class ConversationService<TCtx> {
  // `any` for services: this never touches them, only forwards ctx.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly runtime: WorkflowRuntime<any, TCtx>) {}

  /**
   * Starting a conversation is triggering the workflow: the same payload, the
   * same validation, the same references. Nothing is added on the way through.
   */
  async start(ctx: TCtx, input: StartConversation, waitMs: number): Promise<{ id: string; turn: Turn }> {
    const payload = input.context ? { context: input.context } : {};
    const id = await this.runtime.triggerManual(ctx, input.workflowId, payload);
    return { id, turn: await this.waitForTurn(ctx, id, Date.now() + clampWait(waitMs)) };
  }

  /** The current turn, waiting up to `waitMs` while the run is still working. */
  async get(ctx: TCtx, id: string, waitMs: number): Promise<Turn> {
    return this.waitForTurn(ctx, id, Date.now() + clampWait(waitMs));
  }

  async answer(ctx: TCtx, id: string, input: AnswerTurn, waitMs: number): Promise<Turn> {
    const deadline = Date.now() + clampWait(waitMs);
    const { turnId, ...answer } = input;
    const run = await this.load(ctx, id);
    const turn = readTurn(run);

    if (OPEN.has(turn.status) && turn.turnId === turnId) {
      const { nodePath, payload } = answerFor(run, turnId, answer);
      try {
        await this.runtime.resume(ctx, id, { data: payload as unknown as ResumePayload, nodePath });
      } catch (err) {
        // Lost a race with the same answer sent twice: the first one stands.
        if (answeredWith(await this.load(ctx, id), turnId, answer) !== true) throw err;
      }
      return this.waitForTurn(ctx, id, deadline);
    }

    // A retry of an answer already accepted gets the turn that followed it.
    if (answeredWith(run, turnId, answer) === true) return this.waitForTurn(ctx, id, deadline);
    throw new ConversationConflictError(turn);
  }

  /**
   * Everything said so far.
   *
   * Not an endpoint of its own — a caller following the conversation already has
   * every turn, and the one case that needs history without having watched it,
   * a person taking over a hand off, gets it on the turn as `handoff.context`.
   * It stays here for a host that wants to expose it for its own reasons.
   */
  async transcript(ctx: TCtx, id: string): Promise<Transcript> {
    return readTranscript(await this.load(ctx, id));
  }

  async end(ctx: TCtx, id: string): Promise<Turn> {
    const turn = readTurn(await this.load(ctx, id));
    if (!FINAL.has(turn.status)) await this.runtime.cancelExecution(ctx, id);
    return readTurn(await this.load(ctx, id));
  }

  /**
   * The conversation as it happens: what is working, what agents write while it
   * does, and each new turn.
   *
   * Two shapes, for two different questions:
   *
   * - `until: 'their-move'` — the response to an action. It ends as soon as the
   *   conversation is waiting on someone again, so the close *is* the "your
   *   move" signal and a reply arrives exactly once, on the connection that
   *   asked for it. This is what a chat client uses.
   * - `until: 'the-end'` — watching. It runs until the conversation is over, for
   *   picking the thread back up after a reload, or a second viewer.
   *
   * Yields `undefined` when nothing happened for a while, so a transport can
   * keep an idle connection open. Stop iterating to disconnect.
   */
  async *stream(
    ctx: TCtx,
    id: string,
    until: 'their-move' | 'the-end' = 'the-end',
    /**
     * The turn just answered, when there is one.
     *
     * A resume is applied a moment after it is accepted, so a stream opened
     * straight afterwards can still find the answered turn sitting there, open.
     * Without knowing which turn that was it would close immediately and the
     * client would be told it was their move again. So "their move" means *a
     * different* turn, not merely an open one.
     */
    after?: string,
  ): AsyncGenerator<ConversationStreamEvent | undefined> {
    const done = (turn: Turn) =>
      FINAL.has(turn.status) || (until === 'their-move' && OPEN.has(turn.status) && turn.turnId !== after);
    const channel = createEventChannel<BusEvent | 'tick'>();
    // Subscribe before the first read, so nothing between them is missed.
    const unsubscribe = await this.runtime.eventBus?.subscribe(executionTopic(id), channel.push);
    const backstop = setInterval(() => channel.push('tick'), BACKSTOP_MS);
    let settle: ReturnType<typeof setTimeout> | undefined;
    let begun = false;
    try {
      const run = await this.load(ctx, id);
      const flow = run.config ? readConversationalFlow(run.config) : null;
      let last = readTurn(run);
      // Answering an action, the turn being moved past is not news: the caller
      // has just sent it. So the stream carries only what happened after.
      if (last.turnId !== after) yield { type: 'turn', turn: last };
      // Past this point the transport has answered, so a failure has to be said
      // in the stream. Before it — access, not found — it is still a status.
      begun = true;
      if (done(last)) return;

      for await (const event of channel) {
        const progress = event === 'tick' ? null : streamEventOf(event, flow);
        if (progress) yield progress;
        if (event !== 'tick' && !TURN_EVENTS.has(event.event)) continue;

        const turn = readTurn(await this.load(ctx, id));
        if (turn.turnId !== last.turnId || turn.status !== last.status) {
          last = turn;
          yield { type: 'turn', turn };
          if (done(turn)) return;
        } else if (event === 'tick') {
          yield undefined;
        }
        if (event !== 'tick' && turn.status === 'working') {
          clearTimeout(settle);
          settle = setTimeout(() => channel.push('tick'), SETTLE_MS);
        }
      }
    } catch (err) {
      // Nothing has been sent yet, so this can still be a status — which is what
      // the first read is for: access and not-found refuse properly.
      if (!begun) throw err;
      // Otherwise the status line is long gone, and the stream itself is the
      // only honest place left to say it.
      yield { type: 'error', code: 'stream_failed', message: err instanceof Error ? err.message : 'The conversation could not be followed.' };
    } finally {
      clearInterval(backstop);
      clearTimeout(settle);
      unsubscribe?.();
      channel.end();
    }
  }

  // ─── Internals ───

  private async load(ctx: TCtx, id: string): Promise<RunView> {
    // Without the trigger payload: a turn is read from the run's status, its
    // step records and the flow, and this runs several times per exchange.
    const detail = await this.runtime.getExecutionDetail(ctx, id, { triggerData: false });
    if (!detail) throw new ResourceNotFoundError('Conversation', id);
    return { id: detail.execution.id, status: detail.execution.status, steps: detail.steps, config: detail.config };
  }

  /**
   * Read the turn; while the run is working, wait for its next event and read
   * again, until something is asked, it ends, or the deadline passes.
   *
   * Subscribes before reading, so an event published in between still wakes
   * us. The bus delivers at most once, so a slow re-read backs it up.
   */
  private async waitForTurn(ctx: TCtx, id: string, deadline: number): Promise<Turn> {
    let signalled = false;
    let wake: (() => void) | undefined;
    const unsubscribe = await this.runtime.eventBus?.subscribe(executionTopic(id), (event) => {
      // Progress from a working agent streams many events; only these change the turn.
      if (!TURN_EVENTS.has(event.event)) return;
      signalled = true;
      wake?.();
    });
    try {
      for (;;) {
        signalled = false;
        const turn = readTurn(await this.load(ctx, id));
        const left = deadline - Date.now();
        if (turn.status !== 'working' || left <= 0) return turn;
        if (signalled) continue;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.min(BACKSTOP_MS, left));
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = undefined;
      }
    } finally {
      unsubscribe?.();
    }
  }
}

function clampWait(ms: number): number {
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_WAIT_MS) : 0;
}
