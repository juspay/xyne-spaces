import { tabPath } from '@/src/navigation/routes';

export type NotificationOpenSurface = 'channel' | 'thread';

export const PATH_DMS = tabPath('dms');
export const PATH_CHAT = '/chat/[channelId]';
export const PATH_THREAD = '/chat/[channelId]/[threadId]';

export function resolveIdealPath(surface: NotificationOpenSurface): string {
  const destination = surface === 'thread' ? PATH_THREAD : PATH_CHAT;
  return `${PATH_DMS} → ${destination}`;
}

export function appendPathSegment(path: string, segment: string): string {
  if (path.length === 0) {
    return segment;
  }

  if (path === segment || path.endsWith(` → ${segment}`)) {
    return path;
  }

  return `${path} → ${segment}`;
}

export function surfaceFromTarget(target: { threadId?: string }): NotificationOpenSurface {
  return target.threadId ? 'thread' : 'channel';
}

export function pathSegmentForPhase(
  phase: 'dms_visible' | 'chat_visible',
  surface: NotificationOpenSurface,
): string {
  if (phase === 'dms_visible') {
    return PATH_DMS;
  }

  return surface === 'thread' ? PATH_THREAD : PATH_CHAT;
}
