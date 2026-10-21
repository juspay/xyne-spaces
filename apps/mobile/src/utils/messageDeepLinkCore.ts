export type DeepLinkScopePayload = {
  /** Optional organization segment the web app puts *above* the workspace
   *  (`/<orgId>/<workspaceId>/chat/dir/...`). */
  orgId?: string;
  /** Optional workspace the target lives in — the scope segment adjacent to
   *  `chat/dir`. */
  workspaceId?: string;
};

export type MessageDeepLinkPayload = DeepLinkScopePayload & {
  channelId: string;
  threadId?: string;
  origin?: string;
  messageId?: string;
  createdAt?: number;
  surface?: 'channels' | 'dms';
  scopeType?: string;
  openStartedAtMs?: number;
};

/** Native ticket tabs. Web `details` maps to overview. */
export type TicketDeepLinkTab = 'overview' | 'thread';

/**
 * Web ticket-detail URL. Dashboard emits:
 *   /chat/dir/<channelId>/<conversationId>/<ticketId>?selectedTab=details|thread
 * Distinct from a message link, which has at most one segment after channelId.
 */
export type TicketDeepLinkPayload = DeepLinkScopePayload & {
  channelId: string;
  conversationId: string;
  ticketId: string;
  selectedTab: TicketDeepLinkTab;
};

type MessageLinkParams = Pick<
  MessageDeepLinkPayload,
  'origin' | 'messageId' | 'createdAt' | 'surface' | 'scopeType'
>;

