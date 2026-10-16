import type { FlowDefinition } from '@xyne/shared';

import type { StoredConversation } from '../api/xyneAIConversations';
import {
  decodeAttachments,
  decodeParts,
  decodePendingActions,
  decodeUiFlows,
  type PendingAction,
  type PlanTodo,
  type TurnAttachment,
  type ToolInvocation,
  type TurnPart,
  type UserTags,
  type XyneAIEvent,
} from '../api/xyneAIEvents';
import type { AttachedContextItem, AttachedFile } from '../api/xyneAIRequest';
import type { Rating } from '../api/xyneAIStream';
import { getAskAIErrorInfo, getTransportErrorInfo, type AskAIErrorInfo } from './askAIError';
import { mergeUiFlows } from './uiFlows';

export type TextPart = Extract<TurnPart, { type: 'text' }>;

export interface AssistantTurn {
  status: 'streaming' | 'complete' | 'stopped' | 'error';
  parts: TurnPart[];
  tools: ToolInvocation[];
  plan: { title: string | undefined; todos: PlanTodo[] } | undefined;
  uiFlows: FlowDefinition[];
  followUps: string[];
  userTags: UserTags | undefined;
  attachments: TurnAttachment[];
  pendingActions: PendingAction[];
  messageId: string | undefined;
  /** The server's id for the question this turn answers; a regenerated answer branches from it. */
  userMessageId: string | undefined;
  error: AskAIErrorInfo | undefined;
  startedAt: number;
  durationMs: number | undefined;
  rating: Rating | undefined;
}

export interface ChatTurn {
  id: string;
  /** The turn this one follows; turns sharing a parent are versions of one question. */
  parentId?: string | undefined;
  query: string;
  context: AttachedContextItem[];
  attachments: AttachedFile[];
  reply: AssistantTurn;
}

export const startAssistantTurn = (now: number): AssistantTurn => ({
  status: 'streaming',
  parts: [],
  tools: [],
  plan: undefined,
  uiFlows: [],
  followUps: [],
  userTags: undefined,
  attachments: [],
  pendingActions: [],
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

// A run that failed after thinking or a tool call stores its text only in `content`.
function withFallbackText(parts: TurnPart[], content: string | undefined): TurnPart[] {
  return !content?.trim() || parts.some(isShownText)
    ? parts
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
    case 'uiFlow':
      return { ...turn, uiFlows: mergeUiFlows(turn.uiFlows, event.flow) };
    case 'complete':
      return {
        ...turn,
        status: 'complete',
        parts: withFallbackText(
          event.parts ?? withFinalText(closeReasoning(turn.parts, now), event.content),
          event.content,
        ),
        userTags: event.userTags,
        attachments: event.attachments,
        pendingActions: event.pendingActions,
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

/** Conversations stored before branching have no parent links, so their turns form one chain. */
export const isBranched = ({ data }: StoredConversation): boolean =>
  data.some(message => message.parentId);

const ROOT = '';

/** The turns on screen: at each fork the chosen version, else the newest. */
export function activePath(turns: ChatTurn[], chosen: Record<string, string>): ChatTurn[] {
  const path: ChatTurn[] = [];
  let parentId = ROOT;
  for (;;) {
    const versions = turns.filter(turn => (turn.parentId ?? ROOT) === parentId);
    const next = versions.find(turn => turn.id === chosen[parentId]) ?? versions.at(-1);
    if (!next) return path;
    path.push(next);
    parentId = next.id;
  }
}

export const versionsOf = (turns: ChatTurn[], { parentId }: ChatTurn): ChatTurn[] =>
  turns.filter(turn => turn.parentId === parentId);

/**
 * Rebuilds the turns of a stored conversation. A question with several stored
 * answers (regenerated) shows the latest; an unanswered one shows as stopped.
 */
export function turnsFromMessages(stored: StoredConversation): ChatTurn[] {
  const { data, invocationsByMsgId = {}, ratingByMsgId = {} } = stored;
  const branched = isBranched(stored);
  const turns: ChatTurn[] = [];
  const turnOfAnswer = new Map<string, string>();
  for (const message of data) {
    const turn = branched ? turns.find(({ id }) => id === message.parentId) : turns.at(-1);
    if (message.role === 'user') {
      const startedAt = Date.parse(message.createdAt);
      turns.push({
        id: message.id,
        parentId: branched ? turnOfAnswer.get(message.parentId ?? '') : turns.at(-1)?.id,
        query: message.content,
        context: message.attachedContext ?? [],
        attachments: (message.attachments ?? []).map(({ id, originalFilename, mimeType }) => ({
          id,
          filename: originalFilename,
          mimeType,
        })),
        reply: settleAssistantTurn(startAssistantTurn(startedAt), { kind: 'stopped' }, startedAt),
      });
    } else if (turn) {
      turnOfAnswer.set(message.id, turn.id);
      const events: XyneAIEvent[] = [
        ...(invocationsByMsgId[message.id] ?? []).map(invocation => ({
          type: 'tool' as const,
          invocation,
        })),
        ...decodeUiFlows(message.uiFlows).map(flow => ({ type: 'uiFlow' as const, flow })),
        {
          type: 'complete',
          content: message.content,
          messageId: message.id,
          userMessageId: turn.id,
          followUps: message.followUpSuggestions ?? [],
          durationMs: message.durationMs,
          parts: decodeParts(message.parts),
          userTags: undefined,
          attachments: decodeAttachments(message.attachments),
          pendingActions: decodePendingActions(message.pendingActions),
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
