import { KeyboardAwareLegendList, useKeyboardChatComposerInset } from '@legendapp/list/keyboard';
import type { LegendListRef } from '@legendapp/list/react-native';
import { useSelector } from '@xstate/react';
import { ChannelScopeType, ChannelType } from '@xyne/shared';
import { sendMessage } from '@xyne/shared/messages';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { KeyboardGestureArea } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable, useUniwind } from 'uniwind';
import { ArrowLeft, Check, File, Hash, ImageIcon, SendHorizontal } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';
import Avatar from '@/src/components/ui/avatar';
import { useAuth } from '@/src/contexts/AuthContext';
import {
  IncomingSharePayload,
  ShareTargetNative,
  normalizeIncomingSharePayload,
  sanitizeIncomingSharePayload,
} from '@/src/features/share-target';
import { useAllUnreadCount, getChannelDisplayName } from '@/src/hooks/useChannels';
import { useDmList } from '@/src/hooks/useDmList';
import { useDraftAttachments } from '@/src/hooks/useDraftAttachments';
import { useUsers } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { ChannelService } from '@/src/services/ChannelService';
import type { DmListItemData, LastMessagePreview } from '@/src/types/dm-list-item';
import { parseDMParticipantIds } from '@/src/utils/channel-utils';
import { plainTextToHtml } from '@/src/utils/plainTextToHtml';
import SearchBar from '@/src/components/ui/search-bar';
import { ArrowForwardIcon } from '@/src/components/icons';
import { tabRoute } from '@/src/navigation/routes';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import {
  assertAttachmentCountWithinLimit,
  getAttachmentRejectionReason,
} from '@/src/components/input-composer/utils/attachmentPolicy';

type ShareDestinationKind = 'dm' | 'channel';
type BaseChatSurface = 'dms' | 'channels';

type ShareDestination = {
  key: string;
  id: string;
  kind: ShareDestinationKind;
  title: string;
  subtitle: string;
  surface: BaseChatSurface;
  participantUserIds: string[];
  recipientUserIds: string[];
  unreadCount?: number;
  timestampLabel?: string;
};

type SendTarget = {
  channelId: string;
  surface: BaseChatSurface;
};

const NATIVE_DM_ROOT = tabRoute('dms');
const SHARE_COMPOSER_ESTIMATED_HEIGHT = 128;
const VISIBLE_CHANNEL_WAIT_TIMEOUT_MS = 4500;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const waitForVisibleChannel = async (
  channelId: string,
  timeoutMs = VISIBLE_CHANNEL_WAIT_TIMEOUT_MS,
): Promise<void> => {
  const hasChannel = (): boolean =>
    stateMachineActor
      .getSnapshot()
      .context.visibleChannels.some(channel => channel.id === channelId);

  if (hasChannel()) return;

  await new Promise<void>(resolve => {
    let subscription: { unsubscribe: () => void } | null = null;
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      resolve();
    };

    const timeout = setTimeout(finish, timeoutMs);

    subscription = stateMachineActor.subscribe(snapshot => {
      if (!snapshot.context.visibleChannels.some(channel => channel.id === channelId)) return;
      clearTimeout(timeout);
      finish();
    });
  });
};

const buildAttachments = (payload: IncomingSharePayload): ComposerAttachment[] =>
  payload.files.map(file => ({
    attachmentId: uuidv4(),
    originalFilename: file.name || 'shared-file',
    mimetype: file.type || 'application/octet-stream',
    size: Number(file.size || 0),
    localUri: file.uri,
    source: 'file',
    status: 'local',
  }));

const getSharePayloadValidationError = (payload: IncomingSharePayload): string | null => {
  try {
    assertAttachmentCountWithinLimit(0, payload.files.length);
  } catch (error) {
    return error instanceof Error ? error.message : 'Too many files to share';
  }

  for (const file of payload.files) {
    const rejectionReason = getAttachmentRejectionReason({
      originalFilename: file.name,
      size: Number(file.size) || 0,
    });
    if (rejectionReason) return rejectionReason;
  }

  return null;
};

const getLastMessageText = (preview: LastMessagePreview | undefined): string => {
  if (!preview) return 'Direct message';
  if (preview.variant === 'attachment') {
    return preview.text || preview.attachmentKind;
  }
  return preview.text || 'Direct message';
};

