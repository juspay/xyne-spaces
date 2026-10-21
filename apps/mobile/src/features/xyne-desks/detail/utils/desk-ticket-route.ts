import type { TicketDetailTabId } from '../types';
import { getDeskChannelKind } from './desk-channel-kind';

export const DESK_TICKET_ROUTE = '/xyne-desks/[channelId]/[ticketId]' as const;

export type DeskTicketRoute = {
  pathname: typeof DESK_TICKET_ROUTE;
  params: {
    channelId: string;
    /** Path segment: xyneId when known (dashboard parity), else the ticket uuid. */
    ticketId: string;
    /** Ticket uuid — lets the Desk screen load by id without an xyneId lookup. */
    id: string;
    tab: TicketDetailTabId;
  };
};

export type ResolveDeskTicketRouteInput = {
  ticketUuid: string | null | undefined;
  xyneId?: string | null | undefined;
  channelId: string | null | undefined;
  channelType: string | null | undefined;
  /** Desk membership. Non-members keep the standard ticket view (thread access). */
  isDeskMember: boolean;
  /** Tab requested for the standard ticket screen (`thread`, `overview`, `activity`, …). */
  requestedTab?: string | null | undefined;
};

const DESK_TABS: ReadonlySet<string> = new Set<TicketDetailTabId>(['email', 'messages', 'details']);

/** Map the standard ticket screen's tab to the matching Desk tab. */
export function deskTabForRequestedTab(tab: string | null | undefined): TicketDetailTabId {
  return tab === 'thread' ? 'messages' : 'email';
}

/** Read a Desk tab route param; anything unknown falls back to the caller's default. */
export function parseDeskTicketTab(value: string | string[] | undefined): TicketDetailTabId | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && DESK_TABS.has(raw) ? (raw as TicketDetailTabId) : null;
}

/**
 * Desk tickets (EMAIL / SLACK / APP desk channels) should open in the Desk
 * ticket screen — the same one used from Desk Channels — instead of the
 * generic ticket screen. Returns null when the ticket should stay on the
 * generic screen: not a desk the mobile Desk screen supports, the viewer is
 * not a member of the desk, or ids are missing.
 */
export function resolveDeskTicketRoute(input: ResolveDeskTicketRouteInput): DeskTicketRoute | null {
  if (!input.isDeskMember) return null;
  if (getDeskChannelKind(input.channelType) === 'unknown') return null;

  const channelId = input.channelId?.trim() ?? '';
  const ticketUuid = input.ticketUuid?.trim() ?? '';
  if (!channelId || !ticketUuid) return null;

  return {
    pathname: DESK_TICKET_ROUTE,
    params: {
      channelId,
      ticketId: input.xyneId?.trim() || ticketUuid,
      id: ticketUuid,
      tab: deskTabForRequestedTab(input.requestedTab),
    },
  };
}
