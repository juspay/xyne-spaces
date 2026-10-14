import { Button, Host, Menu, RNHostView } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import { StyleSheet, View } from 'react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { MoreHorizontal } from '@/src/components/icons';
import { HEADER_ICON_BUTTON_SIZE } from '@/src/components/ui/header-icon-button';
import { haptics } from '@/src/utils/haptics';
import { SUPPORTS_LIQUID_GLASS } from '@/src/utils/platform';

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
  const { actions, isSubscriptionResolving, handleAction } = useThreadHeaderOverflow(
    channelId,
    threadId,
    canUseMemberActions,
  );

  const isDark = theme === 'dark';
  const blurTint: 'light' | 'dark' = isDark ? 'dark' : 'light';
  const tintOverlay = isDark ? 'rgba(20,20,22,0.35)' : 'rgba(255,255,255,0.45)';

  return (
    <Host matchContents ignoreSafeArea='all' style={styles.host}>
      {/*
        Menu's built-in glass trigger is a rounded rectangle. Match the back
        button by supplying a circular RN label via RNHostView instead of
        buttonStyle('glass') — Expo docs warn that glass on the label fights
        the menu dismiss animation.
      */}
      <Menu
        label={
          <RNHostView matchContents>
            <View
              accessibilityLabel='More options'
              pointerEvents='none'
              style={styles.triggerVisual}
            >
              {SUPPORTS_LIQUID_GLASS ? (
                <GlassView
                  glassEffectStyle='regular'
                  colorScheme={isDark ? 'dark' : 'light'}
                  style={styles.glassSurface}
                >
                  <MoreHorizontal size={20} color={foregroundColor} />
                </GlassView>
              ) : (
                <View
                  className='items-center justify-center overflow-hidden rounded-full border border-foreground/15'
                  style={styles.glassSurface}
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
              )}
            </View>
          </RNHostView>
        }
      >
        {actions.map(action => {
          const isDisabled = action.id === 'toggle-subscription' && isSubscriptionResolving;

          return (
            <Button
              key={action.id}
              label={action.label}
              systemImage={action.systemImage}
              modifiers={isDisabled ? [disabled(true)] : []}
              onPress={() => {
                void haptics.selection();
                handleAction(action.id);
              }}
            />
          );
        })}
      </Menu>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    width: HEADER_ICON_BUTTON_SIZE,
    height: HEADER_ICON_BUTTON_SIZE,
  },
  triggerVisual: {
    width: HEADER_ICON_BUTTON_SIZE,
    height: HEADER_ICON_BUTTON_SIZE,
  },
  glassSurface: {
    width: HEADER_ICON_BUTTON_SIZE,
    height: HEADER_ICON_BUTTON_SIZE,
    borderRadius: HEADER_ICON_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
