/**
 * Stream manager thread IDs: one unique key per XyneAI conversation slot so
 * multiple sessions can stream concurrently without aborting each other.
 *
 * Formats:
 * - Global: `xyne-global#sess#<streamSessionKey>`
 * - Channel + message-thread + session: `<channelId>_<threadConversationId>#xyne-thread-sess#<streamSessionKey>`
 * - Channel-only multi-session: `<channelId>#xyne-sess#<streamSessionKey>`
 */

export const XYNE_GLOBAL_THREAD_PREFIX = 'xyne-global#sess#';
export const XYNE_CHANNEL_SESS_MARKER = '#xyne-sess#';
/** Per-session suffix when Ask AI is scoped to a channel message thread (multi-session safe) */
export const XYNE_THREAD_SESS_MARKER = '#xyne-thread-sess#';

export interface BuildXyneAIStreamThreadIdParams {
  channelId?: string | null | undefined;
  threadConversationId?: string | null | undefined;
  /** Per-conversation key: server session id or client draft UUID */
  streamSessionKey: string;
}

export function buildXyneAIStreamThreadId(params: BuildXyneAIStreamThreadIdParams): string {
  const { channelId, threadConversationId, streamSessionKey } = params;
  if (channelId && threadConversationId) {
    return `${channelId}_${threadConversationId}${XYNE_THREAD_SESS_MARKER}${streamSessionKey}`;
  }
  if (channelId) {
    return `${channelId}${XYNE_CHANNEL_SESS_MARKER}${streamSessionKey}`;
  }
  return `${XYNE_GLOBAL_THREAD_PREFIX}${streamSessionKey}`;
}

export type ParsedXyneAIStreamThreadId =
  | { kind: 'global'; streamSessionKey: string }
  | { kind: 'channel-session'; channelId: string; streamSessionKey: string }
  | {
      kind: 'channel-thread-session';
      channelId: string;
      threadConversationId: string;
      streamSessionKey: string;
    }
  /** Legacy: single stream slot per channel thread (before per-session ids) */
  | { kind: 'channel-thread'; channelId: string; threadConversationId: string }
  /** Legacy single-slot global (`general`) */
  | { kind: 'legacy-general' }
  /** Legacy channel-only before per-session suffix (`threadId === channelId`) */
  | { kind: 'legacy-channel-only'; channelId: string };

export function parseXyneAIStreamThreadId(threadId: string): ParsedXyneAIStreamThreadId {
  if (threadId === 'general') {
    return { kind: 'legacy-general' };
  }
  if (threadId.startsWith(XYNE_GLOBAL_THREAD_PREFIX)) {
    return {
      kind: 'global',
      streamSessionKey: threadId.slice(XYNE_GLOBAL_THREAD_PREFIX.length),
    };
  }
  if (threadId.includes(XYNE_THREAD_SESS_MARKER)) {
    const [base, sessionKey] = threadId.split(XYNE_THREAD_SESS_MARKER);
    if (base !== undefined && sessionKey !== undefined && sessionKey.length > 0) {
      const fu = base.indexOf('_');
      if (fu !== -1) {
        return {
          kind: 'channel-thread-session',
          channelId: base.slice(0, fu),
          threadConversationId: base.slice(fu + 1),
          streamSessionKey: sessionKey,
        };
      }
    }
  }
  if (threadId.includes(XYNE_CHANNEL_SESS_MARKER)) {
    const [channelPart, sessionPart] = threadId.split(XYNE_CHANNEL_SESS_MARKER);
    if (channelPart !== undefined && sessionPart !== undefined) {
      return {
        kind: 'channel-session',
        channelId: channelPart,
        streamSessionKey: sessionPart,
      };
    }
  }
  const firstUnderscore = threadId.indexOf('_');
  if (firstUnderscore !== -1) {
    return {
      kind: 'channel-thread',
      channelId: threadId.slice(0, firstUnderscore),
      threadConversationId: threadId.slice(firstUnderscore + 1),
    };
  }
  if (threadId.length > 0) {
    return { kind: 'legacy-channel-only', channelId: threadId };
  }
  return { kind: 'legacy-general' };
}

/** Client/server slot key embedded in threadId (for badges when sessionId not yet assigned). */
export function getStreamSlotKeyFromThreadId(threadId: string): string | null {
  const p = parseXyneAIStreamThreadId(threadId);
  if (p.kind === 'global') return p.streamSessionKey;
  if (p.kind === 'channel-session') return p.streamSessionKey;
  if (p.kind === 'channel-thread-session') return p.streamSessionKey;
  return null;
}

/**
 * Stable per-request correlation key for stream events: session slot when the thread id encodes one,
 * otherwise the full thread id (legacy single-slot shapes like desk draft `channel_conv`).
 */
export function deriveStreamSlotKey(threadId: string): string {
  return getStreamSlotKeyFromThreadId(threadId) ?? threadId;
}

/**
 * Channel id for conversation persistence (omits thread suffix / session key).
 */
export function getChannelIdFromStreamThreadId(threadId: string): string | null {
  const parsed = parseXyneAIStreamThreadId(threadId);
  switch (parsed.kind) {
    case 'global':
    case 'legacy-general':
      return null;
    case 'channel-session':
      return parsed.channelId;
    case 'channel-thread':
    case 'channel-thread-session':
      return parsed.channelId;
    case 'legacy-channel-only':
      return parsed.channelId;
  }
}

export function newStreamSlotKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
