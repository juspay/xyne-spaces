import { ChannelScopeType, isDeskChannelType } from '@xyne/shared';

export type ChannelTicketsGateChannel = {
  scopeType?: string | null | undefined;
  type?: string | null | undefined;
};

/**
 * Whether a channel gets a Tickets entry.
 *
 * Mirrors the dashboard's `useConversationTabs`: TICKETS read access, and not a
 * DM / group DM. Desk channels (EMAIL / SLACK / APP) are excluded on top of that
 * because their tickets already live in the Xyne Desks surface, and the dashboard
 * routes desk tickets to `/support`, never to the chat tickets tab.
 *
 * Pure and dependency-light on purpose: `info.tsx` imports it eagerly, so it must
 * not pull the table onto the Info screen's graph.
 */
export function canShowChannelTickets(
  channel: ChannelTicketsGateChannel | null | undefined,
  canReadTicket: boolean,
): boolean {
  if (!canReadTicket || !channel) return false;

  const scopeType = channel.scopeType ?? null;
  if (scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM) {
    return false;
  }

  return !isDeskChannelType(channel.type);
}
