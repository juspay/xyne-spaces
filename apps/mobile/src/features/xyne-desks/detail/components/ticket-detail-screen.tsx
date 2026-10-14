import { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TicketStatusV2 } from '@xyne/shared';

import { useAuth } from '@/src/contexts/AuthContext';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { useZero } from '@/src/hooks/useZero';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';
import { mutators } from '@/src/zero/mutators';
import { useChannelById } from '@/src/hooks/useChannels';

import { removeTicketsFromPaintCache } from '../../tickets/utils';
import { TICKET_DETAIL_TABS_HEIGHT } from '../constants';
import {
  useEmailThreadSummary,
  useMarkTicketEmailRead,
  useTicketDetailData,
  useTicketDetailTabs,
  useTicketMailboxStar,
} from '../hooks';
import { getDeskChannelKind, shouldShowEmailHeaderChrome } from '../utils/desk-channel-kind';
import { clearTicketDetailPaintCache } from '../utils/ticket-detail-paint-cache';
import { ArchiveTicketSheet } from './archive-ticket-sheet';
import { DetailsTab } from './details-tab';
import { EmailSummarySheet } from './email-summary-sheet';
import { EmailTab } from './email-tab';
import { MessagesTab } from './messages-tab';
import { TicketDetailHeader } from './ticket-detail-header';
import { TicketDetailTabs } from './ticket-detail-tabs';

