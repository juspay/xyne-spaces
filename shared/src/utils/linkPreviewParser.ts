// ==========================================================================
// MESSAGE PREVIEW (internal link preview)
// ==========================================================================

/**
 * Serialized ticket snapshot stored inside link_preview_md.
 * Dates are ISO-8601 strings (not epoch numbers) because the backend
 * converts them via `.toISOString()` before embedding in the markdown block.
 */
export interface TicketPreviewSnapshot {
  id: string;
  title: string;
  description: string;
  statusV2: string;
  priority: string;
  xyneId: string;
  createdBy: string;
  assignedTo?: string | null;
  eta?: string | null;
  conversationId: string;
  channelId: string;
  stageName: string;
  projectId: string;
  boardId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessagePreviewAttachment {
  id: string;
  entityType: string;
  entityId: string;
  storageProvider: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  width?: number | null;
  height?: number | null;
  uploadedByUserId: string;
  createdAt: number;
  url: string;
  createdBy: string;
  metadata?: Record<string, unknown> | null;
  conversationId?: string | null;
  thumbnailUrl?: string | null;
}

export interface MessagePreviewData {
  url: string;
  messageId: string;
  channelId: string;
  channelName: string;
  channelScopeType?: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  timestamp: string;
  replyCount?: number;
  isDeleted?: boolean;
  hasAttachment?: boolean;
  attachments?: MessagePreviewAttachment[];
  nestedLinkPreview?: Record<string, unknown>;
  ticket?: TicketPreviewSnapshot;
}

const MESSAGE_PREVIEW_BLOCK_START = ':::message_preview';
const MESSAGE_PREVIEW_BLOCK_END = ':::';

const escapePreviewValue = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
};

const unescapePreviewValue = (value: string): string => {
  return value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
};

/**
 * Parse link_preview_md Markdown string into structured data.
 *
 * Format:
 * :::message_preview
 * url: https://spaces.xyne.juspay.net/chat/dir/ch123#origin=conv456
 * messageId: msg789
 * channelId: ch123
 * channelName: general
 * senderId: user-abc
 * senderName: John Doe
 * content: Hey check this out...
 * timestamp: 2026-03-25T10:00:00Z
 * replyCount: 3
 * isDeleted: false
 * hasAttachment: true
 * attachments: [{"id":"att1",...}]
 * nestedLinkPreview: {"title":"..."}
 * ticket: {"id":"t1",...}
 * :::
 */
export function parseMessagePreviewMd(md: string | null | undefined): MessagePreviewData | null {
  if (!md) return null;

  const lines = md.split('\n');
  let inBlock = false;
  const data: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === MESSAGE_PREVIEW_BLOCK_START) {
      inBlock = true;
      continue;
    }

    if (inBlock && trimmed === MESSAGE_PREVIEW_BLOCK_END) {
      inBlock = false;
      continue;
    }

    if (!inBlock || !trimmed.includes(':')) continue;

    const colonIndex = trimmed.indexOf(':');
    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();
    data[key] = rawValue;
  }

  if (!data['messageId'] || !data['url']) return null;

  const result: MessagePreviewData = {
    url: unescapePreviewValue(data['url']),
    messageId: data['messageId'],
    channelId: data['channelId'] || '',
    channelName: unescapePreviewValue(data['channelName'] || ''),
    senderId: data['senderId'] || '',
    senderName: unescapePreviewValue(data['senderName'] || ''),
    content: unescapePreviewValue(data['content'] || ''),
    timestamp: data['timestamp'] || '',
  };

  if (data['channelScopeType']) result.channelScopeType = data['channelScopeType'];
  if (data['senderAvatar']) result.senderAvatar = data['senderAvatar'];
  if (data['replyCount'] !== undefined) {
    const n = Number(data['replyCount']);
    if (!Number.isNaN(n)) result.replyCount = n;
  }
  if (data['isDeleted']) result.isDeleted = data['isDeleted'] === 'true';
  if (data['hasAttachment']) result.hasAttachment = data['hasAttachment'] === 'true';

  if (data['attachments']) {
    try { result.attachments = JSON.parse(data['attachments']); } catch { /* ignore */ }
  }
  if (data['nestedLinkPreview']) {
    try { result.nestedLinkPreview = JSON.parse(data['nestedLinkPreview']); } catch { /* ignore */ }
  }
  if (data['ticket']) {
    try { result.ticket = JSON.parse(data['ticket']); } catch { /* ignore */ }
  }

  return result;
}

/**
 * Serialize message preview data into Markdown format
 */
