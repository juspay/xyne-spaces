import { router } from 'expo-router';

import type { SupportDeepLink } from '@/src/notifications/supportDeepLink';
import type { TicketDetailTabId } from '@/src/features/xyne-desks/detail/types';

import { isDeskActivityChannel } from './deskActivityTarget';

export { isDeskActivityChannel };

export type DeskOpenTarget = SupportDeepLink & {
  /** Internal ticket id. Used when the push has no xyneId. */
  ticketId?: string;
  tab?: TicketDetailTabId;
};

/** Opens a desk when the activity's channel is a desk; otherwise keeps the chat or ticket screen. */
export function openActivityOnDeskOr(
  channelType: string | null | undefined,
  desk: DeskOpenTarget,
  openOtherwise: () => void,
): void {
  if (!isDeskActivityChannel(channelType) || !desk.channelId.trim()) {
    openOtherwise();
    return;
  }
  openDeskRoute(desk);
}

/** Opens the mobile desk screens for a dashboard `/support/` target. */
export function openDeskRoute(
  target: DeskOpenTarget,
  mode: 'push' | 'replace' = 'push',
): void {
  const channelId = target.channelId.trim();
  if (!channelId) return;

  const navigate = mode === 'replace' ? router.replace : router.push;
  const xyneId = target.xyneId?.trim();
  const ticketId = target.ticketId?.trim();
  const pathId = xyneId || ticketId;
  if (pathId) {
    navigate({
      pathname: '/xyne-desks/[channelId]/[ticketId]',
      params: {
        channelId,
        ticketId: pathId,
        ...(ticketId ? { id: ticketId } : {}),
        ...(target.tab ? { tab: target.tab } : {}),
        ...(target.messageId ? { messageId: target.messageId } : {}),
      },
    });
    return;
  }

  navigate({
    pathname: '/xyne-desks/[channelId]',
    params: {
      channelId,
      ...(target.conversationId ? { conversationId: target.conversationId } : {}),
      ...(target.messageId ? { messageId: target.messageId } : {}),
      ...(target.tab ? { tab: target.tab } : {}),
    },
  });
}
