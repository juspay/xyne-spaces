import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { AlertOctagon, FileText, Inbox, Mails, Send, Star } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useCSSVariable } from 'uniwind';

import { cn } from '@/src/utils/cn';

import {
  TICKET_MAILBOX_FOLDERS,
  TICKETS_DRAWER_CLOSE_PROGRESS,
  TICKETS_DRAWER_CLOSE_VELOCITY,
  TICKETS_DRAWER_MAX_WIDTH,
  TICKETS_DRAWER_SPRING,
  TICKETS_DRAWER_WIDTH_RATIO,
} from '../constants';
import type { TicketMailboxFolder } from '../types';

const ICONS = {
  inbox: Inbox,
  all: Mails,
  starred: Star,
  spam: AlertOctagon,
  drafts: FileText,
  sent: Send,
} as const;

type TicketsMailboxDrawerProps = {
  channelName: string;
  progress: SharedValue<number>;
  isOpen: boolean;
  activeFolder: TicketMailboxFolder;
  onClose: () => void;
  onSelectFolder: (folder: TicketMailboxFolder) => void;
};

export const TicketsMailboxDrawer = memo(function TicketsMailboxDrawer({
  channelName,
  progress,
  isOpen,
  activeFolder,
  onClose,
  onSelectFolder,
}: TicketsMailboxDrawerProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const foreground = useCSSVariable('--color-foreground') as string;
  const drawerWidth = Math.min(windowWidth * TICKETS_DRAWER_WIDTH_RATIO, TICKETS_DRAWER_MAX_WIDTH);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Prefer horizontal dismiss; ignore mostly-vertical touches.
        .activeOffsetX(-10)
        .failOffsetY([-18, 18])
        .onBegin(() => {
          'worklet';
          cancelAnimation(progress);
        })
        .onUpdate(e => {
          'worklet';
          // Open = 1, fully off-screen left = 0. Only allow dragging left (or slight right clamp).
          progress.value = Math.max(0, Math.min(1, 1 + e.translationX / drawerWidth));
        })
        .onEnd(e => {
          'worklet';
          // Project a bit ahead of the finger so flick dismisses naturally.
          const projected = progress.value + (e.velocityX / drawerWidth) * 0.12;
          const shouldClose =
            projected < TICKETS_DRAWER_CLOSE_PROGRESS ||
            e.velocityX < TICKETS_DRAWER_CLOSE_VELOCITY;

          if (shouldClose) {
            // Hook animates progress → 0 and unmounts when finished.
            scheduleOnRN(onClose);
            return;
          }

          // Not far enough — spring back to fully open.
          progress.value = withSpring(1, TICKETS_DRAWER_SPRING);
        }),
    [drawerWidth, onClose, progress],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 0.45], Extrapolation.CLAMP),
  }));

  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(progress.value, [0, 1], [-drawerWidth, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  return (
    <View
      pointerEvents={isOpen ? 'box-none' : 'none'}
      style={[StyleSheet.absoluteFill, { zIndex: 80 }]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} className='bg-black'>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            {
              width: drawerWidth,
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 12,
            },
            panelStyle,
          ]}
          className='absolute bottom-0 left-0 top-0 bg-neutral-100 dark:bg-background px-3'
        >
          <Text
            className='mb-4 px-3 text-[22px] font-semibold text-foreground'
            numberOfLines={1}
            ellipsizeMode='tail'
          >
            {channelName}
          </Text>

          <Text className='mb-2 px-3 text-[12px] font-medium uppercase text-foreground/80'>
            All labels
          </Text>

          {TICKET_MAILBOX_FOLDERS.map(folder => {
            const Icon = ICONS[folder.id];
            const active = folder.id === activeFolder;
            return (
              <Pressable
                key={folder.id}
                accessibilityRole='button'
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onSelectFolder(folder.id);
                  onClose();
                }}
                className={cn(
                  'mb-1 flex-row items-center gap-3 rounded-full px-3 py-3 border-[0.2px] border-transparent',
                  active && 'bg-card shadow-2xs dark:bg-accent/60 border-border',
                )}
              >
                <Icon size={20} color={foreground} />
                <Text
                  className={cn(
                    'flex-1 text-[15px] text-foreground',
                    active ? 'font-semibold' : 'font-normal',
                  )}
                >
                  {folder.label}
                </Text>
                {folder.count != null ? (
                  <Text className='text-[13px] text-muted-foreground'>{folder.count}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </Animated.View>
      </GestureDetector>
    </View>
  );
});
