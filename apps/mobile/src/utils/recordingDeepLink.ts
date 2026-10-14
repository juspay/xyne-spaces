import { parseLinkUrl } from '@/src/utils/callDeepLink';

/** Matches `/recordings` and optional workspace-prefixed `/<workspaceId>/recordings`. */
const RECORDINGS_PATH_PATTERN = /(?:^|\/)recordings\/?$/;

export type RecordingDeepLinkAction = 'start' | 'stop';

export interface RecordingDeepLinkPayload {
  action: RecordingDeepLinkAction;
}

/**
 * Parses `xyne-spaces://recordings?action=start|stop` (or the equivalent
 * public-origin universal link) — used to trigger a recording from a
 * home-screen widget or Live Activity tap when the app isn't already
 * foregrounded.
 */
export function parseRecordingDeepLink(url: string): RecordingDeepLinkPayload | null {
  const parsed = parseLinkUrl(url);
  if (!parsed) return null;
  if (!RECORDINGS_PATH_PATTERN.test(parsed.pathname)) return null;

  const action = parsed.searchParams.get('action');
  return action === 'start' || action === 'stop' ? { action } : null;
}
