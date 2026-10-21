import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useCSSVariable, useUniwind } from 'uniwind';

import { Bell, CallIcon, MoreHorizontal } from '@/src/components/icons';
import { Dropdown } from '@/src/components/ui/dropdown';
import { HEADER_ICON_BUTTON_SIZE } from '@/src/components/ui/header-icon-button';

import type { ThreadHeaderOverflowMenuProps } from './thread-header-overflow-menu.types';
import { useThreadHeaderOverflow } from '@/src/hooks/useThreadHeaderOverflow';

const GLASS_INTENSITY = 60;

export function ThreadHeaderOverflowMenu({
  channelId,
  threadId,
  canUseMemberActions,
}: ThreadHeaderOverflowMenuProps) {
  const { theme } = useUniwind();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const { actions, isSubscriptionResolving, isSubscribed, handleAction } = useThreadHeaderOverflow(
    channelId,
    threadId,
    canUseMemberActions,
  );

  const isDark = theme === 'dark';
  const blurTint: 'light' | 'dark' = isDark ? 'dark' : 'light';
  const tintOverlay = isDark ? 'rgba(20,20,22,0.35)' : 'rgba(255,255,255,0.45)';

  return (
    <Dropdown>
      <Dropdown.Trigger accessibilityLabel='More options' style={styles.trigger}>
        <View
          pointerEvents='none'
          className='items-center justify-center overflow-hidden rounded-full border border-foreground/15'
          style={styles.surface}
        >
          <BlurView
            intensity={GLASS_INTENSITY}
            tint={blurTint}
            blurMethod='dimezisBlurView'
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: tintOverlay }]} />
          <MoreHorizontal size={20} color={foregroundColor} />
        </View>
      </Dropdown.Trigger>
      <Dropdown.Content
        side='bottom'
        align='end'
        sideOffset={8}
        minWidth={260}
        maxWidth={320}
        scrollable={false}
        overlayColor='rgba(0,0,0,0.02)'
        contentStyle={{ paddingVertical: 6 }}
      >
        {actions.map(action => (
          <Dropdown.Item
            key={action.id}
            label={action.label}
            disabled={action.id === 'toggle-subscription' && isSubscriptionResolving}
            left={
              action.id === 'start-call' ? (
                <CallIcon stroke={foregroundColor} />
              ) : (
                <Bell size={20} color={foregroundColor} fill={!isSubscribed} />
              )
            }
            onSelect={() => handleAction(action.id)}
          />
        ))}
      </Dropdown.Content>
    </Dropdown>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: HEADER_ICON_BUTTON_SIZE,
    height: HEADER_ICON_BUTTON_SIZE,
  },
  surface: {
    width: HEADER_ICON_BUTTON_SIZE,
    height: HEADER_ICON_BUTTON_SIZE,
  },
});