const getPayloadTitle = (payload: IncomingSharePayload): string => {
  if (payload.files.length === 0) return 'Send text';

  const imageCount = payload.files.filter(file => file.type?.startsWith('image/')).length;
  const videoCount = payload.files.filter(file => file.type?.startsWith('video/')).length;

  if (imageCount === payload.files.length) {
    return payload.files.length === 1 ? 'Send photo' : `Send ${payload.files.length} photos`;
  }
  if (videoCount === payload.files.length) {
    return payload.files.length === 1 ? 'Send video' : `Send ${payload.files.length} videos`;
  }
  return payload.files.length === 1 ? 'Send file' : `Send ${payload.files.length} files`;
};

const getRecipientTitle = (targets: readonly ShareDestination[]): string => {
  if (targets.length === 0) return 'Select Chat';
  return `${targets.length} recipient${targets.length === 1 ? '' : 's'}`;
};

const getRecipientLine = (targets: readonly ShareDestination[]): string => {
  const names = targets.map(target => target.title);
  if (names.length === 0) return '';
  if (names.length <= 2) return `To ${names.join(', ')}`;
  return `To ${names.slice(0, 2).join(', ')} +${names.length - 2}`;
};

const getSharePlainText = (caption: string, payload: IncomingSharePayload): string =>
  [caption, payload.text].filter(Boolean).join('\n').trim();

const buildMessageContent = (caption: string, payload: IncomingSharePayload): string => {
  const combinedText = getSharePlainText(caption, payload);
  // Attachment-only shares need a non-empty HTML body for the send mutator;
  // chat paint hides this when media is present.
  if (!combinedText) return '<p></p>';
  return plainTextToHtml(combinedText);
};

const getDmParticipantUserIds = (
  item: DmListItemData,
  currentUserId: string | undefined,
): string[] => {
  const withoutCurrentUser = item.participantUserIds.filter(id => id !== currentUserId);
  return withoutCurrentUser.length > 0 ? withoutCurrentUser : [...item.participantUserIds];
};

const normalizeUserIds = (ids: readonly string[]): string[] =>
  [...new Set(ids.filter(Boolean))].sort();

const memberKey = (ids: readonly string[]): string => normalizeUserIds(ids).join(',');

const getDmRecipientUserIds = (
  item: DmListItemData,
  currentUserId: string | undefined,
  visibleChannelsById: ReadonlyMap<string, { name: string; scopeType: ChannelScopeType }>,
): string[] => {
  const channel = visibleChannelsById.get(item.id);
  const fromChannel = channel
    ? parseDMParticipantIds(channel).filter(id => id !== currentUserId)
    : [];

  if (fromChannel.length > 0) {
    return normalizeUserIds(fromChannel);
  }

  return normalizeUserIds(getDmParticipantUserIds(item, currentUserId));
};

const findExistingVisibleGroupDm = (
  visibleChannels: readonly { id: string; name: string; scopeType: ChannelScopeType }[],
  currentUserId: string | undefined,
  recipientUserIds: readonly string[],
): { id: string } | undefined => {
  if (!currentUserId) return undefined;

  const expectedKey = memberKey([currentUserId, ...recipientUserIds]);
  return visibleChannels.find(channel => {
    if (channel.scopeType !== ChannelScopeType.GROUP_DM) return false;
    return memberKey(parseDMParticipantIds(channel)) === expectedKey;
  });
};

