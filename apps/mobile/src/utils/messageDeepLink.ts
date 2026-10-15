import * as Linking from 'expo-linking';
import { PUBLIC_DEEP_LINK_ORIGIN } from '@/src/config';
import type { useRouter } from 'expo-router';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';
import {
  buildMessageDeepLinkPath,
  buildWorkspaceScopedMessagePath,
  parseMessageDeepLinkCore,
  type MessageDeepLinkPayload,
} from './messageDeepLinkCore';
import { canonicalizePublicDeepLink } from './publicDeepLink';
import { getActiveWorkspaceId } from './activeWorkspace';
import { requiresWorkspaceSwitch } from './deepLinkWorkspace';
import { enqueueDeepLink } from './pendingDeepLink';
import { navigateToTicketDeepLinkIfApplicable } from './ticketDeepLink';

export type { MessageDeepLinkPayload } from './messageDeepLinkCore';

const TRUSTED_ORIGIN_SET = new Set(
  [PUBLIC_DEEP_LINK_ORIGIN].map(origin => origin.replace(/\/$/, '')),
);

export function parseMessageDeepLink(url: string): MessageDeepLinkPayload | null {
  return parseMessageDeepLinkCore(
    canonicalizePublicDeepLink(url, PUBLIC_DEEP_LINK_ORIGIN),
    TRUSTED_ORIGIN_SET,
  );
}

/** Custom-scheme fallback for development and explicit open-app flows. */
export function buildAppMessageLink(payload: MessageDeepLinkPayload): string {
  return Linking.createURL(`/${buildMessageDeepLinkPath(payload)}`);
}

/** Public, tappable message link. OS handoff still requires AASA/assetlinks verification. */
export function buildWebMessageLink(payload: MessageDeepLinkPayload): string {
  return `${PUBLIC_DEEP_LINK_ORIGIN}/${buildWorkspaceScopedMessagePath(payload)}`;
}

/** Handle an in-app HTTPS chat/dir link without opening the browser. */
export function navigateToMessageDeepLinkIfApplicable(
  router: ReturnType<typeof useRouter>,
  url: string,
): boolean {
  // Ticket-detail URLs share the chat/dir prefix but carry a third path segment.
  // Resolve them first so they never fall through as malformed message links.
  if (navigateToTicketDeepLinkIfApplicable(router, url)) return true;
  const parsed = parseMessageDeepLink(url);
  if (!parsed) return false;
  // A link into another workspace must not be navigated to in place: the channel is
  // absent from the active workspace's store, so the chat screen would land on
  // "This message is unavailable". Hand it to the root pipeline, which switches
  // workspace first and re-opens the URL in the new session.
  if (requiresWorkspaceSwitch(parsed, getActiveWorkspaceId()) && enqueueDeepLink(url)) return true;
  const intent = createChatOpenIntent(parsed, 'deeplink');
  if (!intent) return false;
  return executeChatOpenIntent(router, intent);
}
