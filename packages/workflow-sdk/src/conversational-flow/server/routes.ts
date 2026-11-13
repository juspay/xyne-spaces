/**
 * HTTP routes for conversations. Mounted by `createWorkflowRouter` beside the
 * execution routes, behind the same session access: the host authenticates the
 * caller, and the runtime's authorizer decides as it does for the run itself.
 *
 * Three calls, because a conversation is a state machine with a person in it and
 * there are only three things to do with one:
 *
 *   POST /conversations        advance     start · answer · read
 *   GET  /conversations/:id    observe     read · watch
 *   POST /conversations/:id/end  terminate
 *
 * Starting and answering are the same call because they are the same act — the
 * machine moves and tells you where it is. Which one it is depends on whether
 * you send `workflowId` or `conversationId`, and both answer with a `Turn`.
 *
 * `stream` decides the format and nothing else does: `true` always answers with
 * SSE, even when the reply is a fixed menu with nothing to stream, and `false`
 * always answers with JSON. So an integrator writes one code path per mode
 * rather than branching on what the flow happened to contain.
 */
import type { WorkflowRuntime } from '../../runtime/workflow-runtime.js';
import type { RouteDefinition, RouteRequest, RouteResponse } from '../../router/types.js';
import { TurnAnswerError, type ConversationStreamEvent, type TurnAnswer } from '../turn.js';
import { ConversationConflictError, ConversationService, type StartConversation } from './conversation-service.js';

/** How long start and replies wait for the next turn unless told otherwise. */
const DEFAULT_WAIT_MS = 20_000;

type Rec = Record<string, unknown>;

export function conversationRoutes<TCtx>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runtime: WorkflowRuntime<any, TCtx>,
  asCtx: (auth: TCtx | null) => TCtx,
): Array<Omit<RouteDefinition<TCtx>, 'access'>> {
  const conversations = new ConversationService<TCtx>(runtime);

  return [
    {
      method: 'POST',
      path: '/conversations',
      handler: (req, auth) =>
        answerWith(async () => {
          const body = rec(req.body);
          const wants = body['stream'] === true;
          const conversationId = str(body['conversationId']);

          // Starting: the trigger's own payload, and nothing this layer invents.
          if (!conversationId) {
            const workflowId = str(body['workflowId']);
            if (!workflowId) return bad('Send `workflowId` to start, or `conversationId` to continue.');
            const input: StartConversation = { workflowId };
            if (isRec(body['context'])) input.context = body['context'];
            const { id, turn } = await conversations.start(asCtx(auth), input, wants ? 0 : waitOf(body['waitMs'], DEFAULT_WAIT_MS));
            return wants ? streaming(conversations, asCtx(auth), id, 'their-move') : { status: 201, body: turn };
          }

          // Continuing: with a turnId and an answer it advances; without one it
          // is the same question asked of a conversation already under way.
          const turnId = str(body['turnId']);
          if (turnId) {
            const answer: TurnAnswer = {};
            if (typeof body['choice'] === 'string') answer.choice = body['choice'];
            if (typeof body['text'] === 'string') answer.text = body['text'];
            if (isRec(body['values'])) answer.values = body['values'];
            const turn = await conversations.answer(asCtx(auth), conversationId, { turnId, ...answer }, wants ? 0 : waitOf(body['waitMs'], DEFAULT_WAIT_MS));
            return wants ? streaming(conversations, asCtx(auth), conversationId, 'their-move', turnId) : { status: 200, body: turn };
          }

          if (wants) return streaming(conversations, asCtx(auth), conversationId, 'their-move');
          return { status: 200, body: await conversations.get(asCtx(auth), conversationId, waitOf(body['waitMs'], DEFAULT_WAIT_MS)) };
        }),
    },
    {
      method: 'GET',
      path: '/conversations/:id',
      handler: (req, auth) =>
        answerWith(async () => {
          // Watching, not acting — so this one runs to the end of the
          // conversation rather than stopping at the next move.
          if (req.query['stream'] !== undefined && req.query['stream'] !== 'false') {
            return streaming(conversations, asCtx(auth), idOf(req), 'the-end');
          }
          return { status: 200, body: await conversations.get(asCtx(auth), idOf(req), waitOf(req.query['waitMs'], 0)) };
        }),
    },
    {
      method: 'POST',
      path: '/conversations/:id/end',
      handler: (req, auth) => answerWith(async () => ({ status: 200, body: await conversations.end(asCtx(auth), idOf(req)) })),
    },
  ];
}

/**
 * A conversation as server-sent events.
 *
 * The first event is read before answering: it is what checks the caller may see
 * this conversation, so a refusal is a status rather than a broken stream.
 *
 * `X-Accel-Buffering` because one path serves both formats — a proxy cannot be
 * told to stop buffering by location, so the response says it itself.
 */
async function streaming<TCtx>(
  conversations: ConversationService<TCtx>,
  ctx: TCtx,
  id: string,
  until: 'their-move' | 'the-end',
  after?: string,
): Promise<RouteResponse> {
  const events = conversations.stream(ctx, id, until, after);
  const first = await events.next();
  async function* sse(): AsyncIterable<string> {
    try {
      if (!first.done && first.value) yield frame(first.value);
      for await (const event of events) yield event ? frame(event) : ': keepalive\n\n';
    } finally {
      await events.return(undefined);
    }
  }
  return {
    status: 200,
    body: null,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
    stream: sse(),
  };
}

/** Map conversation outcomes to HTTP; access and not-found are mapped by the router's wrapper. */
async function answerWith(handle: () => Promise<RouteResponse>): Promise<RouteResponse> {
  try {
    return await handle();
  } catch (err) {
    if (err instanceof ConversationConflictError) return { status: 409, body: { error: err.message, turn: err.turn } };
    if (err instanceof TurnAnswerError) return bad(err.message);
    throw err;
  }
}

function frame(event: ConversationStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function idOf(req: RouteRequest): string {
  return req.params['id'] ?? '';
}

function waitOf(value: unknown, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function bad(message: string): RouteResponse {
  return { status: 400, body: { error: message } };
}

function rec(v: unknown): Rec {
  return isRec(v) ? v : {};
}

function isRec(v: unknown): v is Rec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}