function ShareTargetScreen(): ReactElement {
  const { shareId } = useLocalSearchParams<{ shareId?: string }>();
  const { user, token } = useAuth();
  const zero = useZero();
  const { addAttachments } = useDraftAttachments();
  const insets = useSafeAreaInsets();
  const brand = (useCSSVariable('--color-chat-unread-count-badge-bg') as string) || '#335E40';

  const foreground = useCSSVariable('--color-foreground') as string;
  const channelService = useMemo(() => new ChannelService(token), [token]);

  const listRef = useRef<LegendListRef>(null);
  const composerRef = useRef<View>(null);
  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(
    listRef,
    composerRef,
    SHARE_COMPOSER_ESTIMATED_HEIGHT,
  );

  const [payload, setPayload] = useState<IncomingSharePayload | null>(null);
  const [caption, setCaption] = useState('');
  const [query, setQuery] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<ShareDestination[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isPayloadLoading, setIsPayloadLoading] = useState(true);
  const [shareLoadError, setShareLoadError] = useState<string | null>(null);
  const [pendingSendNavigation, setPendingSendNavigation] = useState<SendTarget | null>(null);
  const payloadRef = useRef<IncomingSharePayload | null>(null);
  const isSendingRef = useRef(false);
  const isDismissingRef = useRef(false);

  const currentUserId = user?.user_id;
  const selectionMode: 'none' | 'dms' | 'channels' = useMemo(() => {
    const first = selectedTargets[0];
    if (!first) return 'none';
    return first.kind === 'channel' ? 'channels' : 'dms';
  }, [selectedTargets]);

  const {
    items: dmItems,
    loadMore: loadMoreDms,
    hasMore: hasMoreDms,
    isLoading: isLoadingDms,
    isLoadingMore: isLoadingMoreDms,
  } = useDmList({
    searchQuery: selectionMode === 'channels' ? '' : query,
    filterTab: 'all',
    liveDataEnabled: true,
  });

  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);
  const unreadCounts = useAllUnreadCount(selectionMode !== 'dms');
  const users = useUsers();
  const visibleChannelsById = useMemo(
    () => new Map(visibleChannels.map(channel => [channel.id, channel])),
    [visibleChannels],
  );

  useEffect(() => {
    let cancelled = false;

    setIsPayloadLoading(true);
    setShareLoadError(null);
    setPayload(null);

    void ShareTargetNative.getInitialShare(shareId ?? null)
      .then(next => {
        if (cancelled) return;

        if (!next) {
          setPayload(null);
          setShareLoadError('This shared item is no longer available.');
          return;
        }

        const normalized = normalizeIncomingSharePayload(next);
        const sanitized = sanitizeIncomingSharePayload(normalized);
        const validationError = getSharePayloadValidationError(sanitized);
        if (validationError) {
          setPayload(null);
          setShareLoadError(validationError);
          void ShareTargetNative.clearShare(next.id).catch(() => undefined);
          return;
        }

        setPayload(sanitized);
        setShareLoadError(null);
      })
      .catch(error => {
        if (cancelled) return;
        setPayload(null);
        setShareLoadError(
          error?.code === 'SHARE_TOO_MANY_FILES'
            ? error.message
            : 'Could not load the shared item.',
        );
      })
      .finally(() => {
        if (!cancelled) setIsPayloadLoading(false);
      });

    return (): void => {
      cancelled = true;
    };
  }, [shareId]);

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  usePreventRemove(isSending, () => {
    Alert.alert('Please wait', 'Your shared item is still being sent.');
  });

  useEffect(() => {
    if (isSending || !pendingSendNavigation) return;

    const target = pendingSendNavigation;
    setPendingSendNavigation(null);
    router.replace({
      pathname: '/(protected)/chat/[channelId]',
      params: {
        channelId: target.channelId,
        surface: target.surface,
        from: 'share_target',
      },
    } as never);
  }, [isSending, pendingSendNavigation]);

  const dmTargets = useMemo<ShareDestination[]>(() => {
    if (selectionMode === 'channels') return [];

    return dmItems
      .filter(item => item.scopeType === ChannelScopeType.DM)
      .map(item => ({
        key: `dm:${item.id}`,
        id: item.id,
        kind: 'dm' as const,
        title: item.title,
        subtitle: getLastMessageText(item.lastMessage),
        surface: 'dms' as const,
        participantUserIds: getDmParticipantUserIds(item, currentUserId),
        recipientUserIds: getDmRecipientUserIds(item, currentUserId, visibleChannelsById),
        ...(item.unreadCount ? { unreadCount: item.unreadCount } : {}),
        ...(item.timestampLabel ? { timestampLabel: item.timestampLabel } : {}),
      }));
  }, [currentUserId, dmItems, selectionMode, visibleChannelsById]);

  const channelTargets = useMemo<ShareDestination[]>(() => {
    if (selectionMode === 'dms') return [];

    const normalizedQuery = query.trim().toLowerCase();

    return visibleChannels
      .filter(channel => {
        if (channel.type === ChannelType.EMAIL) return false;
        if (channel.scopeType !== ChannelScopeType.DEFAULT) return false;
        if (channel.isArchived) return false;
        const title = getChannelDisplayName(channel, currentUserId ?? '', users);
        return normalizedQuery.length === 0 || title.toLowerCase().includes(normalizedQuery);
      })
      .map(channel => {
        const title = getChannelDisplayName(channel, currentUserId ?? '', users);
        return {
          key: `channel:${channel.id}`,
          id: channel.id,
          kind: 'channel' as const,
          title,
          subtitle: 'Channel',
          surface: 'channels' as const,
          participantUserIds: [],
          recipientUserIds: [],
          ...(unreadCounts[channel.id] ? { unreadCount: unreadCounts[channel.id] } : {}),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [currentUserId, query, selectionMode, unreadCounts, users, visibleChannels]);

  const rows = useMemo<ShareDestination[]>(() => {
    if (selectionMode === 'dms') return dmTargets;
    if (selectionMode === 'channels') return channelTargets;
    return [...dmTargets, ...channelTargets];
  }, [channelTargets, dmTargets, selectionMode]);

  const selectedKeys = useMemo(
    () => new Set(selectedTargets.map(target => target.key)),
    [selectedTargets],
  );

  const selectedCount = selectedTargets.length;
  const canSend = selectedCount > 0 && !isSending;
  const recipientLine = useMemo(() => getRecipientLine(selectedTargets), [selectedTargets]);
  const keyboardInsetProps = useMemo(
    () => (selectedCount > 0 && contentInsetEndAdjustment ? { contentInsetEndAdjustment } : {}),
    [contentInsetEndAdjustment, selectedCount],
  );
  const listExtraData = useMemo(
    () => `${selectionMode}:${[...selectedKeys].join(':')}:${brand}`,
    [brand, selectedKeys, selectionMode],
  );

  const handleBack = useCallback(async () => {
    if (isSendingRef.current || isDismissingRef.current) return;
    isDismissingRef.current = true;

    try {
      const activePayload = payloadRef.current;
      if (activePayload) {
        await ShareTargetNative.clearShare(activePayload.id).catch(() => undefined);
      }

      if (router.canGoBack()) {
        router.back();
        return;
      }

      router.replace(NATIVE_DM_ROOT as never);
    } finally {
      isDismissingRef.current = false;
    }
  }, []);

  useEffect(() => {
    return (): void => {
      const activePayload = payloadRef.current;
      if (!activePayload || isSendingRef.current) return;
      void ShareTargetNative.clearShare(activePayload.id).catch(() => undefined);
    };
  }, []);

  const toggleTarget = useCallback((target: ShareDestination) => {
    Keyboard.dismiss();
    setQuery('');

    setSelectedTargets(previous => {
      const alreadySelected = previous.some(item => item.key === target.key);

      if (target.kind === 'channel') {
        return alreadySelected ? [] : [target];
      }

      if (alreadySelected) {
        return previous.filter(item => item.key !== target.key);
      }

      return [...previous, target];
    });
  }, []);

  const resolveSendTarget = useCallback(async (): Promise<SendTarget> => {
    const firstTarget = selectedTargets[0];
    if (!firstTarget) {
      throw new Error('Select a recipient first.');
    }

    if (firstTarget.kind === 'channel') {
      return { channelId: firstTarget.id, surface: 'channels' };
    }

    if (selectedTargets.length === 1) {
      return { channelId: firstTarget.id, surface: 'dms' };
    }

    const participantIds = normalizeUserIds(
      selectedTargets.flatMap(target => target.recipientUserIds),
    );

    if (participantIds.length === 0) {
      throw new Error('Could not resolve selected DM participants.');
    }

    const existingGroupDm = findExistingVisibleGroupDm(
      visibleChannels,
      currentUserId,
      participantIds,
    );
    if (existingGroupDm) {
      return { channelId: existingGroupDm.id, surface: 'dms' };
    }

    const response = await channelService.createDm({ participantIds });
    await waitForVisibleChannel(response.id);

    // Give Zero one more small frame after the app-state channel row arrives.
    // This avoids a first-send race on newly created group DMs.
    await sleep(80);

    return { channelId: response.id, surface: 'dms' };
  }, [channelService, currentUserId, selectedTargets, visibleChannels]);

  const handleSend = useCallback(async () => {
    if (!payload || !canSend || !zero || isSendingRef.current || isDismissingRef.current) return;

    isSendingRef.current = true;
    setIsSending(true);
    try {
      const target = await resolveSendTarget();
      const attachments = buildAttachments(payload);
      const plainText = getSharePlainText(caption, payload);

      // iOS Files shares used to arrive as path-only text with files=[]. After
      // sanitizing that path away, refuse empty sends instead of posting "Message".
      if (attachments.length === 0 && !plainText) {
        throw new Error('No file was received. Open the share sheet again and choose Xyne Spaces.');
      }

      if (attachments.length > 0) {
        const results = await addAttachments(attachments, target.channelId, null);
        const failed = results.find(item => !item.success);
        if (failed) {
          throw new Error(failed.error || 'Attachment upload failed');
        }
      }

      const pendingAttachments = attachments.map(a => ({
        attachmentId: a.attachmentId,
        originalFilename: a.originalFilename,
        mimetype: a.mimetype,
        size: a.size,
        ...(a.width !== undefined && { width: a.width }),
        ...(a.height !== undefined && { height: a.height }),
      }));

      // Same path as ChatChannelScreen: pass attachmentIds so the mutator links
      // drafts → chat (do not rely on the legacy "scan channel draft" fallback).
      sendMessage(
        zero,
        { kind: 'channel', channelId: target.channelId },
        {
          content: buildMessageContent(caption, payload),
          text: plainText,
          conversationId: uuidv4(),
          messageId: uuidv4(),
          ...(pendingAttachments.length > 0 && { attachments: pendingAttachments }),
        },
      );

      await ShareTargetNative.clearShare(payload.id);

      // The operation has finished reading/deleting the source files. Allow
      // the successful route replacement through the removal guard on the
      // next render, after usePreventRemove has released this route.
      isSendingRef.current = false;
      setIsSending(false);
      setPendingSendNavigation(target);
    } catch (error) {
      Alert.alert('Could not share', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  }, [addAttachments, canSend, caption, payload, resolveSendTarget, zero]);

  const handleEndReached = useCallback(() => {
    if (selectionMode === 'channels') return;
    if (!hasMoreDms || isLoadingMoreDms) return;
    loadMoreDms();
  }, [hasMoreDms, isLoadingMoreDms, loadMoreDms, selectionMode]);

  const renderItem = useCallback(
    ({ item }: { item: ShareDestination }) => (
      <ShareDestinationRow
        brand={brand}
        foreground={foreground}
        item={item}
        selected={selectedKeys.has(item.key)}
        onPress={toggleTarget}
      />
    ),
    [brand, foreground, selectedKeys, toggleTarget],
  );

  const ListEmptyComponent = useMemo(() => {
    if (isLoadingDms && selectionMode !== 'channels') {
      return (
        <View className='items-center justify-center py-14'>
          <ActivityIndicator />
        </View>
      );
    }

    return (
      <View className='items-center justify-center px-8 py-14'>
        <Text className='text-base font-semibold text-primary-text'>No chats found</Text>
        <Text className='mt-1 text-center text-sm text-secondary-text'>
          Try a different search.
        </Text>
      </View>
    );
  }, [isLoadingDms, selectionMode]);

  if (isPayloadLoading) {
    return (
      <View className='flex-1 items-center justify-center bg-primary-bg'>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (!payload) {
    return (
      <View className='flex-1 bg-primary-bg' style={{ paddingTop: insets.top }}>
        <Stack.Screen options={{ headerShown: false }} />

        <View className='h-12 flex-row items-center gap-5 px-4'>
          <HeaderBackButton liquidGlass onPress={handleBack} iconColor={foreground} />
          <Text className='text-lg font-semibold text-primary-text'>Share</Text>
        </View>

        <View className='flex-1 items-center justify-center px-8 pb-16'>
          <Text className='text-base font-semibold text-primary-text'>Shared item unavailable</Text>
          <Text className='mt-2 text-center text-sm text-secondary-text'>
            {shareLoadError ?? 'Open the share sheet again and choose Xyne Spaces.'}
          </Text>
          <Pressable
            onPress={handleBack}
            accessibilityRole='button'
            className='mt-6 flex-row items-center gap-2 rounded-full px-5 py-3'
            style={{ backgroundColor: brand }}
          >
            <ArrowLeft size={18} color='white' />
            <Text className='text-sm font-semibold text-white'>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className='flex-1 bg-primary-bg' style={{ paddingTop: insets.top }}>
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: !isSending,
          headerBackButtonMenuEnabled: false,
        }}
      />

      <View className='h-12 flex-row items-center gap-5 px-4'>
        <HeaderBackButton liquidGlass onPress={handleBack} iconColor={foreground} />
        <Text className='text-lg font-semibold text-primary-text'>
          {getRecipientTitle(selectedTargets)}
        </Text>
      </View>

      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder='Search Chats'
        containerClassName='mx-4 mb-2'
      />

      <KeyboardGestureArea interpolator='ios' offset={60} style={{ flex: 1 }}>
        <KeyboardAwareLegendList
          ref={listRef}
          {...keyboardInsetProps}
          data={rows}
          drawDistance={700}
          estimatedItemSize={76}
          extraData={listExtraData}
          keyExtractor={item => item.key}
          keyboardDismissMode='interactive'
          keyboardLiftBehavior='whenAtEnd'
          keyboardOffset={insets.bottom}
          keyboardShouldPersistTaps='handled'
          ListEmptyComponent={ListEmptyComponent}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.7}
          recycleItems
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: 6,
            paddingBottom: selectedCount > 0 ? insets.bottom : insets.bottom + 24,
          }}
        />
      </KeyboardGestureArea>

      {selectedCount > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: insets.bottom,
            zIndex: 20,
          }}
        >
          <View ref={composerRef} onLayout={onComposerLayout}>
            <ShareComposer
              brand={brand}
              caption={caption}
              canSend={canSend}
              isSending={isSending}
              onCaptionChange={setCaption}
              onSend={handleSend}
              payload={payload}
              recipientLine={recipientLine}
              selectedCount={selectedCount}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

type ShareDestinationRowProps = {
  item: ShareDestination;
  selected: boolean;
  brand: string;
  foreground: string;
  onPress: (target: ShareDestination) => void;
};

const ShareDestinationRow = memo(
  ({ item, selected, brand, foreground, onPress }: ShareDestinationRowProps): ReactElement => {
    return (
      <Pressable
        onPress={() => onPress(item)}
        className='min-h-[56px] flex-row items-center px-4 active:bg-muted/50'
      >
        <View className='relative'>
          {item.kind === 'dm' ? (
            <Avatar userIds={item.participantUserIds} size={40} />
          ) : (
            <View className='h-10 w-10 items-center justify-center rounded-full bg-muted'>
              <Hash size={24} color={foreground} />
            </View>
          )}
        </View>

        <View className='mx-4 flex-1 flex-row justify-between'>
          <View className='flex-row items-center'>
            <Text className='flex-1 text-base font-semibold text-primary-text' numberOfLines={1}>
              {item.kind === 'channel' ? `# ${item.title}` : item.title}
            </Text>
          </View>

          {selected ? (
            <View
              className='h-5 w-5 items-center justify-center rounded-full mr-4'
              style={{ backgroundColor: brand }}
            >
              <Check size={13} color='white' strokeWidth={3} />
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  },
);
ShareDestinationRow.displayName = 'ShareDestinationRow';

type ShareComposerProps = {
  payload: IncomingSharePayload;
  caption: string;
  recipientLine: string;
  selectedCount: number;
  canSend: boolean;
  isSending: boolean;
  brand: string;
  onCaptionChange: (value: string) => void;
  onSend: () => void;
};

const shareComposerStyles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 18,
  },
  clip: {
    overflow: 'hidden',
  },
  tint: {
    ...StyleSheet.absoluteFill,
  },
});

const SHARE_COMPOSER_ENTERING: EntryExitAnimationFunction = () => {
  'worklet';

  const timing = {
    duration: 240,
    easing: Easing.out(Easing.cubic),
  };

  return {
    initialValues: {
      opacity: 0,
      transform: [{ scale: 1.05 }],
    },
    animations: {
      opacity: withTiming(1, timing),
      transform: [{ scale: withTiming(1, timing) }],
    },
  };
};

const SHARE_COMPOSER_EXITING: EntryExitAnimationFunction = () => {
  'worklet';

  const timing = {
    duration: 180,
    easing: Easing.in(Easing.cubic),
  };

  return {
    initialValues: {
      opacity: 1,
      transform: [{ scale: 1 }],
    },
    animations: {
      opacity: withTiming(0, timing),
      transform: [{ scale: withTiming(1.05, timing) }],
    },
  };
};

function ShareComposer({
  payload,
  caption,
  recipientLine,
  selectedCount,
  canSend,
  isSending,
  brand,
  onCaptionChange,
  onSend,
}: ShareComposerProps): ReactElement {
  const mutedText = useCSSVariable('--color-muted-foreground') as string;
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const composerTintColor = isDark ? 'rgba(22, 22, 24, 0.62)' : 'rgba(255, 255, 255, 0.78)';
  const disabledSendColor = isDark ? '#3A3A3C' : '#D1D5DB';
  const firstFile = payload.files[0];
  const isImage = Boolean(firstFile?.type?.startsWith('image/'));

  return (
    <Animated.View
      entering={SHARE_COMPOSER_ENTERING}
      exiting={SHARE_COMPOSER_EXITING}
      className='mx-3 rounded-[22px]'
      style={shareComposerStyles.shadow}
    >
      <View
        className='rounded-[22px] border-[0.5px] border-border'
        style={shareComposerStyles.clip}
      >
        <BlurView
          pointerEvents='none'
          intensity={52}
          tint={isDark ? 'dark' : 'light'}
          blurReductionFactor={2}
          blurMethod='dimezisBlurView'
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents='none'
          style={[shareComposerStyles.tint, { backgroundColor: composerTintColor }]}
        />

        <View className='flex-row items-center px-1.5 pt-2'>
          <View>
            <ArrowForwardIcon width={24} height={24} color={brand} />
          </View>

          <View className='ml-2 h-10 w-10 overflow-hidden rounded-lg bg-muted'>
            {firstFile ? (
              isImage ? (
                <Image
                  source={{ uri: firstFile.uri }}
                  className='h-full w-full'
                  resizeMode='cover'
                />
              ) : (
                <View className='h-full w-full items-center justify-center'>
                  <File size={20} color='white' />
                </View>
              )
            ) : (
              <View className='h-full w-full items-center justify-center'>
                <ImageIcon size={20} color='white' />
              </View>
            )}
          </View>

          <View className='ml-3 flex-1'>
            <Text className='text-sm font-semibold' style={{ color: brand }} numberOfLines={1}>
              {getPayloadTitle(payload)}
            </Text>
            <Text className='text-sm text-secondary-text' numberOfLines={1}>
              {recipientLine}
            </Text>
          </View>
        </View>

        <View className='mt-2 mb-0.5 flex-row items-end gap-3 pl-2.5 pr-1'>
          <TextInput
            value={caption}
            onChangeText={onCaptionChange}
            placeholder='Add a caption...'
            placeholderTextColor={mutedText || '#8E8E93'}
            multiline
            className='max-h-28 min-h-11 flex-1 py-2 pb-0.5 text-lg text-primary-text'
            textAlignVertical='center'
          />

          <Pressable
            onPress={onSend}
            disabled={!canSend}
            className='mb-1 h-10 w-12 items-center justify-center rounded-full'
            style={{
              backgroundColor: canSend ? brand : disabledSendColor,
              opacity: canSend ? 1 : 0.55,
            }}
            accessibilityRole='button'
          >
            {isSending ? (
              <ActivityIndicator color='white' />
            ) : (
              <SendHorizontal size={20} color='white' />
            )}

            <View
              className='absolute -left-1 -top-2.5 h-6 min-w-6 items-center justify-center rounded-full border border-card px-1'
              style={{ backgroundColor: brand }}
            >
              <Text className='text-xs font-bold text-white'>{selectedCount}</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

export default ShareTargetScreen;
