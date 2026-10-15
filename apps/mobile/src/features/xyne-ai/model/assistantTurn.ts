import type { StoredConversation } from '../api/xyneAIConversations';
import {
  decodeParts,
  type PlanTodo,
  type ToolInvocation,
  type TurnPart,
  type XyneAIEvent,
} from '../api/xyneAIEvents';
import type { AttachedContextItem } from '../api/xyneAIRequest';
import type { Rating } from '../api/xyneAIStream';
import { getAskAIErrorInfo, getTransportErrorInfo, type AskAIErrorInfo } from './askAIError';

export type TextPart = Extract<TurnPart, { type: 'text' }>;

export interface AssistantTurn {
  status: 'streaming' | 'complete' | 'stopped' | 'error';
  parts: TurnPart[];
  tools: ToolInvocation[];
  plan: { title: string | undefined; todos: PlanTodo[] } | undefined;
  followUps: string[];
  messageId: string | undefined;
  /** The server's id for the question this turn answers; a regenerated answer branches from it. */
  userMessageId: string | undefined;
  error: AskAIErrorInfo | undefined;
  startedAt: number;
  durationMs: number | undefined;
  /** The viewer's saved rating of a reloaded answer. */
  rating: Rating | undefined;
}

export interface ChatTurn {
  id: string;
  query: string;
  context: AttachedContextItem[];
  reply: AssistantTurn;
}

export const startAssistantTurn = (now: number): AssistantTurn => ({
  status: 'streaming',
  parts: [],
  tools: [],
  plan: undefined,
  followUps: [],
  messageId: undefined,
  userMessageId: undefined,
  error: undefined,
  startedAt: now,
  durationMs: undefined,
  rating: undefined,
});

const closeReasoning = (parts: TurnPart[], now: number): TurnPart[] =>
  parts.map(part =>
    part.type === 'reasoning' && part.endedAt === undefined ? { ...part, endedAt: now } : part,
  );

// Consecutive deltas of one kind (or one `partId`) merge; anything else starts a new part.
function appendDelta(
  parts: TurnPart[],
  type: 'reasoning' | 'text',
  delta: string,
  partId: string | undefined,
  now: number,
): TurnPart[] {
  const index = partId
    ? parts.findIndex(part => part.id === partId && part.type === type)
    : parts.length - 1;
  const target = parts[index];
  if (target && target.type !== 'tool' && target.type === type) {
    return parts.map((part, i) => (i === index ? { ...target, text: target.text + delta } : part));
  }
  const id = partId ?? `${type}-${parts.length}`;
  return [
    ...closeReasoning(parts, now),
    type === 'reasoning' ? { type, id, text: delta, startedAt: now } : { type, id, text: delta },
  ];
}

// Only top-level calls are parts; a subagent's calls nest under their parent.
function addToolPart(parts: TurnPart[], invocation: ToolInvocation, now: number): TurnPart[] {
  const id = invocation.toolCallId;
  const isKnown = parts.some(part => part.type === 'tool' && part.id === id);
  return !id || invocation.parentToolCallId || isKnown
    ? parts
    : [...closeReasoning(parts, now), { type: 'tool', id }];
}

// The server re-sends an invocation as it progresses; later updates replace earlier ones.
function upsertTool(tools: ToolInvocation[], invocation: ToolInvocation): ToolInvocation[] {
  const index = invocation.toolCallId
    ? tools.findIndex(tool => tool.toolCallId === invocation.toolCallId)
    : -1;
  return index === -1
    ? [...tools, invocation]
    : tools.map((tool, i) => (i === index ? { ...tool, ...invocation } : tool));
}

const stopRunning = (tools: ToolInvocation[]): ToolInvocation[] =>
  tools.map(tool => (tool.status === 'running' ? { ...tool, status: 'stopped' } : tool));

// The final content is authoritative; streamed deltas can be partial.
function withFinalText(parts: TurnPart[], content: string | undefined): TurnPart[] {
  if (content === undefined) return parts;
  const last = parts.at(-1);
  return last?.type === 'text'
    ? [...parts.slice(0, -1), { ...last, text: content }]
    : [...parts, { type: 'text', id: `text-${parts.length}`, text: content }];
}

