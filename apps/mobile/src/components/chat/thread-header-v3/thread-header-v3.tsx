import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useUniwind } from 'uniwind';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChannelScopeType } from '@xyne/shared';

import { ConversationHeaderIcon } from '@/src/components/chat/conversation-header-icon';
import { ConversationHeaderTitleSkeleton } from '@/src/components/chat/conversation-header-title-skeleton';
import {
  HeaderBackButton,
  HeaderPill,
  HEADER_ICON_BUTTON_SIZE,
} from '@/src/components/ui/header-icon-button';
import { useConversationHeaderData } from '@/src/hooks/useConversationHeaderData';
import { haptics } from '@/src/utils/haptics';
import { SUPPORTS_LIQUID_GLASS } from '@/src/utils/platform';
import type { BaseConversationSurface } from '@/src/features/chat/baseConversationSurface';

import { ThreadHeaderV3Props } from './thread-header-v3.types';
import { ThreadHeaderOverflowMenu } from './thread-header-overflow-menu';

const ROOT_SIZE = HEADER_ICON_BUTTON_SIZE;
const GAP_SIZE = 8;
const HORIZONTAL_PADDING = 8;
const GLASS_INTENSITY = 60;

export const getThreadHeaderCollapsedHeight = (safeAreaTop: number): number =>
  safeAreaTop + ROOT_SIZE + HORIZONTAL_PADDING;

const ThreadHeaderV3: React.FC<ThreadHeaderV3Props> = ({ channelId, threadId, onBack }) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useUniwind();
  const { surface: surfaceParam } = useLocalSearchParams<{ surface?: string }>();

  const isDark = theme === 'dark';
  const blurTint: 'light' | 'dark' = isDark ? 'dark' : 'light';
  const glassTintOverlay = isDark ? 'rgba(20,20,22,0.35)' : 'rgba(255,255,255,0.45)';

  // The pill shows only "Thread" over the conversation name, so nothing here
  // needs the participant list — leave that query off the thread-open path.
  const {
    channel,
    displayName,
    isTitlePending,
    isDM,
    isChannel,
    isPrivateChannel,
    dmProfileUserId,
    isOnline,
    canUseMemberActions,
  } = useConversationHeaderData(channelId, { enabled: false });

  const baseConversationSurface: BaseConversationSurface =
    surfaceParam === 'dms' || isDM || channel?.scopeType === ChannelScopeType.GROUP_DM
      ? 'dms'
      : 'channels';

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }

    router.back();
  }, [onBack, router]);

  /** Matches HeaderIconButton: haptic on press-in, native lensing does the rest. */
  const handlePillPressIn = useCallback(() => {
    void haptics.buttonTap();
  }, []);

  /**
   * Slack's treatment: the pill names the parent conversation, so tapping it
   * goes there. dismissTo pops to the chat screen when it already sits below
   * this thread and replaces the thread with it when it does not (deeplink,
   * notification), so no entry point can strand a thread underneath.
   *
   * Deliberately not `onBack` — that is canGoBack() ? back() : replace(), which
   * from an Activity entry lands on Activity while the pill names the channel.
   */
  const handleOpenParentConversation = useCallback(() => {
    router.dismissTo({
      pathname: '/chat/[channelId]',
      params: { channelId, surface: baseConversationSurface },
    });
  }, [baseConversationSurface, channelId, router]);

  return (
    <View
      className='absolute left-0 right-0'
      style={{ zIndex: 40, top: 0 }}
      pointerEvents='box-none'
    >
      <View
        className='relative w-full'
        style={{
          paddingHorizontal: HORIZONTAL_PADDING,
          paddingTop: insets.top,
          paddingBottom: HORIZONTAL_PADDING,
        }}
        pointerEvents='box-none'
      >
        {/*
          Same reasoning as ChatHeaderV3: on iOS 26 the controls are real
          UIGlassEffect surfaces, and ChatThread renders a spacer of
          getThreadHeaderCollapsedHeight below this header so nothing scrolls
          under it — a backdrop blur would only double-blur the pill.
        */}
        {SUPPORTS_LIQUID_GLASS ? null : (
          <BlurView
            intensity={GLASS_INTENSITY}
            tint={blurTint}
            blurMethod='dimezisBlurView'
            style={[StyleSheet.absoluteFill, { backgroundColor: glassTintOverlay }]}
          />
        )}
        <View
          className='relative flex-row items-center'
          style={{ height: ROOT_SIZE, gap: GAP_SIZE }}
          pointerEvents='box-none'
        >
          <HeaderBackButton liquidGlass onPress={handleBack} />

          {/* Pressable wraps the glass (not the other way round) so the press
              lenses the pill itself, matching HeaderIconButton. */}
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={
              isTitlePending ? 'Open conversation' : `Open conversation ${displayName}`
            }
            onPress={handleOpenParentConversation}
            onPressIn={handlePillPressIn}
            style={styles.pillPressable}
          >
            <HeaderPill liquidGlass interactive>
              {isTitlePending ? (
                <View
                  className='flex-row items-center gap-2 px-2'
                  style={{ height: ROOT_SIZE }}
                  pointerEvents='none'
                >
                  <ConversationHeaderTitleSkeleton showSubtitle />
                </View>
              ) : (
                <View
                  className='flex-row items-center gap-2 px-2'
                  style={{ height: ROOT_SIZE }}
                  pointerEvents='none'
                >
                  <ConversationHeaderIcon
                    isDM={isDM}
                    isChannel={isChannel}
                    isPrivateChannel={isPrivateChannel}
                    dmProfileUserId={dmProfileUserId}
                    isOnline={isOnline}
                  />

                  <View className='min-w-0 flex-1 justify-center'>
                    <Text
                      className='text-sm font-medium leading-[18px] text-foreground'
                      numberOfLines={1}
                    >
                      Thread
                    </Text>
                    <Text
                      className='text-[11px] leading-[14px] text-secondary-foreground'
                      numberOfLines={1}
                    >
                      {displayName}
                    </Text>
                  </View>
                </View>
              )}
            </HeaderPill>
          </Pressable>

          <ThreadHeaderOverflowMenu
            channelId={channelId}
            threadId={threadId}
            canUseMemberActions={canUseMemberActions}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  /** The pill is the flexible middle of the header row. */
  pillPressable: {
    flex: 1,
  },
});

export default ThreadHeaderV3;
