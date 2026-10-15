import type { BriefCitation } from '@/src/features/morning-brief/api/dailyBriefApi';

export interface PlanTodo {
  id?: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface ToolInvocation {
  toolName: string;
  toolCallId?: string;
  args: Record<string, unknown>;
  result?: string;
  /** `stopped` is client-side: a call still running when its turn ended never got an end frame. */
  status: 'running' | 'completed' | 'error' | 'stopped';
  durationMs: number;
  isError?: boolean;
  subagentName?: string;
  parentToolCallId?: string;
  citations?: BriefCitation[];
}

/** The turn in the order the agent produced it; tool parts point at an invocation by id. */
export type TurnPart =
  | { type: 'reasoning'; id: string; text: string; startedAt?: number; endedAt?: number }
  | { type: 'text'; id: string; text: string; superseded?: true }
  | { type: 'tool'; id: string };

export type XyneAIEvent =
  | { type: 'start'; sessionId: string | undefined; traceId: string | undefined }
  | { type: 'text'; delta: string; partId: string | undefined }
  | { type: 'reasoning'; delta: string; partId: string | undefined }
  | { type: 'tool'; invocation: ToolInvocation }
  | { type: 'plan'; title: string | undefined; todos: PlanTodo[] }
  | {
      type: 'complete';
      content: string | undefined;
      messageId: string | undefined;
      userMessageId: string | undefined;
      followUps: string[];
      durationMs: number | undefined;
      /** The server's final parts; they replace the streamed ones. */
      parts: TurnPart[] | undefined;
    }
  | { type: 'followUps'; suggestions: string[] }
  | { type: 'error'; message: string | undefined; httpStatus: number | undefined };

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const number = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : undefined;

const suggestions = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];

const time = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? undefined : parsed;
};

function toPart(raw: unknown): TurnPart | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const part = raw as Record<string, unknown>;
  const id = text(part['id']);
  const body = typeof part['text'] === 'string' ? part['text'] : undefined;
  if (!id) return null;
  switch (part['type']) {
    case 'tool':
      return { type: 'tool', id };
    case 'text':
      return body === undefined
        ? null
        : {
            type: 'text',
            id,
            text: body,
            ...(part['superseded'] === true && { superseded: true }),
          };
    case 'reasoning': {
      const startedAt = time(part['startedAt']);
      const endedAt = time(part['endedAt']);
      return body === undefined
        ? null
        : {
            type: 'reasoning',
            id,
            text: body,
            ...(startedAt !== undefined && { startedAt }),
            ...(endedAt !== undefined && { endedAt }),
          };
    }
    default:
      return null;
  }
}

export const decodeParts = (value: unknown): TurnPart[] | undefined => {
  const parsed = Array.isArray(value) ? value.map(toPart).filter(part => part !== null) : [];
  return parsed.length > 0 ? parsed : undefined;
};

// The agent runs these tools to produce follow-up suggestions; they are not part of the answer.
const isFollowUpTool = ({ toolName, args }: ToolInvocation): boolean =>
  toolName === 'internal-follow-up-diagnostics' ||
  (toolName === 'ask-user-question' && args['purpose'] === 'follow_up_suggestions');

function toEvent(data: Record<string, unknown>): XyneAIEvent | null {
  switch (data['type']) {
    case 'start':
      return { type: 'start', sessionId: text(data['sessionId']), traceId: text(data['traceId']) };
    case 'delta':
    case 'content': {
      const delta = text(data['content']);
      return delta ? { type: 'text', delta, partId: text(data['partId']) } : null;
    }
    case 'reasoning_delta': {
      const delta = text(data['reasoningDelta']);
      return delta ? { type: 'reasoning', delta, partId: text(data['partId']) } : null;
    }
    case 'tool_invocation': {
      const invocation = data['toolInvocation'] as ToolInvocation | undefined;
      return invocation && text(invocation.toolName) && !isFollowUpTool(invocation)
        ? { type: 'tool', invocation }
        : null;
    }
    case 'plan':
      return Array.isArray(data['todos'])
        ? { type: 'plan', title: text(data['title']), todos: data['todos'] as PlanTodo[] }
        : null;
    case 'complete':
    case 'done':
      return {
        type: 'complete',
        content: text(data['content']),
        messageId: text(data['messageId']),
        userMessageId: text(data['userMessageId']),
        followUps: suggestions(data['followUpSuggestions']),
        durationMs: number(data['durationMs']),
        parts: decodeParts(data['parts']),
      };
    case 'follow_ups':
      return { type: 'followUps', suggestions: suggestions(data['followUpSuggestions']) };
    case 'error':
      return {
        type: 'error',
        message: text(data['error']),
        httpStatus: number(data['httpStatus']) ?? number(data['statusCode']),
      };
    default:
      return null;
  }
}

/**
 * Decodes one `data:` frame. Heartbeats, malformed frames and event types the
 * app does not render yet return `null` instead of failing a long-running stream.
 */
export function decodeStreamEvent(data: string): XyneAIEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? toEvent(parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
