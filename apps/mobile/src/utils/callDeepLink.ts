import type { ImperativeRouter as Router } from 'expo-router';

import { PUBLIC_DEEP_LINK_ORIGIN } from '@/src/config';
import { canonicalizePublicDeepLink } from '@/src/utils/publicDeepLink';

const TRUSTED_ORIGIN_SET = new Set(
  [PUBLIC_DEEP_LINK_ORIGIN].map(origin => origin.replace(/\/$/, '')),
);

const APP_LINK_ORIGIN = 'https://xyne-spaces.local';
/** Matches `/call/:callId` and optional workspace-prefixed `/<workspaceId>/call/:callId`. */
const CALL_PATH_PATTERN = /(?:^|\/)call\/([a-zA-Z0-9-]+)\/?$/;
const CALL_TYPES = new Set(['AUDIO', 'VIDEO', 'HEADLESS']);

export type CallDeepLinkType = 'AUDIO' | 'VIDEO' | 'HEADLESS';

export type CallDeepLinkPayload = {
  callId: string;
  callType: CallDeepLinkType;
};

/** Shared by other deep-link parsers (e.g. recordingDeepLink.ts) — normalizes the
 *  app scheme / public origin and rejects untrusted origins. */
export function parseLinkUrl(url: string): URL | null {
  const trimmed = canonicalizePublicDeepLink(url, PUBLIC_DEEP_LINK_ORIGIN).trim();
  if (!trimmed) return null;

  try {
    const normalized = trimmed.replace(/^xyne-spaces:\s*\/*\s*/i, `${APP_LINK_ORIGIN}/`);
    const parsed = new URL(normalized, APP_LINK_ORIGIN);
    return parsed.origin === APP_LINK_ORIGIN || TRUSTED_ORIGIN_SET.has(parsed.origin)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Parse the canonical public origin, app scheme, or a relative call link. */
export function parseCallDeepLink(url: string): CallDeepLinkPayload | null {
  const parsed = parseLinkUrl(url);
  if (!parsed) return null;

  const match = parsed.pathname.match(CALL_PATH_PATTERN);
  const callId = match?.[1];
  if (!callId) return null;

  const requestedType = parsed.searchParams.get('type')?.toUpperCase() ?? '';
  const callType: CallDeepLinkType = CALL_TYPES.has(requestedType)
    ? (requestedType as CallDeepLinkType)
    : 'AUDIO';

  return { callId, callType };
}

/**
 * Returns true when a call link was handled through Lotus internal routing.
 * Call links always open the native pre-join screen so an untrusted link cannot
 * silently enter a privileged WebView route.
 */
export function navigateToCallDeepLinkIfApplicable(router: Router, url: string): boolean {
  const parsed = parseCallDeepLink(url);
  if (!parsed) return false;

  // Deep links are untrusted entry points. Require an explicit in-app decision before joining.
  router.push({
    pathname: '/(protected)/call-prejoin' as never,
    params: {
      callId: parsed.callId,
      callType: parsed.callType,
    },
  });
  return true;
}
