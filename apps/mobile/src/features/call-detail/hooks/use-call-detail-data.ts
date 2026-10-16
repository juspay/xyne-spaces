import { useMemo } from 'react';
import type { Call, Channel } from '@xyne/shared';

import { useAuth } from '@/src/contexts/AuthContext';
import { useAllChannels, useAllVisibleChannels } from '@/src/hooks/useChannels';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';

import { getCanvasIdFromUrl } from '../utils/call-detail-format';

export interface CallSummaryTab {
  id: string;
  kind: 'detailed-summary' | 'prd';
  canvasId: string;
  title: string;
}

export interface CallDetailData {
  call: Call | undefined;
  isResolvingCall: boolean;
  currentUserId: string | undefined;
  conversationId: string | null;
  /** Where the call message lives: `callUpdatesChannel` when set, else the call's channel. */
  messageChannelId: string | null;
  messageChannel: Channel | undefined;
  isChannelMember: boolean;
  /** messageId of the backend-posted summary reply in the call thread. */
  summaryMessageId: string | null;
  tabs: CallSummaryTab[];
  isTabContentLoading: boolean;
  isOwner: boolean;
  /** Host, participant, or member of the call's channel — mirrors backend isCallAudience. */
  isCallAudience: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Everything the screen derives from Zero: the call row, its thread, and its canvases. */
export function useCallDetailData(callId: string): CallDetailData {
  const { user } = useAuth();
  const currentUserId = (user?.user_id as string | undefined) ?? undefined;

  const [callRow, callDetails] = useQuery(queries.callById({ callId }), {
    enabled: callId.length > 0,
  });
  const call = (callRow ?? undefined) as Call | undefined;
  const isResolvingCall = callId.length > 0 && !call && callDetails.type !== 'complete';

  const callMeta = asRecord(call?.metadata);
  const conversationId =
    typeof callMeta?.['conversationId'] === 'string' ? callMeta['conversationId'] : null;

  const allChannels = useAllChannels();
  const visibleChannels = useAllVisibleChannels();
  const messageChannelId = call?.callUpdatesChannel ?? call?.channelId ?? null;
  const messageChannel = useMemo(
    () => allChannels.find(channel => channel.id === messageChannelId),
    [allChannels, messageChannelId],
  );
  const isChannelMember = useMemo(
    () => visibleChannels.some(channel => channel.id === messageChannelId),
    [visibleChannels, messageChannelId],
  );
  const isCallChannelMember = useMemo(
    () => Boolean(call?.channelId && visibleChannels.some(c => c.id === call.channelId)),
    [visibleChannels, call?.channelId],
  );

  const [messages, messagesDetails] = useQuery(
    queries.conversationMessages({ conversationId: conversationId ?? '' }),
    { enabled: Boolean(conversationId) },
  );

  const derived = useMemo(() => {
    const externalId = call?.externalId;
    let callMessageMeta: Record<string, unknown> | null = null;
    let summaryMessageId: string | null = null;
    let fallbackSummaryMessageId: string | null = null;
    const prdCanvasIds: string[] = [];

    for (const message of messages ?? []) {
      const meta = asRecord(message.metadata);
      if (!meta || !externalId || meta['callId'] !== externalId) continue;
      const subtype = meta['messageSubtype'];
      if (meta['isCallMessage'] === true && !callMessageMeta) callMessageMeta = meta;
      if (subtype === 'call_detailed_summary' && !summaryMessageId) {
        summaryMessageId = message.messageId;
      }
      if (subtype === 'call_summary' && !fallbackSummaryMessageId) {
        fallbackSummaryMessageId = message.messageId;
      }
      if (subtype === 'call_prd') {
        const prdId = getCanvasIdFromUrl(meta['canvasUrl']);
        if (prdId) prdCanvasIds.push(prdId);
      }
    }

    const stamped = callMeta?.['detailedSummaryCanvasId'];
    const detailedSummaryCanvasId =
      getCanvasIdFromUrl(callMessageMeta?.['detailedSummaryCanvasUrl']) ??
      (typeof stamped === 'string' && stamped.length > 0 ? stamped : null);

    const tabs: CallSummaryTab[] = [
      ...(detailedSummaryCanvasId
        ? [
            {
              id: 'detailed-summary',
              kind: 'detailed-summary' as const,
              canvasId: detailedSummaryCanvasId,
              title: 'Summary',
            },
          ]
        : []),
      ...prdCanvasIds.map((canvasId, index) => ({
        id: `prd-${canvasId}`,
        kind: 'prd' as const,
        canvasId,
        title: `PRD ${index + 1}`,
      })),
    ];

    return { tabs, summaryMessageId: summaryMessageId ?? fallbackSummaryMessageId };
  }, [messages, call?.externalId, callMeta]);

  const isOwner = Boolean(currentUserId && call?.createdByUserId === currentUserId);
  const isParticipant = Boolean(
    currentUserId &&
    (call as (Call & { participants?: Array<{ userId: string }> }) | undefined)?.participants?.some(
      participant => participant.userId === currentUserId,
    ),
  );

  return {
    call,
    isResolvingCall,
    currentUserId,
    conversationId,
    messageChannelId,
    messageChannel,
    isChannelMember,
    summaryMessageId: derived.summaryMessageId,
    tabs: derived.tabs,
    isTabContentLoading:
      derived.tabs.length === 0 && Boolean(conversationId) && messagesDetails.type !== 'complete',
    isOwner,
    isCallAudience: isOwner || isParticipant || isCallChannelMember,
  };
}
