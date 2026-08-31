import type { TicketPriority, TicketStatusV2, MessageType } from '../zero/schema';

/**
 * Unified Parser/Serializer for activity metadata in Markdown format
 * Supports both reactions and thread replies
 */

// ============================================================================
// REACTIONS
// ============================================================================

export interface ReactionsData {
  [emojiName: string]: string[]; // emojiName -> array of userIds
}

const REACTIONS_BLOCK_START = ':::reactions';
const REACTIONS_BLOCK_END = ':::';

/**
 * Parse reactions_md Markdown string into structured data
 * Format:
 * :::reactions
 * 👍: [user-a, user-b, user-c]
 * 🔥: [user-d]
 * :::
 */
export function parseReactionsMd(md: string | null | undefined): ReactionsData {
  if (!md) return {};

  const data: ReactionsData = {};
  const lines = md.split('\n');
  let inReactionsBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === REACTIONS_BLOCK_START) {
      inReactionsBlock = true;
      continue;
    }

    if (trimmed === REACTIONS_BLOCK_END) {
      inReactionsBlock = false;
      continue;
    }

    if (inReactionsBlock && trimmed.includes(':')) {
      const separator = ': [';
      const separatorIndex = trimmed.lastIndexOf(separator);
      const splitIndex = separatorIndex >= 0 ? separatorIndex : trimmed.indexOf(':');
      const emoji = trimmed.slice(0, splitIndex).trim();
      const usersStr = trimmed.slice(splitIndex + 1).trim();

      const userIds = usersStr
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .map(u => u.trim())
        .filter(u => u.length > 0);

      if (emoji && userIds.length > 0) {
        data[emoji] = userIds;
      }
    }
  }

  return data;
}

/**
 * Serialize reactions data into Markdown format
 */
export function serializeReactionsMd(data: ReactionsData): string | null {
  const emojis = Object.keys(data);

  if (emojis.length === 0) {
    return null;
  }

  const lines = [REACTIONS_BLOCK_START];

  for (const emoji of emojis) {
    const userIds = data[emoji];
    if (userIds.length > 0) {
      lines.push(`${emoji}: [${userIds.join(', ')}]`);
    }
  }

  lines.push(REACTIONS_BLOCK_END);

  return lines.join('\n');
}

/**
 * Add a reaction to existing data (moves emoji to end for recency tracking)
 */
export function addReactionToData(
  data: ReactionsData,
  emojiName: string,
  userId: string
): ReactionsData {
  const newData: ReactionsData = {};

  for (const [emoji, userIds] of Object.entries(data)) {
    if (emoji !== emojiName) {
      newData[emoji] = userIds;
    }
  }

  const existingUserIds = data[emojiName] || [];
  if (!existingUserIds.includes(userId)) {
    newData[emojiName] = [...existingUserIds, userId];
  } else {
    newData[emojiName] = existingUserIds;
  }

  return newData;
}

/**
 * Remove a reaction from existing data
 */
export function removeReactionFromData(
  data: ReactionsData,
  emojiName: string,
  userId: string
): ReactionsData {
  const newData: ReactionsData = {};

  for (const [emoji, userIds] of Object.entries(data)) {
    if (emoji === emojiName) {
      const filtered = userIds.filter(id => id !== userId);
      if (filtered.length > 0) {
        newData[emoji] = filtered;
      }
    } else {
      newData[emoji] = userIds;
    }
  }

  return newData;
}

/**
 * Get the most recent emoji (last one in data)
 */
export function getMostRecentEmoji(data: ReactionsData): string | null {
  const emojis = Object.keys(data);
  return emojis.length > 0 ? emojis[emojis.length - 1] : null;
}

/**
 * Get unique reactor count across all emojis
 */
export function getUniqueReactorCount(data: ReactionsData): number {
  const allIds = Object.values(data).flat();
  return new Set(allIds).size;
}

// ============================================================================
// REPLIES
// ============================================================================

export interface RepliesData {
  repliers: string[]; // Ordered array (most recent last)
}

const REPLIES_BLOCK_START = ':::replies';
const REPLIES_BLOCK_END = ':::';

/**
 * Parse replies_md Markdown string into structured data
 * Format:
 * :::replies
 * [user-a, user-b, user-c]
 * :::
 */
