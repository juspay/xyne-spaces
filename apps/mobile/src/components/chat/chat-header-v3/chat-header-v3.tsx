import React, { useCallback } from 'react';
import { InteractionManager, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useUniwind } from 'uniwind';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { ConversationHeaderIcon } from '@/src/components/chat/conversation-header-icon';
import { ConversationHeaderTitleSkeleton } from '@/src/components/chat/conversation-header-title-skeleton';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import {
  HeaderBackButton,
  HeaderIconButton,
  HeaderPill,
  HEADER_ICON_BUTTON_SIZE,
} from '@/src/components/ui/header-icon-button';
import { useConversationHeaderData } from '@/src/hooks/useConversationHeaderData';
import { haptics } from '@/src/utils/haptics';
import { CallIcon } from '@/src/components/icons';
import { ChannelScopeType } from '@xyne/shared';

import { ChatHeaderV3Props } from './chat-header-v3.types';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';
import { openBaseConversationListRoute } from '@/src/utils/openChatRoute';
import {
  getBaseConversationSurfacePath,
  type BaseConversationSurface,
} from '@/src/features/chat/baseConversationSurface';
import { Event, logger } from '../../../utils/logger';
import { SUPPORTS_LIQUID_GLASS } from '@/src/utils/platform';
import { tabRoute } from '@/src/navigation/routes';

const ROOT_SIZE = HEADER_ICON_BUTTON_SIZE;
const GAP_SIZE = 8;
const HORIZONTAL_PADDING = 8;
const GLASS_INTENSITY = 60;

export const getChatHeaderCollapsedHeight = (safeAreaTop: number): number =>
  safeAreaTop + ROOT_SIZE + HORIZONTAL_PADDING;

const ChatHeaderV3: React.FC<ChatHeaderV3Props> = ({
  channelId,
  postPaintReady = true,
  onBack,
}) => {
  chatOpenProfiler.count('chat_header_v3_render');
  const router = useRouter();
  const { from, surface: surfaceParam } = useLocalSearchParams<{
    from?: string;
    surface?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { theme } = useUniwind();
  const foregroundColor = useCSSVariable('--color-foreground') as string;

  const isDark = theme === 'dark';
  const blurTint: 'light' | 'dark' = isDark ? 'dark' : 'light';
  const glassTintOverlay = isDark ? 'rgba(20,20,22,0.35)' : 'rgba(255,255,255,0.45)';

  const {
    channel,
    displayName,
    isTitlePending,
    isDM,
    isChannel,
    isPrivateChannel,
    dmProfileUserId,
    dmStatusEmoji,
    dmStatusContent,
    isOnline,
    memberCount,
    memberLabel,
    handleCallPress,
  } = useConversationHeaderData(channelId, { enabled: postPaintReady });

  if (postPaintReady) {
    chatOpenProfiler.count('chat_header_participants_query_render');
  }

  const baseConversationSurface: BaseConversationSurface =
    surfaceParam === 'dms' || isDM || channel?.scopeType === ChannelScopeType.GROUP_DM
      ? 'dms'
      : 'channels';

  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }

    const start = now();

    const logLatency = (): void => {
      logger.info(Event.LOTUS_TAB_SWITCH, {
        from_route: `conversation/${channelId}`,
        to_route:
          from === 'activity'
            ? 'activity'
            : getBaseConversationSurfacePath(baseConversationSurface),
        latency_ms: Math.round(now() - start),
        stage: 'back_navigation',
      });
    };

    const logAfterPaint = (): void => {
      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(logLatency);
        });
      });
    };

    if (from === 'activity') {
      router.dismiss();
      router.setParams({ from: undefined });
      router.navigate(tabRoute('activity'));
      logAfterPaint();
    } else {
      openBaseConversationListRoute(router, baseConversationSurface);
      logAfterPaint();
    }
  }, [baseConversationSurface, channelId, from, onBack, router]);

  /** Matches HeaderIconButton: haptic on press-in, native lensing does the rest. */
  const handlePillPressIn = useCallback(() => {
    void haptics.buttonTap();
  }, []);

  const handleOpenInfo = useCallback(() => {
    // Haptic fires on press-in (handlePillPressIn), matching HeaderIconButton.
    router.push({ pathname: '/(protected)/chat/[channelId]/info', params: { channelId } });
  }, [router, channelId]);

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
          On iOS 26 the controls are real UIGlassEffect surfaces, so the header
          chrome is left transparent and they float over the conversation —
          the Slack treatment. Stacking glass on a blurred backdrop reads as a
          muddy double-blur, and nothing scrolls under this header anyway (the
          list starts below the spacer in ChatChannelScreen), so the blur was
          only ever compositing a flat fill. Older iOS and Android keep it.
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
              lenses the pill itself, matching HeaderIconButton. With the glass
              as the parent, UIKit distorts its content instead. */}
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Conversation info'
            onPress={handleOpenInfo}
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
                  <ConversationHeaderTitleSkeleton />
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
                    <View className='min-w-0 flex-row items-center gap-3'>
                      <Text
                        className='min-w-0  text-sm font-medium leading-[18px] text-foreground'
                        numberOfLines={1}
                      >
                        {displayName}
                      </Text>
                    </View>
                    {isDM && dmStatusEmoji ? (
                      <View className='min-w-0 flex-row items-center gap-2'>
                        <ReactionEmojiDisplay emojiName={dmStatusEmoji} size={16} />
                        {dmStatusContent ? (
                          <Text
                            className='min-w-0 flex-1 shrink text-[11px] leading-[14px] text-secondary-foreground'
                            numberOfLines={1}
                          >
                            {dmStatusContent}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    {!isDM && memberCount > 0 ? (
                      <Text className='text-[11px] leading-[14px] text-secondary-foreground'>{`${memberCount} ${memberLabel}`}</Text>
                    ) : null}
                  </View>
                </View>
              )}
            </HeaderPill>
          </Pressable>

          <HeaderIconButton
            liquidGlass
            accessibilityLabel='Start call'
            onPress={() => void handleCallPress()}
          >
            <CallIcon stroke={foregroundColor} />
          </HeaderIconButton>
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

export default ChatHeaderV3;