export function serializeMessagePreviewMd(data: MessagePreviewData | null | undefined): string | null {
  if (!data || !data.messageId || !data.url) return null;

  const lines: string[] = [MESSAGE_PREVIEW_BLOCK_START];

  const stringEntries: Array<[string, string | undefined]> = [
    ['url', data.url],
    ['messageId', data.messageId],
    ['channelId', data.channelId],
    ['channelName', data.channelName],
    ['channelScopeType', data.channelScopeType],
    ['senderId', data.senderId],
    ['senderName', data.senderName],
    ['senderAvatar', data.senderAvatar],
    ['content', data.content],
    ['timestamp', data.timestamp],
  ];

  for (const [key, value] of stringEntries) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}: ${escapePreviewValue(String(value))}`);
  }

  if (data.replyCount !== undefined && data.replyCount !== null) {
    lines.push(`replyCount: ${data.replyCount}`);
  }
  if (data.isDeleted !== undefined) {
    lines.push(`isDeleted: ${data.isDeleted}`);
  }
  if (data.hasAttachment !== undefined) {
    lines.push(`hasAttachment: ${data.hasAttachment}`);
  }
  if (data.attachments && data.attachments.length > 0) {
    lines.push(`attachments: ${JSON.stringify(data.attachments)}`);
  }
  if (data.nestedLinkPreview) {
    lines.push(`nestedLinkPreview: ${JSON.stringify(data.nestedLinkPreview)}`);
  }
  if (data.ticket) {
    lines.push(`ticket: ${JSON.stringify(data.ticket)}`);
  }

  lines.push(MESSAGE_PREVIEW_BLOCK_END);
  return lines.join('\n');
}

// ==========================================================================
// LINK PREVIEW (external OG link preview)
// ==========================================================================

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  favicon?: string;
}

const LINK_PREVIEW_BLOCK_START = ':::link_preview';
const LINK_PREVIEW_BLOCK_END = ':::';

/**
 * Parse link_preview_md Markdown string for external link previews.
 *
 * Format:
 * :::link_preview
 * url: https://github.com/some/repo
 * title: Some Repo - GitHub
 * description: A cool repository
 * siteName: GitHub
 * image: https://opengraph.github.com/...
 * favicon: https://github.com/favicon.ico
 * :::
 */
export function parseLinkPreviewMd(md: string | null | undefined): LinkPreviewData | null {
  if (!md) return null;

  const lines = md.split('\n');
  let inBlock = false;
  const data: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === LINK_PREVIEW_BLOCK_START) {
      inBlock = true;
      continue;
    }

    if (inBlock && trimmed === LINK_PREVIEW_BLOCK_END) {
      inBlock = false;
      continue;
    }

    if (!inBlock || !trimmed.includes(':')) continue;

    const colonIndex = trimmed.indexOf(':');
    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();
    data[key] = rawValue;
  }

  if (!data['url']) return null;

  const result: LinkPreviewData = {
    url: unescapePreviewValue(data['url']),
  };

  if (data['title']) result.title = unescapePreviewValue(data['title']);
  if (data['description']) result.description = unescapePreviewValue(data['description']);
  if (data['siteName']) result.siteName = unescapePreviewValue(data['siteName']);
  if (data['image']) result.image = data['image'];
  if (data['favicon']) result.favicon = data['favicon'];

  return result;
}

/**
 * Serialize external link preview data into Markdown format
 */
export function serializeLinkPreviewMd(data: LinkPreviewData | null | undefined): string | null {
  if (!data || !data.url) return null;

  const lines: string[] = [LINK_PREVIEW_BLOCK_START];

  const entries: Array<[string, string | undefined]> = [
    ['url', data.url],
    ['title', data.title],
    ['description', data.description],
    ['siteName', data.siteName],
    ['image', data.image],
    ['favicon', data.favicon],
  ];

  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}: ${escapePreviewValue(String(value))}`);
  }

  lines.push(LINK_PREVIEW_BLOCK_END);
  return lines.join('\n');
}

// ==========================================================================
// UNIFIED PREVIEW PARSER (reads link_preview_md column)
// ==========================================================================

export type PreviewMdResult =
  | { type: 'message_preview'; data: MessagePreviewData }
  | { type: 'link_preview'; data: LinkPreviewData };

/**
 * Parse the link_preview_md column, auto-detecting the block type.
 * Returns a discriminated union so the consumer knows which preview to render.
 */
export function parsePreviewMd(md: string | null | undefined): PreviewMdResult | null {
  if (!md) return null;

  if (md.includes(MESSAGE_PREVIEW_BLOCK_START)) {
    const data = parseMessagePreviewMd(md);
    return data ? { type: 'message_preview', data } : null;
  }

  if (md.includes(LINK_PREVIEW_BLOCK_START)) {
    const data = parseLinkPreviewMd(md);
    return data ? { type: 'link_preview', data } : null;
  }

  return null;
}

/**
 * Convert a TicketPreviewSnapshot (ISO-string dates) into a Ticket-compatible
 * object (epoch-number dates) for rendering in TicketCard.
 *
 * Missing fields that exist on the full Ticket type are filled with safe
 * defaults so the component doesn't crash.
 */
export function ticketSnapshotToTicket(snapshot: TicketPreviewSnapshot): Record<string, unknown> {
  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt).getTime(),
    updatedAt: new Date(snapshot.updatedAt).getTime(),
    eta: snapshot.eta ? new Date(snapshot.eta).getTime() : undefined,
    // Fields not stored in the snapshot — provide safe defaults
    status: snapshot.statusV2,
    updatedBy: snapshot.createdBy,
    statusUpdatedAt: new Date(snapshot.updatedAt).getTime(),
    userGroupId: '',
    isArchived: false,
  };
}
