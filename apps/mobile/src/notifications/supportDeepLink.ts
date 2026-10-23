/** A dashboard `/support/` link. The path segment is how a push tells mobile to open a desk. */
export type SupportDeepLink = {
  channelId: string;
  xyneId?: string;
  conversationId?: string;
  messageId?: string;
};

function readQuery(search: string, key: string): string | undefined {
  const value = new URLSearchParams(search).get(key)?.trim();
  return value ? decodeURIComponent(value) : undefined;
}

/**
 * `/{workspaceId}/support/{channelId}/{xyneId}` and
 * `/{workspaceId}/support/{channelId}?conversationId=&messageId=`.
 * Chat and DM links (`/chat/dir`, `/chat/dm`) return null.
 */
export function parseSupportDeepLink(raw: string | null | undefined): SupportDeepLink | null {
  if (!raw?.trim()) return null;

  const hashIndex = raw.indexOf('#');
  const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const hash = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
  const queryIndex = beforeHash.indexOf('?');
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';

  const segments = path.split('/').filter(Boolean);
  const supportIndex = segments.indexOf('support');
  const channelId = supportIndex >= 0 ? segments[supportIndex + 1] : undefined;
  if (!channelId) return null;

  const xyneId = segments[supportIndex + 2];
  const conversationId = readQuery(query, 'conversationId') ?? readQuery(hash, 'origin');
  const messageId = readQuery(query, 'messageId') ?? readQuery(hash, 'messageId');

  return {
    channelId: decodeURIComponent(channelId),
    ...(xyneId ? { xyneId: decodeURIComponent(xyneId) } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(messageId ? { messageId } : {}),
  };
}

export function supportDeepLinkFromNotificationData(
  data: Record<string, string>,
): SupportDeepLink | null {
  return parseSupportDeepLink(data['actionUrl']) ?? parseSupportDeepLink(data['deeplink']);
}