export function reduceAssistantTurn(
  turn: AssistantTurn,
  event: XyneAIEvent,
  now: number,
): AssistantTurn {
  switch (event.type) {
    case 'text':
    case 'reasoning':
      return {
        ...turn,
        parts: appendDelta(turn.parts, event.type, event.delta, event.partId, now),
      };
    case 'tool':
      return {
        ...turn,
        tools: upsertTool(turn.tools, event.invocation),
        parts: addToolPart(turn.parts, event.invocation, now),
      };
    case 'plan':
      return { ...turn, plan: { title: event.title, todos: event.todos } };
    case 'complete':
      return {
        ...turn,
        status: 'complete',
        parts: event.parts ?? withFinalText(closeReasoning(turn.parts, now), event.content),
        messageId: event.messageId,
        userMessageId: event.userMessageId,
        followUps: event.followUps.length > 0 ? event.followUps : turn.followUps,
        durationMs: event.durationMs ?? now - turn.startedAt,
      };
    case 'followUps':
      return { ...turn, followUps: event.suggestions };
    case 'error':
      return {
        ...turn,
        status: 'error',
        parts: closeReasoning(turn.parts, now),
        tools: stopRunning(turn.tools),
        error: getAskAIErrorInfo(event.message, event.httpStatus),
      };
    case 'start':
      return turn;
  }
}

export type StreamOutcome =
  { kind: 'closed' } | { kind: 'stopped' } | { kind: 'failed'; httpStatus: number | undefined };

export function settleAssistantTurn(
  turn: AssistantTurn,
  outcome: StreamOutcome,
  now: number,
): AssistantTurn {
  if (turn.status !== 'streaming') return turn;
  const ended = {
    ...turn,
    parts: closeReasoning(turn.parts, now),
    tools: stopRunning(turn.tools),
    durationMs: now - turn.startedAt,
  };
  switch (outcome.kind) {
    case 'closed':
      return { ...ended, status: 'complete' };
    case 'stopped':
      return { ...ended, status: 'stopped' };
    case 'failed':
      return { ...ended, status: 'error', error: getTransportErrorInfo(outcome.httpStatus) };
  }
}

export const isShownText = (part: TurnPart): part is TextPart =>
  part.type === 'text' && !part.superseded && part.text.trim() !== '';

export const answerText = (turn: AssistantTurn): string =>
  turn.parts
    .filter(isShownText)
    .map(part => part.text)
    .join('\n\n');

/**
 * Rebuilds the turns of a stored conversation. A question with several stored
 * answers (regenerated) shows the latest; an unanswered one shows as stopped.
 */
export function turnsFromMessages({
  data,
  invocationsByMsgId = {},
  ratingByMsgId = {},
}: StoredConversation): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of data) {
    const turn = turns.at(-1);
    if (message.role === 'user') {
      const startedAt = Date.parse(message.createdAt);
      turns.push({
        id: message.id,
        query: message.content,
        context: message.attachedContext ?? [],
        reply: settleAssistantTurn(startAssistantTurn(startedAt), { kind: 'stopped' }, startedAt),
      });
    } else if (turn) {
      const events: XyneAIEvent[] = [
        ...(invocationsByMsgId[message.id] ?? []).map(invocation => ({
          type: 'tool' as const,
          invocation,
        })),
        {
          type: 'complete',
          content: message.content,
          messageId: message.id,
          userMessageId: turn.id,
          followUps: message.followUpSuggestions ?? [],
          durationMs: message.durationMs,
          parts: decodeParts(message.parts),
        },
      ];
      const now = Date.parse(message.createdAt);
      turn.reply = {
        ...events.reduce(
          (reply, event) => reduceAssistantTurn(reply, event, now),
          startAssistantTurn(turn.reply.startedAt),
        ),
        rating: ratingByMsgId[message.id]?.rating ?? undefined,
      };
    }
  }
  return turns;
}
