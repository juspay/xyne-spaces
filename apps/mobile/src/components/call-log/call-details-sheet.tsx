import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Image, Text, View, Pressable, Alert, Share, BackHandler, Platform } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { useCSSVariable } from 'uniwind';
import * as Clipboard from 'expo-clipboard';
import {
  Calendar,
  Copy,
  Download,
  Hash,
  Lock,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  ScrollTextIcon,
  Trash2,
} from 'lucide-react-native';

import { callService } from '@/src/services/Call/callService';
import { haptics } from '@/src/utils/haptics';
import type { CallDisplayData } from '@/src/types/calls';
import { useUsers } from '@/src/hooks/useUsers';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';
import { useAuth } from '@/src/contexts/AuthContext';
import { useIsInCall } from '@/src/hooks/useRoomMachine';
import { isScheduledCallJoinable } from '@/src/components/call-log/callHistoryItem.utils';
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

type ParticipantRow = {
  userId: string;
  name: string;
  picture: string | null;
  response: string;
  joinedAt: number | null;
  leftAt: number | null;
  isSelf: boolean;
};

const formatDateTime = (ts: number | null | undefined): string => {
  if (!ts) return '';
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time}`;
};

const ParticipantAvatar = ({ user }: { user: ParticipantRow }): React.ReactNode => (
  <View className='w-9 h-9 rounded-full overflow-hidden bg-accent items-center justify-center'>
    {user.picture ? (
      <Image source={{ uri: user.picture }} className='w-full h-full' />
    ) : (
      <Text className='text-sm font-semibold text-foreground'>
        {(user.name?.charAt(0) || '?').toUpperCase()}
      </Text>
    )}
  </View>
);

const CallDetailsSheet: React.FC<CallDetailsSheetProps> = ({
  call,
  isOpen,
  onOpenChange,
  onDeleted,
  onDismiss,
}) => {
  const allUsers = useUsers();
  const { user } = useAuth();
  const currentUserId = user?.user_id as string | undefined;

  const { accentBg } = useBubbleAccent();
  const brandColor = useCSSVariable('--color-action-primary') as string;
  const foregroundColor = useCSSVariable('--color-secondary-foreground') as string;
  const accentForeground = useCSSVariable('--color-accent-foreground') as string;
  const dangerColor = useCSSVariable('--color-status-danger') as string;

  const isInCall = useIsInCall();
  const afterDismissRef = useRef<(() => void) | null>(null);

  const usersById = useMemo(() => {
    const map = new Map<string, (typeof allUsers)[number]>();
    for (const u of allUsers) map.set(u.id, u);
    return map;
  }, [allUsers]);

  // History rows only carry the current user's participant row (participant-only query, as
  // on the dashboard); load the full roster while the sheet is open.
  const [fullParticipants] = useQuery(
    queries.callParticipantsByCallId({ callId: call?.id ?? '' }),
    {
      enabled: isOpen && !!call?.id,
    },
  );
  const callParticipants = useMemo(() => {
    const live = fullParticipants ?? [];
    return live.length > 0 ? live : (call?.participants ?? []);
  }, [call?.participants, fullParticipants]);

  const participants = useMemo<ParticipantRow[]>(() => {
    if (!call) return [];
    return callParticipants.map(p => {
      const u = usersById.get(p.userId);
      return {
        userId: p.userId,
        name: u?.name || u?.email || 'Unknown',
        picture: u?.picture ?? null,
        response: p.response ?? '',
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
        isSelf: p.userId === currentUserId,
      };
    });
  }, [call, callParticipants, usersById, currentUserId]);

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

  const handleJoin = useCallback(() => {
    if (!call) return;
    if (isInCall) {
      Alert.alert('Already in a call', 'Please leave your current call first.');
      return;
    }
    dismissSheetAfter(() => {
      router.push({
        pathname: '/native-call',
        params: {
          channelId: call.externalId,
          callType: call.callType,
          initiateCall: 'false',
        },
      });
    });
  }, [call, dismissSheetAfter, isInCall]);

  // Restart an ended call (re-invite the same participants)
  const handleRestartCall = useCallback(() => {
    if (!call) return;
    if (isInCall) {
      Alert.alert('Already in a call', 'Please leave your current call first.');
      return;
    }
    const channelId = call.channelId || call.externalId;
    dismissSheetAfter(() => {
      router.push({
        pathname: '/native-call',
        params: {
          channelId,
          callType: call.callType,
          initiateCall: 'true',
        },
      });
    });
  }, [call, dismissSheetAfter, isInCall]);

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

  const handleDeletePress = useCallback(() => {
    if (!call) return;
    Alert.alert(
      'Delete Call',
      'Are you sure you want to cancel this call?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async (): Promise<void> => {
            try {
              await callService.cancelScheduledCall(call.externalId);
              dismissSheetAfter(() => {
                onDeleted?.(call.id);
              });
            } catch {
              Alert.alert('Error', 'Failed to delete call');
            }
          },
        },
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
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {/* Header */}
          <View className='px-5 pt-2 pb-5 gap-4'>
            <Text
              className={cn(
                'text-xl font-medium',
                call.isMissed ? 'text-status-danger' : 'text-foreground',
              )}
            >
              {call.displayTitle}
            </Text>

            {/* Meta row */}
            {((): React.ReactNode => {
              const meta = call.metadata as Record<string, unknown> | null;
              const hasTranscript =
                !call.isActive && !call.isScheduled && Boolean(meta?.['conversationId']);
              const startTs = call.startedAt ?? call.startsAt ?? call.createdAt;

              const directionIcon = call.isScheduled ? (
                <Calendar size={12} color={brandColor} />
              ) : call.isMissed ? (
                <PhoneMissed size={12} color={dangerColor} />
              ) : call.isOutgoing ? (
                <PhoneOutgoing size={12} color={foregroundColor} />
              ) : (
                <PhoneIncoming size={12} color={brandColor} />
              );

              const directionLabel = call.isScheduled
                ? 'Scheduled'
                : call.isActive
                  ? 'Ongoing'
                  : call.isMissed
                    ? call.isOutgoing
                      ? 'No answer'
                      : 'Missed'
                    : call.isOutgoing
                      ? 'Outgoing'
                      : 'Incoming';

              const metaParts: string[] = [directionLabel];
              if (startTs) metaParts.push(formatDateTime(startTs));
              if (call.duration) metaParts.push(call.duration);

              return (
                <>
                  {metaParts.length > 0 && (
                    <View className='flex-row items-center'>
                      {directionIcon}
                      <Text
                        className={cn(
                          'text-sm ml-1.5',
                          call.isMissed ? 'text-status-danger' : 'text-secondary-foreground',
                        )}
                        numberOfLines={1}
                      >
                        {metaParts.join(' · ')}
                      </Text>
                    </View>
                  )}

                  {/* Channel pill */}
                  {call.isChannelCall && call.channel && (
                    <View className='flex-row'>
                      <View className='flex-row items-center px-3 h-8 rounded-full bg-secondary'>
                        {call.channelVisibility === 'PRIVATE' ? (
                          <Lock size={14} color={foregroundColor} />
                        ) : (
                          <Hash size={14} color={foregroundColor} />
                        )}
                        <Text className='text-sm text-foreground ml-1.5'>{call.channel.name}</Text>
                      </View>
                    </View>
                  )}

                  {/* Action buttons — dashboard-equivalent logic */}
                  {((): React.ReactNode => {
                    const joinable = isScheduledCallJoinable(call);
                    const isCurrentUserInvited = !!callParticipants.some(
                      p => p.userId === currentUserId,
                    );

                    // Active/Scheduled: show join button
                    const showJoinCall =
                      (call.isActive || call.isScheduled) && isCurrentUserInvited;

                    // Ended: transcript + download + restart phone button
                    const showEndedActions = !call.isActive && !call.isScheduled;

                    return (
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
                                joinable || call.isActive
                                  ? { backgroundColor: accentBg }
                                  : undefined
                              }
                            >
                              <Phone
                                size={18}
                                color={
                                  joinable || call.isActive ? accentForeground : foregroundColor
                                }
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
                                className='flex-1 flex-row items-center justify-center h-12 rounded-xl bg-secondary active:bg-secondary/80'
                              >
                                <ScrollTextIcon size={18} color={foregroundColor} />
                                <Text className='text-sm font-semibold text-foreground ml-2'>
                                  Transcript
                                </Text>
                              </Pressable>
                            )}
                            {Boolean(call.transcript) && (
                              <Pressable
                                onPress={handleDownloadTranscript}
                                className='flex-row items-center justify-center w-12 h-12 rounded-xl bg-secondary active:bg-secondary/80'
                              >
                                <Download size={18} color={foregroundColor} />
                              </Pressable>
                            )}
                            <Pressable
                              onPress={handleRestartCall}
                              className='flex-row items-center justify-center w-12 h-12 rounded-xl bg-secondary active:bg-secondary/80'
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
                              className='flex-1 flex-row items-center justify-center h-12 rounded-xl bg-secondary active:bg-secondary/80'
                            >
                              <ScrollTextIcon size={18} color={foregroundColor} />
                              <Text className='text-sm font-semibold text-foreground ml-2'>
                                Transcript
                              </Text>
                            </Pressable>
                          </View>
                        )}

                        {/* Copy Link + Delete — only for SCHEDULED calls */}
                        {call.isScheduled && (call.roomLink || call.isOutgoing) && (
                          <View className='flex-row gap-2'>
                            {call.roomLink && (
                              <Pressable
                                onPress={handleCopyLink}
                                className='flex-1 flex-row items-center justify-center h-12 rounded-xl bg-secondary active:bg-secondary/80'
                              >
                                <Copy size={18} color={foregroundColor} />
                                <Text className='text-sm font-semibold text-foreground ml-2'>
                                  Copy Link
                                </Text>
                              </Pressable>
                            )}
                            {call.isOutgoing && (
                              <Pressable
                                onPress={handleDeletePress}
                                className='flex-1 flex-row items-center justify-center h-12 rounded-xl bg-secondary active:bg-secondary/80'
                              >
                                <Trash2 size={18} color={dangerColor} />
                                <Text className='text-sm font-semibold text-status-danger ml-2'>
                                  Delete
                                </Text>
                              </Pressable>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })()}
                </>
              );
            })()}
          </View>

          {/* Participants */}
          {participants.length > 0 && (
            <View className='mt-6'>
              <View className='px-5 pb-3 flex-row items-center'>
                <Text className='text-xs font-semibold uppercase text-secondary-foreground tracking-wide'>
                  Participants
                </Text>
                <Text className='text-xs text-secondary-foreground ml-2'>
                  {participants.length}
                </Text>
              </View>

              {participants.map(p => (
                <View key={p.userId} className='flex-row items-center px-5 py-2'>
                  <ParticipantAvatar user={p} />
                  <Text className='text-sm text-foreground ml-3 flex-1' numberOfLines={1}>
                    {p.name}
                    {p.isSelf && <Text className='text-secondary-foreground'> (you)</Text>}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </BottomSheetScrollView>
      ) : null}
    </AppBottomSheet>
  );
};

export { CallDetailsSheet };