export function parseRepliesMd(md: string | null | undefined): RepliesData {
  if (!md) return { repliers: [] };

  const lines = md.split('\n');
  let inRepliesBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === REPLIES_BLOCK_START) {
      inRepliesBlock = true;
      continue;
    }

    if (trimmed === REPLIES_BLOCK_END) {
      inRepliesBlock = false;
      continue;
    }

    if (inRepliesBlock && trimmed.startsWith('[')) {
      const content = trimmed
        .replace(/^\[/, '')
        .replace(/\]$/, '');

      const entries = content.split(',').map(e => e.trim()).filter(Boolean);
      const repliers = entries
        .map(entry => {
          const colonIndex = entry.indexOf(':');
          return (colonIndex > 0 ? entry.slice(0, colonIndex) : entry).trim();
        })
        .filter(Boolean);

      return { repliers };
    }
  }

  return { repliers: [] };
}

/**
 * Serialize replies data into Markdown format
 */
export function serializeRepliesMd(data: RepliesData): string | null {
  if (data.repliers.length === 0) {
    return null;
  }

  const entries = data.repliers.join(', ');

  return [REPLIES_BLOCK_START, `[${entries}]`, REPLIES_BLOCK_END].join('\n');
}

/**
 * Add a replier to existing data (moves user to end for recency tracking)
 */
export function addReplyToData(
  data: RepliesData,
  userId: string
): RepliesData {
  const filtered = data.repliers.filter(id => id !== userId);
  return { repliers: [...filtered, userId] };
}

/**
 * Remove a replier from existing data
 */
export function removeReplyFromData(data: RepliesData, userId: string): RepliesData {
  return { repliers: data.repliers.filter(id => id !== userId) };
}

// ==========================================================================
// TICKET CARD SNAPSHOT
// ==========================================================================

export interface TicketCardSummary {
  id: string;
  title?: string | null;
  description?: string | null;
  statusV2?: TicketStatusV2 | null;
  priority?: TicketPriority | null;
  assignedTo?: string | null;
  createdBy?: string | null;
  createdAt?: number | null;
  eta?: number | null;
  xyneId?: string | null;
  stageName?: string | null;
  ticketType?: string | null;
  channelId?: string | null;
  conversationId?: string | null;
}

const TICKET_BLOCK_START = ':::ticket';
const TICKET_BLOCK_END = ':::';

const escapeTicketMdValue = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
};

const unescapeTicketMdValue = (value: string): string => {
  return value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
};

export function parseTicketMd(md: string | null | undefined): TicketCardSummary | null {
  if (!md) return null;

  const lines = md.split('\n');
  let inTicketBlock = false;
  const summary: Partial<TicketCardSummary> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === TICKET_BLOCK_START) {
      inTicketBlock = true;
      continue;
    }

    if (trimmed === TICKET_BLOCK_END) {
      inTicketBlock = false;
      continue;
    }

    if (!inTicketBlock || !trimmed.includes(':')) {
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();
    const value = unescapeTicketMdValue(rawValue);

    switch (key) {
      case 'id':
        summary.id = value;
        break;
      case 'title':
        summary.title = value;
        break;
      case 'description':
        summary.description = value;
        break;
      case 'statusV2':
        summary.statusV2 = value as TicketStatusV2;
        break;
      case 'priority':
        summary.priority = value as TicketPriority;
        break;
      case 'assignedTo':
        summary.assignedTo = value;
        break;
      case 'createdBy':
        summary.createdBy = value;
        break;
      case 'createdAt': {
        const parsed = Number(value);
        summary.createdAt = Number.isNaN(parsed) ? null : parsed;
        break;
      }
      case 'eta': {
        const parsed = Number(value);
        summary.eta = Number.isNaN(parsed) ? null : parsed;
        break;
      }
      case 'xyneId':
        summary.xyneId = value;
        break;
      case 'stageName':
        summary.stageName = value;
        break;
      case 'ticketType':
        summary.ticketType = value;
        break;
      case 'channelId':
        summary.channelId = value;
        break;
      case 'conversationId':
        summary.conversationId = value;
        break;
      default:
        break;
    }
  }

  if (!summary.id) return null;

  return summary as TicketCardSummary;
}

export function serializeTicketMd(summary: TicketCardSummary | null | undefined): string | null {
  if (!summary || !summary.id) return null;

  const lines: string[] = [TICKET_BLOCK_START];
  const entries: Array<[string, string | number | null | undefined]> = [
    ['id', summary.id],
    ['title', summary.title],
    ['description', summary.description],
    ['statusV2', summary.statusV2],
    ['priority', summary.priority],
    ['assignedTo', summary.assignedTo],
    ['createdBy', summary.createdBy],
    ['createdAt', summary.createdAt],
    ['eta', summary.eta],
    ['xyneId', summary.xyneId],
    ['stageName', summary.stageName],
    ['ticketType', summary.ticketType],
    ['channelId', summary.channelId],
    ['conversationId', summary.conversationId],
  ];

  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    const valueString = escapeTicketMdValue(String(value));
    lines.push(`${key}: ${valueString}`);
  }

  lines.push(TICKET_BLOCK_END);
  return lines.join('\n');
}

