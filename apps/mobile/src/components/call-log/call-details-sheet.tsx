import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Text, View, Pressable, Alert, Share, BackHandler, Platform } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { AvatarFace } from '@/src/components/ui/avatar';
import { useUserSnapshot } from '@/src/components/ui/avatar/avatar.utils';
import { router } from 'expo-router';
import { useCSSVariable } from 'uniwind';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Copy,
  Download,
  Hash,
  Lock,
  Pencil,
  Phone,
  ScrollTextIcon,
  Trash2,
  X,
} from 'lucide-react-native';

import { XyneAIStarIcon } from '@/src/components/icons';
import { channelScopeParams } from '@/src/features/xyne-ai/model/askAIParams';
import { callService } from '@/src/services/Call/callService';
import { haptics } from '@/src/utils/haptics';
import { Event, logger } from '@/src/utils/logger';
import type { CallDisplayData } from '@/src/types/calls';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';
import { useAuth } from '@/src/contexts/AuthContext';
import { useIsInCall } from '@/src/hooks/useRoomMachine';
import {
  canEditScheduledCallParticipants,
  isScheduledCallJoinable,
  isScheduledCallManageable,
} from '@/src/components/call-log/callHistoryItem.utils';
import { stateMachineActor } from '@/src/machines/stateMachine';
import { openEditSession } from '@/src/features/schedule-call/editSession';
import { buildEditCallData } from '@/src/features/schedule-call/utils/types';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { cn } from '@/src/utils/cn';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

interface CallDetailsSheetProps {
  call: CallDisplayData | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (callId: string) => void;
  onDismiss?: () => void;
}

type ParticipantRow = { userId: string; isSelf: boolean; isHost: boolean };

const ListFooter = <View className='h-4' />;

const keyExtractor = (p: ParticipantRow): string => p.userId;

const ParticipantItem = memo(function ParticipantItem({
  p,
}: {
  p: ParticipantRow;
}): React.ReactNode {
  const u = useUserSnapshot(p.userId);
  return (
    <View className='flex-row items-center gap-3 px-4 min-h-14'>
      <AvatarFace userId={p.userId} size={40} />
      <Text className='text-base text-foreground flex-1' numberOfLines={1}>
        {u?.name || u?.email || 'Unknown'}
        {p.isSelf && <Text className='text-secondary-foreground'> (you)</Text>}
      </Text>
      {p.isHost && (
        <Text className='text-xs font-medium text-status-success bg-status-success/10 px-2 py-0.5 rounded-lg overflow-hidden'>
          Host
        </Text>
      )}
    </View>
  );
});

const renderParticipant = ({ item }: { item: ParticipantRow }): React.ReactElement => (
  <ParticipantItem p={item} />
);

