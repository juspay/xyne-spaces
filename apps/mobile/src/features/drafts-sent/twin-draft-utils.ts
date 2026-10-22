import { stripDraftHtml, truncatePreview, type DraftMessageRow } from './drafts-sent-utils';

export type TwinDraftAction = 'react' | 'reply' | 'react_and_reply';

export type TwinDestinationKind =
  'origin_thread' | 'origin_channel' | 'channel' | 'thread' | 'dm_sender' | 'dm' | string;

/**
 * Owner-facing twin proposal parsed from `draft_messages.metadata`
 * (origin === 'twin'). `id` is always the Zero row id used for approve/decline.
 */
export type TwinReplyDraftView = {
  id: string;
  channelId: string;
  conversationId: string;
  action: TwinDraftAction;
  message?: string;
  emoji?: string;
  reasoning?: string;
  clawCitations?: Array<{ toolCallId: string; citations: unknown[] }>;
  clawCitationIcons?: Record<string, string>;
  destinationKind: TwinDestinationKind;
  destinationChannelName?: string;
  destinationUserName?: string;
  destinationReason?: string;
  sourceMessageId?: string;
  senderName?: string;
  channelName?: string;
  agentSlug?: string;
  sessionId?: string;
  createdAt: number;
};

type TwinMetadata = Partial<Omit<TwinReplyDraftView, 'id' | 'channelId' | 'createdAt'>> & {
  createdAt?: number;
  conversationId?: string;
};

const TWIN_ACTIONS = new Set<string>(['react', 'reply', 'react_and_reply']);

export const isTwinDraftRow = (row: { origin?: string | null }): boolean => row.origin === 'twin';

export const partitionUserDrafts = (
  rows: readonly DraftMessageRow[],
): { userDrafts: DraftMessageRow[]; twinDraftRows: DraftMessageRow[] } => {
  const userDrafts: DraftMessageRow[] = [];
  const twinDraftRows: DraftMessageRow[] = [];
  for (const row of rows) {
    if (isTwinDraftRow(row)) twinDraftRows.push(row);
    else userDrafts.push(row);
  }
  return { userDrafts, twinDraftRows };
};

const parseMetadata = (raw: unknown): TwinMetadata | null => {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as TwinMetadata;
      return null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw as TwinMetadata;
  return null;
};

export const rowToTwinReplyDraftView = (row: DraftMessageRow): TwinReplyDraftView | null => {
  if (!isTwinDraftRow(row)) return null;
  const meta = parseMetadata(row.metadata);
  if (!meta) return null;

  const conversationId = row.conversationId ?? meta.conversationId;
  if (!conversationId) return null;

  const action = TWIN_ACTIONS.has(String(meta.action)) ? (meta.action as TwinDraftAction) : 'reply';

  const sourceMessageId =
    typeof meta.sourceMessageId === 'string' && meta.sourceMessageId.trim().length > 0
      ? meta.sourceMessageId.trim()
      : typeof (row as { messageId?: unknown }).messageId === 'string' &&
          (row as { messageId: string }).messageId.trim().length > 0
        ? (row as { messageId: string }).messageId.trim()
        : undefined;

  return {
    id: row.id,
    channelId: row.channelId,
    conversationId,
    action,
    ...(meta.message !== undefined ? { message: meta.message } : {}),
    ...(meta.emoji !== undefined ? { emoji: meta.emoji } : {}),
    ...(meta.reasoning !== undefined ? { reasoning: meta.reasoning } : {}),
    ...(meta.clawCitations !== undefined ? { clawCitations: meta.clawCitations } : {}),
    ...(meta.clawCitationIcons !== undefined ? { clawCitationIcons: meta.clawCitationIcons } : {}),
    destinationKind: meta.destinationKind ?? 'origin_thread',
    ...(meta.destinationChannelName !== undefined
      ? { destinationChannelName: meta.destinationChannelName }
      : {}),
    ...(meta.destinationUserName !== undefined
      ? { destinationUserName: meta.destinationUserName }
      : {}),
    ...(meta.destinationReason !== undefined ? { destinationReason: meta.destinationReason } : {}),
    ...(sourceMessageId !== undefined ? { sourceMessageId } : {}),
    ...(meta.senderName !== undefined ? { senderName: meta.senderName } : {}),
    ...(meta.channelName !== undefined ? { channelName: meta.channelName } : {}),
    ...(meta.agentSlug !== undefined ? { agentSlug: meta.agentSlug } : {}),
    ...(meta.sessionId !== undefined ? { sessionId: meta.sessionId } : {}),
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : row.createdAt,
  };
};

export const twinDraftPreview = (view: TwinReplyDraftView, contentFallback = ''): string => {
  if (view.action === 'react') {
    return view.emoji ? `Reacts ${view.emoji}` : 'Twin reaction';
  }
  const fromMeta = stripDraftHtml(view.message ?? '');
  if (fromMeta.length > 0) return truncatePreview(fromMeta);
  const fromContent = stripDraftHtml(contentFallback);
  if (fromContent.length > 0) return truncatePreview(fromContent);
  return '(no message)';
};

export const compareTwinDrafts = (a: TwinReplyDraftView, b: TwinReplyDraftView): number => {
  const created = b.createdAt - a.createdAt;
  if (created !== 0) return created;
  return b.id.localeCompare(a.id);
};

export const listTwinDraftViews = (rows: readonly DraftMessageRow[]): TwinReplyDraftView[] =>
  rows
    .map(rowToTwinReplyDraftView)
    .filter((view): view is TwinReplyDraftView => view !== null)
    .sort(compareTwinDrafts);

export const formatTwinDestinationLabel = (view: TwinReplyDraftView): string => {
  switch (view.destinationKind) {
    case 'origin_channel':
      return view.channelName ? `Post to #${view.channelName}` : 'Post to channel';
    case 'channel':
      return view.destinationChannelName
        ? `Post to #${view.destinationChannelName}`
        : 'Post to channel';
    case 'thread':
      return view.destinationChannelName
        ? `Post to a thread in #${view.destinationChannelName}`
        : 'Post to a thread';
    case 'dm_sender':
      return view.senderName ? `Send as DM to ${view.senderName}` : 'Send as DM to sender';
    case 'dm':
      return view.destinationUserName ? `Send as DM to ${view.destinationUserName}` : 'Send as DM';
    case 'origin_thread':
    default:
      return 'Reply in this thread';
  }
};
