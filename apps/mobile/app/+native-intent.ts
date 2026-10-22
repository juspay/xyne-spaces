const MICROSOFT_AUTH_CALLBACK_PATH = '/auth/microsoft/callback';
const COMMUNITY_JOIN_PATH = '/community/join';

// Deep links may be scoped by organization and/or workspace
// (`/<orgId>/<workspaceId>/chat/dir/<channelId>`), so the known prefixes are matched
// behind up to two leading segments. Mirrors CHAT_DIR_PATH in
// `src/utils/messageDeepLinkCore.ts` and MAX_LEADING_DEEP_LINK_SEGMENTS in
// `src/utils/publicDeepLink.ts`. A scoped path that is not recognized here falls
// through to Expo Router, which has no file for it and mounts Unmatched Route as the
// stack entry — while the root Linking handler opens the same URL a second time.
const ROOT_HANDLED_LINK_PATH = /^\/(?:[^/]+\/){0,2}(?:chat\/dir|call)\//;

// Recording widget/Live Activity links. Only the action-carrying form
// (`/recordings?action=start|stop`) is consumed by the root Linking handler
// (`parseRecordingDeepLink` requires the action param); the plain
// `/recordings` form (error-state tap, Live Activity widgetURL) has no root
// handling and must keep falling through to Expo Router, which resolves it to
// the recordings screen itself. Mirrors RECORDINGS_PATH_PATTERN in
// `src/utils/recordingDeepLink.ts`.
const RECORDING_LINK_PATH = /^\/(?:[^/]+\/){0,2}recordings\/?$/;
const RECORDING_ACTION_PARAM = /[?&]action=(?:start|stop)\b/;

type CommunityIntentModule = typeof import('@/src/services/communityIntent');

// Required lazily, only for community links: config and communityIntent pull in native modules
// (expo-constants, MMKV) that the rest of this file stays free of.
function isCommunityApp(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/src/config') as typeof import('@/src/config')).IS_COMMUNITY_APP;
}

function readWorkspaceIdParam(systemPath: string): string | null {
  try {
    return new URL(systemPath).searchParams.get('workspaceId')?.trim() || null;
  } catch {
    const query = systemPath.split('?')[1];
    if (!query) {
      return null;
    }
    return new URLSearchParams(query.split('#')[0] ?? '').get('workspaceId')?.trim() || null;
  }
}

function normalizeSystemPath(systemPath: string): string {
  try {
    const url = new URL(systemPath);
    if (url.protocol === 'xyne-spaces:') {
      const hostPath = url.hostname ? `/${url.hostname}` : '';
      return `${hostPath}${url.pathname}` || '/';
    }
    return url.pathname || '/';
  } catch {
    const pathOnly = systemPath.split(/[?#]/)[0] ?? '';
    return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  }
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const normalizedPath = normalizeSystemPath(path);
  if (normalizedPath === MICROSOFT_AUTH_CALLBACK_PATH) {
    return '/login';
  }

  // Community invite link (`/community/join?workspaceId=…`), sent by the dashboard's invite button
  // and the join-approved email. Record the intent here — MMKV is synchronous, so it is available
  // whether the user lands on the signed-out community screen or is already signed in (the root
  // layout picks the latter case up and routes to the in-app join screen).
  if (normalizedPath === COMMUNITY_JOIN_PATH && isCommunityApp()) {
    const workspaceId = readWorkspaceIdParam(path);
    if (!workspaceId) {
      return '/community';
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const intent = require('@/src/services/communityIntent') as CommunityIntentModule;
    intent.clearEnterpriseLoginIntent();
    intent.setPendingCommunityWorkspace(workspaceId);
    return `/community?workspaceId=${encodeURIComponent(workspaceId)}`;
  }

  // These external paths are consumed by the root Linking handler and do not
  // map to Expo Router files. An empty path makes Expo Router ignore this
  // notification; the root handler preserves and resolves the complete URL
  // (including query/hash metadata) exactly once.
  if (ROOT_HANDLED_LINK_PATH.test(normalizedPath)) {
    return '';
  }

  if (RECORDING_LINK_PATH.test(normalizedPath) && RECORDING_ACTION_PARAM.test(path)) {
    return '';
  }

  return path;
}
