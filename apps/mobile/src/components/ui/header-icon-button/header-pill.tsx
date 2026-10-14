import { type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import { useUniwind } from 'uniwind';

import { SUPPORTS_LIQUID_GLASS } from '@/src/utils/platform';

import { HEADER_ICON_BUTTON_SIZE } from './header-icon-button';

/**
 * The flexible title capsule that sits between the header's circular buttons.
 * Shares HeaderIconButton's structure: a native UIGlassEffect surface on
 * iOS 26, the original BlurView + tint overlay everywhere else.
 */
const GLASS_INTENSITY = 60;

type HeaderPillProps = {
  children: ReactNode;
  /**
   * Opt in to the iOS 26 Liquid Glass treatment. No-ops on Android and on
   * pre-iOS-26, which always get the BlurView path.
   */
  liquidGlass?: boolean;
  /**
   * Enables the native press lensing, matching HeaderIconButton. Set this only
   * when the pill actually responds to a tap — the canvas/links/pinned pills
   * are static labels, and press feedback on them would be misleading.
   */
  interactive?: boolean;
};

type PillVariantProps = Omit<HeaderPillProps, 'liquidGlass'>;

const LiquidGlassHeaderPill = ({
  children,
  interactive = false,
}: PillVariantProps): ReactElement => {
  const { theme } = useUniwind();

  return (
    <GlassView
      isInteractive={interactive}
      glassEffectStyle='regular'
      colorScheme={theme === 'dark' ? 'dark' : 'light'}
      style={styles.glassPill}
    >
      {children}
    </GlassView>
  );
};

const BlurHeaderPill = ({ children }: PillVariantProps): ReactElement => {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const blurTint: 'light' | 'dark' = isDark ? 'dark' : 'light';
  const tintOverlay = isDark ? 'rgba(20,20,22,0.35)' : 'rgba(255,255,255,0.45)';

  return (
    <View
      className='flex-1 overflow-hidden rounded-full border border-foreground/15'
      style={{ height: HEADER_ICON_BUTTON_SIZE, borderCurve: 'continuous' }}
    >
      <BlurView
        intensity={GLASS_INTENSITY}
        tint={blurTint}
        blurMethod='dimezisBlurView'
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: tintOverlay }]}
        pointerEvents='none'
      />
      {children}
    </View>
  );
};

/** Hook-free selector — see the note on HeaderIconButton. */
export const HeaderPill = ({ liquidGlass = false, ...props }: HeaderPillProps): ReactElement =>
  liquidGlass && SUPPORTS_LIQUID_GLASS ? (
    <LiquidGlassHeaderPill {...props} />
  ) : (
    <BlurHeaderPill {...props} />
  );

const styles = StyleSheet.create({
  glassPill: {
    flex: 1,
    height: HEADER_ICON_BUTTON_SIZE,
    borderRadius: HEADER_ICON_BUTTON_SIZE / 2,
    overflow: 'hidden',
  },
});
