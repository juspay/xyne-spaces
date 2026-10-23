import type { useRouter } from 'expo-router';

import { PUBLIC_DEEP_LINK_ORIGIN } from '@/src/config';
import { TICKET_ROUTE } from '@/src/features/chat/navigation/chatRoutePolicy';
import { getActiveWorkspaceId } from './activeWorkspace';
import { requiresWorkspaceSwitch } from './deepLinkWorkspace';
import {
  buildWorkspaceScopedTicketPath,
  parseTicketDeepLinkCore,
  ticketDeepLinkRouteParams,
  type TicketDeepLinkPayload,
  type TicketDeepLinkTab,
} from './messageDeepLinkCore';
import { enqueueDeepLink } from './pendingDeepLink';
import { canonicalizePublicDeepLink } from './publicDeepLink';

export type { TicketDeepLinkPayload, TicketDeepLinkTab } from './messageDeepLinkCore';

const TRUSTED_ORIGIN_SET = new Set(
  [PUBLIC_DEEP_LINK_ORIGIN].map(origin => origin.replace(/\/$/, '')),
);

export function parseTicketDeepLink(url: string): TicketDeepLinkPayload | null {
  return parseTicketDeepLinkCore(
    canonicalizePublicDeepLink(url, PUBLIC_DEEP_LINK_ORIGIN),
    TRUSTED_ORIGIN_SET,
  );
}

/** Public HTTPS ticket link matching the dashboard share URL. */
export function buildWebTicketLink(payload: TicketDeepLinkPayload): string {
  return `${PUBLIC_DEEP_LINK_ORIGIN}/${buildWorkspaceScopedTicketPath(payload)}`;
}

export function buildWebTicketLinkFromIds({
  channelId,
  conversationId,
  ticketId,
  selectedTab,
  workspaceId,
}: {
  channelId: string;
  conversationId: string;
  ticketId: string;
  selectedTab: TicketDeepLinkTab;
  workspaceId?: string;
}): string | null {
  const channel = channelId.trim();
  const conversation = conversationId.trim();
  const ticket = ticketId.trim();
  if (!channel || !conversation || !ticket) return null;
  return buildWebTicketLink({
    channelId: channel,
    conversationId: conversation,
    ticketId: ticket,
    selectedTab,
    ...(workspaceId ? { workspaceId } : {}),
  });
}

export function openTicketDeepLink(
  router: ReturnType<typeof useRouter>,
  payload: TicketDeepLinkPayload,
): void {
  router.push({
    pathname: TICKET_ROUTE,
    params: ticketDeepLinkRouteParams(payload),
  });
}

/** Handle an in-app HTTPS ticket-detail link without opening the browser. */
export function navigateToTicketDeepLinkIfApplicable(
  router: ReturnType<typeof useRouter>,
  url: string,
): boolean {
  const parsed = parseTicketDeepLink(url);
  if (!parsed) return false;
  if (requiresWorkspaceSwitch(parsed, getActiveWorkspaceId()) && enqueueDeepLink(url)) return true;
  openTicketDeepLink(router, parsed);
  return true;
}