const CallDetailsSheet: React.FC<CallDetailsSheetProps> = ({
  call,
  isOpen,
  onOpenChange,
  onDeleted,
  onDismiss,
}) => {
  const { user } = useAuth();
  const currentUserId = user?.user_id as string | undefined;

  const { accentBg } = useBubbleAccent();
  const successColor = useCSSVariable('--color-status-success') as string;
  const foregroundColor = useCSSVariable('--color-secondary-foreground') as string;
  const accentForeground = useCSSVariable('--color-accent-foreground') as string;
  const dangerColor = useCSSVariable('--color-status-danger') as string;

  const isInCall = useIsInCall();
  const afterDismissRef = useRef<(() => void) | null>(null);

  // History rows only carry the current user's participant row (participant-only query, as
  // on the dashboard); load the full roster while the sheet is open.
  const [fullParticipants, fullParticipantsDetails] = useQuery(
    queries.callParticipantsByCallId({ callId: call?.id ?? '' }),
    {
      enabled: isOpen && !!call?.id,
    },
  );
  const callParticipants = useMemo(() => {
    const live = fullParticipants ?? [];
    return live.length > 0 ? live : (call?.participants ?? []);
  }, [call?.participants, fullParticipants]);

  // Names/avatars are resolved per row (useUserSnapshot), so the full user list never re-renders the sheet.
  const participants = useMemo<ParticipantRow[]>(
    () =>
      callParticipants.map(p => ({
        userId: p.userId,
        isSelf: p.userId === currentUserId,
        isHost: p.userId === call?.createdByUserId,
      })),
    [call?.createdByUserId, callParticipants, currentUserId],
  );

  const {
    hasTranscript,
    directionLabel,
    subtitle,
    dateMonth,
    dateDay,
    directionIcon,
    tone,
    joinable,
    showJoinCall,
    showEndedActions,
  } = useMemo(() => {
    const meta = call?.metadata as Record<string, unknown> | null | undefined;
    const isEnded = !call?.isActive && !call?.isScheduled;
    const startTs = call?.startedAt ?? call?.startsAt ?? call?.createdAt;
    const directionLabel = call?.isScheduled
      ? 'Scheduled'
      : call?.isActive
        ? 'Ongoing'
        : call?.isMissed
          ? call.isOutgoing
            ? 'No answer'
            : 'Missed'
          : call?.isOutgoing
            ? 'Outgoing'
            : 'Incoming';
    const d = startTs ? new Date(startTs) : null;
    const subtitle = [
      d?.toLocaleDateString(undefined, { weekday: 'long' }),
      d?.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
      call?.duration,
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      hasTranscript: !call?.isActive && !call?.isScheduled && Boolean(meta?.['conversationId']),
      directionLabel,
      subtitle,
      dateMonth: d?.toLocaleDateString(undefined, { month: 'short' }).toUpperCase() ?? '',
      dateDay: d?.getDate() ?? null,
      tone:
        call?.isScheduled || call?.isActive
          ? 'success'
          : call?.isMissed && !call.isOutgoing
            ? 'danger'
            : 'muted',
      directionIcon: call?.isScheduled ? (
        <Calendar size={12} color={successColor} />
      ) : call?.isActive ? (
        <Phone size={12} color={successColor} />
      ) : call?.isMissed ? (
        call.isOutgoing ? (
          <X size={12} color={foregroundColor} />
        ) : (
          <ArrowDownLeft size={12} color={dangerColor} />
        )
      ) : call?.isOutgoing ? (
        <ArrowUpRight size={12} color={foregroundColor} />
      ) : (
        <ArrowDownLeft size={12} color={foregroundColor} />
      ),
      joinable: call ? isScheduledCallJoinable(call) : false,
      // Active/Scheduled: join button for invited users
      showJoinCall:
        Boolean(call?.isActive || call?.isScheduled) &&
        callParticipants.some(p => p.userId === currentUserId),
      // Ended: transcript + download + restart
      showEndedActions: isEnded,
    };
  }, [call, callParticipants, currentUserId, successColor, dangerColor, foregroundColor]);

  useEffect(() => {
    if (isOpen) {
      afterDismissRef.current = null;
    }
  }, [isOpen]);

  const dismissSheet = useCallback(() => {
    afterDismissRef.current = null;
    onOpenChange(false);
  }, [onOpenChange]);

  const dismissSheetAfter = useCallback(
    (afterDismiss: () => void) => {
      afterDismissRef.current = afterDismiss;
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const handleSheetOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onOpenChange(false);
      }
    },
    [onOpenChange],
  );

  const handleDismiss = useCallback((): void => {
    const afterDismiss = afterDismissRef.current;
    afterDismissRef.current = null;
    afterDismiss?.();
    onDismiss?.();
  }, [onDismiss]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissSheet();
      return true;
    });
    return (): void => subscription.remove();
  }, [dismissSheet, isOpen]);

  // initiateCall=true restarts an ended call (re-invites the same participants)
  const startCall = useCallback(
    (initiateCall: boolean) => {
      if (!call) return;
      if (isInCall) {
        Alert.alert('Already in a call', 'Please leave your current call first.');
        return;
      }
      const channelId = initiateCall ? call.channelId || call.externalId : call.externalId;
      dismissSheetAfter(() => {
        router.push({
          pathname: '/native-call',
          params: { channelId, callType: call.callType, initiateCall: String(initiateCall) },
        });
      });
    },
    [call, dismissSheetAfter, isInCall],
  );
  const handleJoin = useCallback(() => startCall(false), [startCall]);
  const handleRestartCall = useCallback(() => startCall(true), [startCall]);

  const handleViewTranscript = useCallback(() => {
    if (!call) return;
    const meta = call.metadata as Record<string, unknown> | null;
    const threadId = meta?.['conversationId'] as string | undefined;
    const systemMessageId = meta?.['systemMessageId'] as string | undefined;
    const channelId = call.channelId;
    if (!threadId || !channelId) return;

    dismissSheetAfter(() => {
      router.push({
        pathname: '/chat/[channelId]',
        params: { channelId },
      });
      router.push({
        pathname: '/chat/[channelId]/[threadId]',
        params: {
          channelId,
          threadId,
          ...(systemMessageId ? { messageId: systemMessageId } : {}),
        },
      });
    });
  }, [call, dismissSheetAfter]);

  const handleAskAI = useCallback(() => {
    const conversationId = call?.metadata?.['conversationId'];
    if (typeof conversationId !== 'string') return;
    dismissSheetAfter(() => {
      router.push({
        pathname: '/xyne-ai',
        params: {
          ...channelScopeParams(call?.channel ?? undefined),
          conversationId,
          previewText: call?.title ?? 'Call',
        },
      });
    });
  }, [call, dismissSheetAfter]);

  const handleCopyLink = useCallback(async () => {
    if (!call?.roomLink) return;
    await Clipboard.setStringAsync(call.roomLink);
    void haptics.success();
    dismissSheet();
  }, [call, dismissSheet]);

  const handleDownloadTranscript = useCallback(async () => {
    if (!call) return;
    try {
      const { data } = await callService.downloadTranscript(call.externalId);
      await Share.share({ message: data, title: `Transcript – ${call.displayTitle}` });
    } catch {
      Alert.alert('Error', 'Failed to load transcript');
    }
  }, [call]);

  const canManage = !!call && isScheduledCallManageable(call, currentUserId);
  const canEdit = useMemo(
    () =>
      canManage ||
      (!!call &&
        canEditScheduledCallParticipants(
          call,
          currentUserId,
          stateMachineActor.getSnapshot().context.visibleChannels,
        )),
    [call, canManage, currentUserId],
  );
  const isRosterLoaded = fullParticipantsDetails.type === 'complete';
  const handleEditPress = useCallback((): void => {
    if (!call || !isRosterLoaded) return;
    const roster = (fullParticipants ?? []).map(p => ({
      userId: p.userId,
      email: p.email ?? null,
      isExternal: p.isExternal,
      invitedBy: p.invitedBy,
    }));
    dismissSheetAfter(() => {
      openEditSession(buildEditCallData(call, roster));
      router.push('/(protected)/schedule-call');
    });
  }, [call, dismissSheetAfter, fullParticipants, isRosterLoaded]);

  const handleDeletePress = useCallback(() => {
    if (!call) return;
    const seriesId = call.recurringSeriesId;
    const cancel = (run: () => Promise<void>) => async (): Promise<void> => {
      try {
        await run();
        dismissSheetAfter(() => {
          onDeleted?.(call.id);
        });
      } catch (error) {
        logger.error(Event.API_CALL_FAILED, {
          context: 'call-details delete',
          error: String(error),
        });
        Alert.alert('Error', 'Failed to delete call');
      }
    };
    Alert.alert(
      'Delete Call',
      seriesId
        ? 'Cancel just this call, or every call in the series?'
        : 'Are you sure you want to cancel this call?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: seriesId ? 'This call' : 'Delete',
          style: 'destructive',
          onPress: cancel(() => callService.cancelScheduledCall(call.externalId)),
        },
        ...(seriesId
          ? [
              {
                text: 'Entire series',
                style: 'destructive' as const,
                onPress: cancel(() => callService.cancelRecurringSeries(seriesId)),
              },
            ]
          : []),
      ],
      { cancelable: true },
    );
  }, [call, dismissSheetAfter, onDeleted]);

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={handleSheetOpenChange}
      onDismiss={handleDismiss}
      mode='dynamic'
    >
      {call ? (
        <BottomSheetFlatList
          data={participants}
          keyExtractor={keyExtractor}
          renderItem={renderParticipant}
          ListFooterComponent={ListFooter}
          ListHeaderComponent={
            <>
              {/* Header */}
              <View className='px-4 pt-1 pb-3 gap-2'>
                <View className='flex-row items-baseline-last gap-3'>
                  {dateDay !== null && (
                    <View className='w-14 h-14 rounded-xl bg-secondary items-center justify-center'>
                      <Text
                        className={cn(
                          'text-xs font-semibold',
                          tone === 'success' && 'text-status-success',
                          tone === 'danger' && 'text-status-danger',
                          tone === 'muted' && 'text-secondary-foreground',
                        )}
                      >
                        {dateMonth}
                      </Text>
                      <Text className='text-xl font-bold text-foreground'>{dateDay}</Text>
                      {/* Direction badge — label kept for screen readers */}
                      <View
                        accessible
                        accessibilityLabel={directionLabel}
                        className={cn(
                          '-bottom-0.5 -right-0.5 absolute w-5 h-5 rounded-full items-center justify-center outline-3 outline-card bg-secondary',
                          tone === 'success' && 'bg-status-success/15',
                          tone === 'danger' && 'bg-status-danger/15',
                          tone === 'muted' && 'bg-accent',
                        )}
                      >
                        {directionIcon}
                      </View>
                    </View>
                  )}
                  <View className='flex-1'>
                    <Text
                      className={cn(
                        'text-lg font-semibold',
                        call.isMissed ? 'text-status-danger' : 'text-foreground',
                      )}
                      numberOfLines={2}
                    >
                      {call.displayTitle}
                    </Text>
                    {subtitle !== '' && (
                      <Text className='text-sm text-secondary-foreground' numberOfLines={1}>
                        {subtitle}
                      </Text>
                    )}
                  </View>
                </View>

                {/* Channel pill */}
                {call.isChannelCall && call.channel && (
                  <View className='flex-row'>
                    <View className='flex-row items-center px-2 h-6 rounded-full gap-1 bg-secondary'>
                      {call.channelVisibility === 'PRIVATE' ? (
                        <Lock size={12} color={foregroundColor} />
                      ) : (
                        <Hash size={12} color={foregroundColor} />
                      )}
                      <Text className='text-xs text-foreground'>{call.channel.name}</Text>
                    </View>
                  </View>
                )}

                <>
                  {/* Action buttons — dashboard-equivalent logic */}
                  <View className='gap-2'>
                    {/* Join Call (active / upcoming scheduled) */}
                    {showJoinCall && (
                      <View className='flex-row gap-2'>
                        <Pressable
                          onPress={handleJoin}
                          className={cn(
                            'flex-1 flex-row items-center justify-center h-12 rounded-xl',
                            joinable || call.isActive
                              ? 'active:opacity-90'
                              : 'bg-secondary active:bg-secondary/80',
                          )}
                          style={
                            joinable || call.isActive ? { backgroundColor: accentBg } : undefined
                          }
                        >
                          <Phone
                            size={18}
                            color={joinable || call.isActive ? accentForeground : foregroundColor}
                          />
                          <Text
                            className={cn(
                              'text-sm font-semibold ml-2',
                              joinable || call.isActive
                                ? 'text-accent-foreground'
                                : 'text-foreground',
                            )}
                          >
                            {call.isActive ? 'Join call' : 'Join Call'}
                          </Text>
                        </Pressable>
                      </View>
                    )}

                    {/* Ended call: transcript + download + restart */}
                    {showEndedActions && (
                      <View className='flex-row gap-2'>
                        {hasTranscript && (
                          <Pressable
                            onPress={handleViewTranscript}
                            className='flex-1 flex-row items-center justify-center h-11 rounded-xl bg-secondary active:bg-secondary/80'
                          >
                            <ScrollTextIcon size={18} color={foregroundColor} />
                            <Text className='text-sm font-semibold text-foreground ml-2'>
                              Transcript
                            </Text>
                          </Pressable>
                        )}
                        {hasTranscript && (
                          <Pressable
                            onPress={handleAskAI}
                            accessibilityLabel='Ask AI'
                            className='flex-row items-center justify-center w-11 h-11 rounded-xl bg-secondary active:bg-secondary/80'
                          >
                            <XyneAIStarIcon />
                          </Pressable>
                        )}
                        {Boolean(call.transcript) && (
                          <Pressable
                            onPress={handleDownloadTranscript}
                            className='flex-row items-center justify-center w-11 h-11 rounded-xl bg-secondary active:bg-secondary/80'
                          >
                            <Download size={18} color={foregroundColor} />
                          </Pressable>
                        )}
                        <Pressable
                          onPress={handleRestartCall}
                          className='flex-row items-center justify-center w-11 h-11 rounded-xl bg-secondary active:bg-secondary/80'
                        >
                          <Phone size={18} color={foregroundColor} />
                        </Pressable>
                      </View>
                    )}

                    {/* Scheduled: transcript (if somehow already available) */}
                    {call.isScheduled && hasTranscript && (
                      <View className='flex-row gap-2'>
                        <Pressable
                          onPress={handleViewTranscript}
                          className='flex-1 flex-row items-center justify-center h-11 rounded-xl bg-secondary active:bg-secondary/80'
                        >
                          <ScrollTextIcon size={18} color={foregroundColor} />
                          <Text className='text-sm font-semibold text-foreground ml-2'>
                            Transcript
                          </Text>
                        </Pressable>
                      </View>
                    )}

                    {/* Edit + Copy link + Delete — only for SCHEDULED calls */}
                    {call.isScheduled && (
                      <View className='flex-row gap-2'>
                        {canEdit && (
                          <Pressable
                            onPress={handleEditPress}
                            disabled={!isRosterLoaded}
                            className={cn(
                              'flex-1 h-16 gap-1 items-center justify-center rounded-2xl bg-secondary active:bg-secondary/80',
                              !isRosterLoaded && 'opacity-50',
                            )}
                          >
                            <Pencil size={20} color={foregroundColor} />
                            <Text className='text-sm font-medium text-foreground'>Edit</Text>
                          </Pressable>
                        )}
                        {call.roomLink && (
                          <Pressable
                            onPress={handleCopyLink}
                            className='flex-1 h-16 gap-1 items-center justify-center rounded-2xl bg-secondary active:bg-secondary/80'
                          >
                            <Copy size={20} color={foregroundColor} />
                            <Text className='text-sm font-medium text-foreground'>Copy link</Text>
                          </Pressable>
                        )}
                        {canManage && (
                          <Pressable
                            onPress={handleDeletePress}
                            className='flex-1 h-16 gap-1 items-center justify-center rounded-2xl bg-secondary active:bg-secondary/80'
                          >
                            <Trash2 size={20} color={dangerColor} />
                            <Text className='text-sm font-medium text-status-danger'>Delete</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                </>
              </View>

              {/* Participants */}
              {participants.length > 0 && (
                <View className='mt-2 px-4 pb-2 flex-row items-center'>
                  <Text className='text-xs font-semibold uppercase text-secondary-foreground tracking-wide'>
                    Participants
                  </Text>
                  <Text className='text-xs text-secondary-foreground ml-2'>
                    {participants.length}
                  </Text>
                </View>
              )}
            </>
          }
        />
      ) : null}
    </AppBottomSheet>
  );
};

export { CallDetailsSheet };