function paramString(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function canArchiveTicketStatus(status: string | null | undefined): boolean {
  return status === TicketStatusV2.COMPLETED || status === TicketStatusV2.CANCELLED;
}

export default function TicketDetailScreen() {
  const router = useRouter();
  const zero = useZero();
  const { workspaceSessionKey: sessionKey } = useAuth();
  const { headerHeight, topSafeHeight } = useHeaderHeight();

  const params = useLocalSearchParams<{
    channelId: string;
    ticketId: string;
    id?: string;
  }>();

  const channelId = paramString(params.channelId);
  const xyneId = paramString(params.ticketId);
  const ticketUuid = paramString(params.id) || undefined;

  const deskChannel = useChannelById(channelId);
  const currentDeskChannelType = typeof deskChannel?.type === 'string' ? deskChannel.type : '';

  // Channel type drives reply bar + chat composer. deskSource only affects
  // email header chrome (see shouldShowEmailHeaderChrome) — intentional for now.
  const deskChannelKind = getDeskChannelKind(currentDeskChannelType);
  const isMailboxDeskChannel = deskChannelKind === 'mailbox';
  const isChatDeskChannel = deskChannelKind === 'chat';

  const { detail, isMember, isInitialLoading, isNotFound } = useTicketDetailData({
    channelId,
    xyneId,
    ticketUuid,
  });

  const showEmailHeaderChrome = shouldShowEmailHeaderChrome(
    currentDeskChannelType,
    detail?.deskSource,
  );

  const tabs = useTicketDetailTabs('email');
  const { starred, toggleStar } = useTicketMailboxStar({
    ticketId: detail?.id,
    channelId,
    enabled: isMailboxDeskChannel && Boolean(detail?.id),
  });
  const [tabsHeight, setTabsHeight] = useState(TICKET_DETAIL_TABS_HEIGHT);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const headerBottom = topSafeHeight + headerHeight;
  const contentPaddingTop = headerBottom + tabsHeight;

  const emailSummary = useEmailThreadSummary({
    conversationId: detail?.conversationId,
    emailCount: detail?.emails.length ?? 0,
  });

  const latestEmailId = detail?.emails[detail.emails.length - 1]?.id;
  useMarkTicketEmailRead(
    detail?.id,
    latestEmailId,
    detail?.lastEmailAt ?? null,
    detail?.emailReads,
    Boolean(detail),
  );

  const dismissOverlayOrGoBack = useCallback((): boolean => {
    if (showArchiveConfirm) {
      setShowArchiveConfirm(false);
      return true;
    }
    if (emailSummary.isOpen) {
      emailSummary.closeSummary();
      return true;
    }
    return false;
  }, [emailSummary.closeSummary, emailSummary.isOpen, showArchiveConfirm]);

  const handleMailboxReplyPress = useCallback(() => {
    if (!detail || !isMember) return;

    const ticketRouteId = detail.xyneId || xyneId;
    if (!channelId || !ticketRouteId) return;

    router.push({
      pathname: '/xyne-desks/[channelId]/[ticketId]/reply',
      params: {
        channelId,
        ticketId: ticketRouteId,
        id: detail.id,
      },
    });
  }, [channelId, detail, isMember, router, xyneId]);

  usePreventRemove(emailSummary.isOpen || showArchiveConfirm, () => {
    dismissOverlayOrGoBack();
  });

  useEffect(() => {
    if (!emailSummary.isOpen && !showArchiveConfirm) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () =>
      dismissOverlayOrGoBack(),
    );
    return () => {
      subscription.remove();
    };
  }, [dismissOverlayOrGoBack, emailSummary.isOpen, showArchiveConfirm]);

  const handleHeaderBack = useCallback(() => {
    if (dismissOverlayOrGoBack()) return;
    router.back();
  }, [dismissOverlayOrGoBack, router]);

  const handleMarkUnread = useCallback(() => {
    if (!detail?.id) return;
    void zero.mutate(mutators.emailRead.bulkMarkAsUnread({ ticketIds: [detail.id] }));
  }, [detail?.id, zero]);

  const performArchive = useCallback(() => {
    if (!detail?.id) return;

    void zero.mutate(
      mutators.ticket.update({
        id: detail.id,
        isArchived: true,
        updatedAt: Date.now(),
      }),
    );

    removeTicketsFromPaintCache(sessionKey, channelId, [detail.id]);
    clearTicketDetailPaintCache(sessionKey, channelId, detail.xyneId || xyneId);
    clearTicketDetailPaintCache(sessionKey, channelId, detail.id);
    showMessageToast('Ticket archived successfully', 'success');
    router.back();
  }, [channelId, detail, router, sessionKey, xyneId, zero]);

  const handleArchive = useCallback(() => {
    if (!detail?.id || detail.isArchived) return;

    if (!canArchiveTicketStatus(detail.status)) {
      showMessageToast('Ticket must be in Completed or Cancelled status to be archived', 'warning');
      return;
    }

    setShowArchiveConfirm(true);
  }, [detail]);

  const setActiveTab = tabs.setActive;
  const handleParentTicketPress = useCallback(() => {
    setActiveTab('details');
  }, [setActiveTab]);

  const handleMoreAction = useCallback(
    (action: 'reply-all' | 'forward' | 'copy-id') => {
      if (action === 'copy-id') {
        const id = detail?.xyneId || xyneId;
        if (!id) return;
        void Clipboard.setStringAsync(id)
          .then(() => haptics.success())
          .catch(() => {
            void haptics.error();
            Alert.alert('Unable to copy');
          });
      }
    },
    [detail?.xyneId, xyneId],
  );

  return (
    <View className='flex-1 bg-neutral-100 dark:bg-tabs-screen'>
      <TicketDetailHeader
        onBack={handleHeaderBack}
        canSummarize={emailSummary.canSummarize}
        isSummarizeLoading={emailSummary.state === 'loading'}
        onSummarize={emailSummary.openSummary}
        canArchive={Boolean(detail) && !detail?.isArchived}
        onArchive={handleArchive}
        onMarkUnread={handleMarkUnread}
        onMoreAction={handleMoreAction}
      />

      <View
        pointerEvents='box-none'
        onLayout={e => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && Math.abs(h - tabsHeight) > 1) setTabsHeight(h);
        }}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: headerBottom,
          zIndex: 39,
        }}
        className='bg-neutral-100 dark:bg-tabs-screen'
      >
        <TicketDetailTabs active={tabs.active} onChange={tabs.setActive} />
      </View>

      {isInitialLoading && !detail ? (
        <View style={{ paddingTop: contentPaddingTop }} className='flex-1 items-center px-6 pt-10'>
          <Text className='text-[15px] text-secondary-foreground'>Loading ticket…</Text>
        </View>
      ) : null}

      {isNotFound ? (
        <View style={{ paddingTop: contentPaddingTop }} className='flex-1 items-center px-6 pt-10'>
          <Text className='text-[15px] text-secondary-foreground'>Ticket not found</Text>
        </View>
      ) : null}

      {detail && tabs.active === 'email' ? (
        <EmailTab
          detail={detail}
          channelId={channelId}
          contentPaddingTop={contentPaddingTop}
          title={detail.title}
          xyneId={detail.xyneId}
          starred={starred}
          onToggleStar={toggleStar}
          showStar={isMailboxDeskChannel}
          showMailboxReplyAction={isMailboxDeskChannel}
          onReplyPress={handleMailboxReplyPress}
          showChatComposer={isChatDeskChannel}
          showEmailHeaderChrome={showEmailHeaderChrome}
          isMember={isMember}
          channelType={currentDeskChannelType}
        />
      ) : null}

      {detail && tabs.active === 'messages' ? (
        <MessagesTab
          channelId={channelId}
          conversationId={detail.conversationId}
          isMember={isMember}
          contentPaddingTop={contentPaddingTop}
          onParentTicketPress={handleParentTicketPress}
        />
      ) : null}

      {detail && tabs.active === 'details' ? (
        <DetailsTab
          ticketId={detail.id}
          channelId={channelId}
          contentPaddingTop={contentPaddingTop}
        />
      ) : null}

      <EmailSummarySheet
        isOpen={emailSummary.isOpen}
        onOpenChange={emailSummary.setOpen}
        state={emailSummary.state}
        summary={emailSummary.summary}
        keypoints={emailSummary.keypoints}
        errorMessage={emailSummary.errorMessage}
        onRegenerate={emailSummary.regenerate}
      />

      <ArchiveTicketSheet
        isOpen={showArchiveConfirm}
        onOpenChange={setShowArchiveConfirm}
        onConfirm={performArchive}
      />
    </View>
  );
}