// ==========================================================================
// SUB-TICKETS SNAPSHOT
// ==========================================================================

export interface SubTicketsMdData {
  total: number;
  items: TicketCardSummary[];
}

const SUBTICKETS_META_BLOCK_START = ':::subtickets';

export const SUB_TICKETS_MD_LIMIT = 5;

export function parseSubTicketsMd(md: string | null | undefined): SubTicketsMdData {
  if (!md) return { total: 0, items: [] };

  const lines = md.split('\n');
  const items: TicketCardSummary[] = [];
  let total = 0;
  let inMetaBlock = false;
  let currentBlock: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === SUBTICKETS_META_BLOCK_START) {
      inMetaBlock = true;
      continue;
    }

    if (trimmed === TICKET_BLOCK_START) {
      currentBlock = [TICKET_BLOCK_START];
      continue;
    }

    if (trimmed === TICKET_BLOCK_END) {
      if (currentBlock) {
        currentBlock.push(TICKET_BLOCK_END);
        const summary = parseTicketMd(currentBlock.join('\n'));
        if (summary) items.push(summary);
        currentBlock = null;
      }
      inMetaBlock = false;
      continue;
    }

    if (currentBlock) {
      currentBlock.push(line);
      continue;
    }

    if (inMetaBlock && trimmed.startsWith('total:')) {
      const parsed = Number(trimmed.slice('total:'.length).trim());
      if (!Number.isNaN(parsed)) total = parsed;
    }
  }

  return { total: Math.max(total, items.length), items };
}

export function serializeSubTicketsMd(
  total: number,
  summaries: TicketCardSummary[],
): string | null {
  if (total <= 0) return null;

  const parts: string[] = [SUBTICKETS_META_BLOCK_START, `total: ${total}`, TICKET_BLOCK_END];
  for (const summary of summaries.slice(0, SUB_TICKETS_MD_LIMIT)) {
    const block = serializeTicketMd(summary);
    if (block) parts.push(block);
  }
  return parts.join('\n');
}

/**
 * Get unique replier count
 */
export function getUniqueReplierCount(data: RepliesData): number {
  return new Set(data.repliers).size;
}

/**
 * Get the most recent replier user ID
 */
export function getMostRecentReplier(data: RepliesData): string | null {
  return data.repliers[data.repliers.length - 1] || null;
}

// ==========================================================================
// INITIAL MESSAGE SNAPSHOT
// ==========================================================================

export interface InitialMessageSummary {
  messageId: string;
  conversationId: string;
  workspaceId?: string | null;
  senderId: string;
  content: string;
  msgType: MessageType;
  hasAttachment: boolean;
  edited: boolean;
  isDeleted: boolean;
  showInChannel: boolean;
  visibleTo?: string | null;
  createdAt: number;
  metadata?: string | null; // JSON stringified
  nudgeCount?: number | null;
  isSent: boolean;
  reactions_md?: string | null;
  link_preview_md?: string | null;
  childConversationId?: string | null;
}

const INITIAL_MESSAGE_BLOCK_START = ':::initialMessage';
const INITIAL_MESSAGE_BLOCK_END = ':::';

const escapeMessageMdValue = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
};

const unescapeMessageMdValue = (value: string): string => {
  return value.replace(/\\(\\|n|r)/g, (_, ch) => {
    if (ch === '\\') return '\\';
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    return ch;
  });
};

export function parseInitialMessageMd(md: string | null | undefined): InitialMessageSummary | null {
  if (!md) return null;

  const lines = md.split('\n');
  let inBlock = false;
  const summary: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === INITIAL_MESSAGE_BLOCK_START) {
      inBlock = true;
      continue;
    }

    if (trimmed === INITIAL_MESSAGE_BLOCK_END) {
      inBlock = false;
      continue;
    }

    if (!inBlock || !trimmed.includes(':')) {
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();
    summary[key] = unescapeMessageMdValue(rawValue);
  }

  if (!summary['messageId']) return null;

  return {
    messageId: summary['messageId'],
    conversationId: summary['conversationId'] ?? '',
    workspaceId: summary['workspaceId'] || null,
    senderId: summary['senderId'] ?? '',
    content: summary['content'] ?? '',
    msgType: (summary['msgType'] as MessageType) ?? 'USER',
    hasAttachment: summary['hasAttachment'] === 'true',
    edited: summary['edited'] === 'true',
    isDeleted: summary['isDeleted'] === 'true',
    showInChannel: summary['showInChannel'] === 'true',
    visibleTo: summary['visibleTo'] || null,
    createdAt: Number(summary['createdAt']) || 0,
    metadata: summary['metadata'] || null,
    nudgeCount: summary['nudgeCount'] ? Number(summary['nudgeCount']) : null,
    isSent: summary['isSent'] !== 'false',
    reactions_md: summary['reactions_md'] || null,
    link_preview_md: summary['link_preview_md'] || null,
    childConversationId: summary['childConversationId'] || null,
  };
}