// Message deep-link path. Accepts UP TO TWO optional leading scope segments so that
// the scoped links the web app emits resolve when opened in-app:
//   /chat/dir/<channelId>[/<threadId>]                        (bare)
//   /<workspaceId>/chat/dir/<channelId>[/<threadId>]          (workspace-scoped)
//   /<orgId>/<workspaceId>/chat/dir/<channelId>[/<threadId>]  (org + workspace)
// The workspace is the scope segment ADJACENT to `chat/dir`: two links to the same
// channel, one of each scoped shape, share only that segment, and a channel lives in
// exactly one workspace. So the last leading segment is the workspace and the first
// of two is the organization above it. channelId alone still fully resolves the
// target, so both scope segments stay optional. Three or more leading segments are
// rejected. Origin must already be trusted (callers canonicalize first).
const CHAT_DIR_PATH = /^\/(?:([^/?#]+)\/)?(?:([^/?#]+)\/)?chat\/dir\/([^/?#]+)(?:\/([^/?#]+))?\/?$/;

// Ticket-detail path: exactly three segments after `chat/dir`. Same leading-scope
// rules as CHAT_DIR_PATH. Dashboard (see morning-brief citations) orders them
// channel / conversation / ticket, with selectedTab choosing the ticket panel.
const TICKET_CHAT_DIR_PATH =
  /^\/(?:([^/?#]+)\/)?(?:([^/?#]+)\/)?chat\/dir\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)\/?$/;

function extractLinkParams(raw: string): MessageLinkParams {
  const value = raw.replace(/^[?#]/, '');
  if (!value) return {};
  const params = new URLSearchParams(value);
  const out: MessageLinkParams = {};
  const origin = params.get('origin');
  if (origin !== null) out.origin = origin;
  const messageId = params.get('messageId');
  if (messageId !== null) out.messageId = messageId;
  const createdAt = Number(params.get('createdAt'));
  if (Number.isFinite(createdAt) && createdAt > 0) out.createdAt = createdAt;
  const surface = params.get('surface');
  if (surface === 'channels' || surface === 'dms') out.surface = surface;
  const scopeType = params.get('scopeType');
  if (scopeType !== null) out.scopeType = scopeType;
  return out;
}

function decodePathIdentifier(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded) return null;
    for (const character of decoded) {
      const code = character.charCodeAt(0);
      if (
        code <= 0x1f ||
        code === 0x7f ||
        character === '/' ||
        character === '?' ||
        character === '#'
      ) {
        return null;
      }
    }
    return decoded;
  } catch {
    return null;
  }
}

function mergeLinkParam<T>(fragment: T | undefined, query: T | undefined): T | null | undefined {
  if (fragment === undefined) return query;
  if (query === undefined || fragment === query) return fragment;
  return null;
}

function resolveTicketSelectedTab(raw: string | null): TicketDeepLinkTab {
  if (raw === 'thread' || raw === 'messages') return 'thread';
  return 'overview';
}

function parseAppUrl(rawUrl: string, appScheme: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol.toLowerCase() !== `${appScheme.toLowerCase()}:`) return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  if (parsed.hostname && parsed.hostname !== 'chat') return null;

  const pathname = parsed.pathname.startsWith('/') ? parsed.pathname : `/${parsed.pathname}`;
  const normalizedPath = parsed.hostname ? `/${parsed.hostname}${pathname}` : pathname;
  try {
    return new URL(`${normalizedPath}${parsed.search}${parsed.hash}`, 'https://app-link.local');
  } catch {
    return null;
  }
}

function parseTrustedDeepLinkUrl(
  url: string,
  trustedOrigins: ReadonlySet<string>,
  appSchemes: readonly string[] = ['xyne-spaces'],
): URL | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const appScheme = appSchemes.find(scheme =>
    trimmed.toLowerCase().startsWith(`${scheme.toLowerCase()}:`),
  );
  if (appScheme) {
    return parseAppUrl(trimmed, appScheme);
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    if (!trustedOrigins.has(parsed.origin)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function decodeChatDirScope(
  match: RegExpMatchArray,
): (DeepLinkScopePayload & { channelId: string }) | null {
  const firstScope = decodePathIdentifier(match[1]);
  const secondScope = decodePathIdentifier(match[2]);
  const orgId = secondScope === undefined ? undefined : firstScope;
  const workspaceId = secondScope === undefined ? firstScope : secondScope;
  const channelId = decodePathIdentifier(match[3]);
  if (!channelId || workspaceId === null || orgId === null) return null;
  return {
    channelId,
    ...(orgId !== undefined ? { orgId } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {}),
  };
}

export function parseMessageDeepLinkCore(
  url: string,
  trustedOrigins: ReadonlySet<string>,
  appSchemes: readonly string[] = ['xyne-spaces'],
): MessageDeepLinkPayload | null {
  const parsed = parseTrustedDeepLinkUrl(url, trustedOrigins, appSchemes);
  if (!parsed) return null;

  const match = parsed.pathname.match(CHAT_DIR_PATH);
  if (!match) return null;
  const scoped = decodeChatDirScope(match);
  if (!scoped) return null;
  const { channelId, orgId, workspaceId } = scoped;
  const threadId = decodePathIdentifier(match[4]);
  if (threadId === null) return null;

  const fragmentParams = extractLinkParams(parsed.hash);
  const queryParams = extractLinkParams(parsed.search);
  const origin = mergeLinkParam(fragmentParams.origin, queryParams.origin);
  const messageId = mergeLinkParam(fragmentParams.messageId, queryParams.messageId);
  const createdAt = mergeLinkParam(fragmentParams.createdAt, queryParams.createdAt);
  const surface = mergeLinkParam(fragmentParams.surface, queryParams.surface);
  const scopeType = mergeLinkParam(fragmentParams.scopeType, queryParams.scopeType);
  if (
    origin === null ||
    messageId === null ||
    createdAt === null ||
    surface === null ||
    scopeType === null
  ) {
    return null;
  }

  return {
    channelId,
    ...(orgId !== undefined ? { orgId } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(threadId !== undefined ? { threadId } : {}),
    ...(origin !== undefined ? { origin } : {}),
    ...(messageId !== undefined ? { messageId } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(surface !== undefined ? { surface } : {}),
    ...(scopeType !== undefined ? { scopeType } : {}),
  };
}

export function parseTicketDeepLinkCore(
  url: string,
  trustedOrigins: ReadonlySet<string>,
  appSchemes: readonly string[] = ['xyne-spaces'],
): TicketDeepLinkPayload | null {
  const parsed = parseTrustedDeepLinkUrl(url, trustedOrigins, appSchemes);
  if (!parsed) return null;

  const match = parsed.pathname.match(TICKET_CHAT_DIR_PATH);
  if (!match) return null;
  const scoped = decodeChatDirScope(match);
  if (!scoped) return null;
  const conversationId = decodePathIdentifier(match[4]);
  const ticketId = decodePathIdentifier(match[5]);
  if (!conversationId || !ticketId) return null;

  return {
    ...scoped,
    conversationId,
    ticketId,
    selectedTab: resolveTicketSelectedTab(parsed.searchParams.get('selectedTab')),
  };
}

/** Native `/ticket/[ticketId]` params for a parsed ticket-detail link. */
export function ticketDeepLinkRouteParams(payload: TicketDeepLinkPayload): {
  ticketId: string;
  selectedTab: TicketDeepLinkTab;
  channelId: string;
  threadId: string;
  from: 'deeplink';
  source: 'deeplink';
} {
  return {
    ticketId: payload.ticketId,
    selectedTab: payload.selectedTab,
    channelId: payload.channelId,
    threadId: payload.conversationId,
    from: 'deeplink',
    source: 'deeplink',
  };
}

export function buildMessageDeepLinkPath(payload: MessageDeepLinkPayload): string {
  const path = `chat/dir/${encodeURIComponent(payload.channelId)}${
    payload.threadId ? `/${encodeURIComponent(payload.threadId)}` : ''
  }`;
  const parts: string[] = [];
  if (payload.origin) parts.push(`origin=${encodeURIComponent(payload.origin)}`);
  if (payload.messageId) parts.push(`messageId=${encodeURIComponent(payload.messageId)}`);
  if (
    payload.createdAt !== undefined &&
    Number.isFinite(payload.createdAt) &&
    payload.createdAt > 0
  ) {
    parts.push(`createdAt=${encodeURIComponent(String(payload.createdAt))}`);
  }
  if (payload.surface) parts.push(`surface=${encodeURIComponent(payload.surface)}`);
  if (payload.scopeType) parts.push(`scopeType=${encodeURIComponent(payload.scopeType)}`);
  return `${path}${parts.length > 0 ? `#${parts.join('&')}` : ''}`;
}

/**
 * Scope segments a parsed link carries, in path order. The workspace slot comes last,
 * so a caller matching these against the user's workspace list must prefer the LAST
 * match — see `resolveDeepLinkWorkspaceDecision`.
 */
export function messageDeepLinkScopeSegments(payload: DeepLinkScopePayload): readonly string[] {
  return [payload.orgId, payload.workspaceId].filter(
    (segment): segment is string => typeof segment === 'string' && segment.length > 0,
  );
}

function prefixChatDirScope(path: string, payload: DeepLinkScopePayload): string {
  if (!payload.workspaceId) return path;
  const orgSegment = payload.orgId ? `${encodeURIComponent(payload.orgId)}/` : '';
  return `${orgSegment}${encodeURIComponent(payload.workspaceId)}/${path}`;
}

/**
 * Public web-link path, optionally org- and workspace-scoped:
 *   [<orgId>/]<workspaceId>/chat/dir/<channelId>[/<threadId>]#origin=...&messageId=...
 * Used for shareable HTTPS links so the desktop app can switch workspace and the
 * mobile app can deep-link to the exact message. The org segment is emitted only when
 * the payload carries one (i.e. it round-trips a link parsed from the web app);
 * mobile-authored links omit it. The custom-scheme app link keeps using
 * buildMessageDeepLinkPath (no scope segments) because the app URL host must be
 * "chat".
 */
export function buildWorkspaceScopedMessagePath(payload: MessageDeepLinkPayload): string {
  return prefixChatDirScope(buildMessageDeepLinkPath(payload), payload);
}

function toWebTicketSelectedTab(tab: TicketDeepLinkTab): 'details' | 'thread' {
  return tab === 'thread' ? 'thread' : 'details';
}

export function buildTicketDeepLinkPath(payload: TicketDeepLinkPayload): string {
  return (
    `chat/dir/${encodeURIComponent(payload.channelId)}` +
    `/${encodeURIComponent(payload.conversationId)}` +
    `/${encodeURIComponent(payload.ticketId)}` +
    `?selectedTab=${toWebTicketSelectedTab(payload.selectedTab)}`
  );
}

export function buildWorkspaceScopedTicketPath(payload: TicketDeepLinkPayload): string {
  return prefixChatDirScope(buildTicketDeepLinkPath(payload), payload);
}
