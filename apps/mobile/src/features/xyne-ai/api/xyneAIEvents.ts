import type { FlowDefinition } from '@xyne/shared';

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
  isError?: boolean;
  parentToolCallId?: string;
  citations?: BriefCitation[];
}

/** Mentioned users the run resolved, keyed by the tag the answer uses (`<Full Name>`). */
export type UserTags = Record<string, { name: string; userId: string }>;

/** A file the agent produced. `data` is base64 and only present on the live stream; a stored one has an `id` to download. */
export interface TurnAttachment {
  id: string | undefined;
  filename: string;
  mimeType: string;
  data: string | undefined;
  /** Set when the file is a generated React app, which opens on the dashboard instead. */
  app: { id: string; title: string } | undefined;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** A tool call the agent paused on until the user approves or declines it. */
export interface PendingAction {
  id: string;
  serverType: string;
  tool: string;
  params: Record<string, JsonValue>;
  signature: string;
  resolution: 'approved' | 'declined' | undefined;
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
  | { type: 'uiFlow'; flow: FlowDefinition }
  | {
      type: 'complete';
      content: string | undefined;
      messageId: string | undefined;
      userMessageId: string | undefined;
      followUps: string[];
      durationMs: number | undefined;
      /** The server's final parts; they replace the streamed ones. */
      parts: TurnPart[] | undefined;
      userTags: UserTags | undefined;
      attachments: TurnAttachment[];
      pendingActions: PendingAction[];
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

function decodeUserTags(value: unknown): UserTags | undefined {
  const tags = Object.entries(typeof value === 'object' && value !== null ? value : {}).filter(
    (entry): entry is [string, UserTags[string]] =>
      typeof entry[1]?.name === 'string' && typeof entry[1]?.userId === 'string',
  );
  return tags.length > 0 ? Object.fromEntries(tags) : undefined;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** Reads both the stream's (`fileName`, `data`) and the stored (`id`, `originalFilename`) shape. */
export function decodeAttachments(value: unknown): TurnAttachment[] {
  return (Array.isArray(value) ? value : []).flatMap((raw): TurnAttachment[] => {
    const item = record(raw);
    const manifest = record(record(item['metadata'])['reactArtifact']);
    const filename = text(item['fileName']) ?? text(item['originalFilename']);
    const mimeType = text(item['mimeType']);
    const appId = text(manifest['appId']);
    const isApp = Object.keys(manifest).length > 0;
    if (!filename || !mimeType || (isApp && !appId)) return [];
    return [
      {
        id: text(item['id']),
        filename,
        mimeType,
        data: isApp ? undefined : text(item['data']),
        app: appId ? { id: appId, title: text(manifest['title']) ?? filename } : undefined,
      },
    ];
  });
}

export function decodeUiFlows(value: unknown): FlowDefinition[] {
  return (Array.isArray(value) ? value : []).filter(
    (flow): flow is FlowDefinition => text(record(flow)['screenId']) !== undefined,
  );
}

export function decodePendingActions(value: unknown): PendingAction[] {
  return (Array.isArray(value) ? value : []).flatMap((raw): PendingAction[] => {
    const action = record(raw);
    const id = text(action['id']);
    const tool = text(action['tool']);
    const signature = text(action['signature']);
    const resolution = action['resolution'];
    return id && tool && signature
      ? [
          {
            id,
            tool,
            signature,
            serverType: text(action['serverType']) ?? '',
            params: record(action['params']) as PendingAction['params'],
            resolution:
              resolution === 'approved' || resolution === 'declined' ? resolution : undefined,
          },
        ]
      : [];
  });
}

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
    case 'ui_flow': {
      const [flow] = decodeUiFlows([data['flow']]);
      return flow ? { type: 'uiFlow', flow } : null;
    }
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
        userTags: decodeUserTags(
          data['userTags'] ?? (data['output'] as Record<string, unknown>)?.['userTags'],
        ),
        attachments: decodeAttachments(data['attachments']),
        pendingActions: decodePendingActions(data['pendingActions']),
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

const parseObject = (data: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * Decodes one `data:` frame. Heartbeats, malformed frames and event types the
 * app does not render yet return `null` instead of failing a long-running stream.
 */
export function decodeStreamEvent(data: string): XyneAIEvent | null {
  const frame = parseObject(data);
  return frame && toEvent(frame);
}

/** What the `/live` stream says about a run: its progress, and whether it is over. */
export interface LiveFrame {
  events: XyneAIEvent[];
  ended: boolean;
  /** The run so far, which replaces any live progress already shown. */
  isSnapshot?: true;
}

// The resumed run is a separate message, so its text gets its own parts instead of extending the paused answer.
const liveDelta = (type: 'text' | 'reasoning', value: unknown): XyneAIEvent[] => {
  const delta = text(value);
  return delta ? [{ type, delta, partId: `live-${type}` }] : [];
};

const liveTool = (invocation: unknown): XyneAIEvent[] => {
  const event = toEvent({ type: 'tool_invocation', toolInvocation: invocation });
  return event ? [event] : [];
};

/** Decodes one named event of `GET /xyne-ai/v2/conversations/:id/live`. */
export function decodeLiveEvent(name: string, data: string): LiveFrame {
  const frame = parseObject(data) ?? {};
  const progress = (events: XyneAIEvent[]): LiveFrame => ({ events, ended: false });
  switch (name) {
    case 'snapshot': {
      const partial = record(frame['partial']);
      const flows = record(frame['uiFlowsByMsgId'])[text(partial['msgId']) ?? ''];
      const inProgress = Array.isArray(frame['inProgress']) ? frame['inProgress'] : [];
      return {
        // Nothing partial and nothing running: no run is live.
        ended: !frame['partial'] && inProgress.length === 0,
        isSnapshot: true,
        events: [
          ...liveDelta('reasoning', partial['reasoning']),
          ...liveDelta('text', partial['content']),
          ...inProgress.flatMap(liveTool),
          ...decodeUiFlows(flows).map((flow): XyneAIEvent => ({ type: 'uiFlow', flow })),
        ],
      };
    }
    case 'delta':
      return progress([
        ...liveDelta('reasoning', frame['reasoningDelta']),
        ...liveDelta('text', frame['textDelta']),
      ]);
    case 'reasoning':
      return progress(liveDelta('reasoning', frame['delta'] ?? frame['reasoningDelta']));
    case 'invocation':
      return progress(liveTool(frame['toolInvocation']));
    case 'plan': {
      const event = toEvent({ ...frame, type: 'plan' });
      return progress(event ? [event] : []);
    }
    case 'ui-flow': {
      const event = toEvent({ type: 'ui_flow', flow: frame['flow'] });
      return progress(event ? [event] : []);
    }
    case 'done':
    case 'live-disabled':
      return { events: [], ended: true };
    default:
      return progress([]);
  }
}