export function serializeInitialMessageMd(
  summary: InitialMessageSummary | null | undefined,
): string | null {
  if (!summary || !summary.messageId) return null;

  const lines: string[] = [INITIAL_MESSAGE_BLOCK_START];
  const entries: Array<[string, string | number | boolean | null | undefined]> = [
    ['messageId', summary.messageId],
    ['conversationId', summary.conversationId],
    ['workspaceId', summary.workspaceId],
    ['senderId', summary.senderId],
    ['content', summary.content],
    ['msgType', summary.msgType],
    ['hasAttachment', summary.hasAttachment],
    ['edited', summary.edited],
    ['isDeleted', summary.isDeleted],
    ['showInChannel', summary.showInChannel],
    ['visibleTo', summary.visibleTo],
    ['createdAt', summary.createdAt],
    ['metadata', summary.metadata],
    ['nudgeCount', summary.nudgeCount],
    ['isSent', summary.isSent],
    ['reactions_md', summary.reactions_md],
    ['link_preview_md', summary.link_preview_md],
    ['childConversationId', summary.childConversationId],
  ];

  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    const valueString = escapeMessageMdValue(String(value));
    lines.push(`${key}: ${valueString}`);
  }

  lines.push(INITIAL_MESSAGE_BLOCK_END);
  return lines.join('\n');
}

// ==========================================================================
// PARENT MESSAGE SNAPSHOT
// ==========================================================================

export type ConversationAnchorType = 'THREAD_REPLY' | 'SUBTICKET';

export interface ParentMessageSummary {
  messageId: string;
  conversationId?: string | null;
  channelId?: string | null;
  senderId: string;
  content: string;
  msgType: MessageType;
  createdAt: number;
  anchorType?: ConversationAnchorType | null;
}

export const resolveConversationAnchorType = (
  summary: Pick<ParentMessageSummary, 'anchorType'> | null | undefined,
): ConversationAnchorType => summary?.anchorType ?? 'THREAD_REPLY';

const PARENT_MESSAGE_BLOCK_START = ':::parentMessage';
const PARENT_MESSAGE_BLOCK_END = ':::';

export function parseParentMessageMd(md: string | null | undefined): ParentMessageSummary | null {
  if (!md) return null;

  const lines = md.split('\n');
  let inBlock = false;
  const summary: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === PARENT_MESSAGE_BLOCK_START) {
      inBlock = true;
      continue;
    }

    if (trimmed === PARENT_MESSAGE_BLOCK_END) {
      inBlock = false;
      continue;
    }

    if (!inBlock || !trimmed.includes(':')) {
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();
    summary[key] = unescapeMessageMdValue(rawValue);
  }

  if (!summary['messageId']) return null;

  return {
    messageId: summary['messageId'],
    conversationId: summary['conversationId'] || null,
    channelId: summary['channelId'] || null,
    senderId: summary['senderId'] ?? '',
    content: summary['content'] ?? '',
    msgType: (summary['msgType'] as MessageType) ?? 'USER',
    createdAt: Number(summary['createdAt']) || 0,
    anchorType: (summary['anchorType'] as ConversationAnchorType) || null,
  };
}

export function serializeParentMessageMd(
  summary: ParentMessageSummary | null | undefined,
): string | null {
  if (!summary || !summary.messageId) return null;

  const lines: string[] = [PARENT_MESSAGE_BLOCK_START];
  const entries: Array<[string, string | number | null | undefined]> = [
    ['messageId', summary.messageId],
    ['conversationId', summary.conversationId],
    ['channelId', summary.channelId],
    ['senderId', summary.senderId],
    ['content', summary.content],
    ['msgType', summary.msgType],
    ['createdAt', summary.createdAt],
    ['anchorType', summary.anchorType],
  ];

  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    const valueString = escapeMessageMdValue(String(value));
    lines.push(`${key}: ${valueString}`);
  }

  lines.push(PARENT_MESSAGE_BLOCK_END);
  return lines.join('\n');
}
