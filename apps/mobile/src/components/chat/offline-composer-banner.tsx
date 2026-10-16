import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Wifi, WifiOff } from 'lucide-react-native';
import { useUniwind } from 'uniwind';
import { useZeroOfflineState } from '@xyne/shared/hooks';

type OfflineComposerBannerProps = {
  /** When true, the banner shows edit-copy instead of draft-copy. */
  isEditing?: boolean;
};

// Tailwind amber/green palette — mirrors dashboard's ChatInput banner.
const OFFLINE_COLORS = {
  light: {
    background: '#FFFBEB', // amber-50
    border: '#FDE68A', // amber-200
    text: '#B45309', // amber-700
    button: '#FEF3C7', // amber-100
    buttonText: '#92400E', // amber-800
    buttonReconnecting: '#FFFBEB', // amber-50
    buttonReconnectingText: '#D97706', // amber-600
  },
  dark: {
    background: 'rgba(69, 26, 3, 0.5)', // amber-950/50
    border: '#92400E', // amber-800
    text: '#FCD34D', // amber-300
    button: '#78350F', // amber-900
    buttonText: '#FDE68A', // amber-200
    buttonReconnecting: '#451A03', // amber-950
    buttonReconnectingText: '#FBBF24', // amber-400
  },
} as const;

const RECONNECTED_COLORS = {
  light: {
    background: '#F0FDF4', // green-50
    border: '#BBF7D0', // green-200
    text: '#15803D', // green-700
  },
  dark: {
    background: 'rgba(5, 46, 22, 0.5)', // green-950/50
    border: '#166534', // green-800
    text: '#86EFAC', // green-300
  },
} as const;

/**
 * Offline / reconnected banner rendered directly above the composer input.
 * Mirrors the dashboard behaviour: an amber pill while offline (with a
 * Reconnect button), and a brief green confirmation once the socket recovers.
 * Uses the shared {@linkcode useZeroOfflineState} hook so grace-period and
 * reconnected windows behave the same across platforms.
 */
export const OfflineComposerBanner = ({
  isEditing = false,
}: OfflineComposerBannerProps): ReactElement | null => {
  const { showOfflineBanner, isReconnected, isReconnecting, refreshConnection } =
    useZeroOfflineState();
  const { theme } = useUniwind();
  const isDark = theme === 'dark';

  if (showOfflineBanner) {
    const c = isDark ? OFFLINE_COLORS.dark : OFFLINE_COLORS.light;
    return (
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)}>
        <View
          className='mx-3 mb-1 flex-row items-center gap-2 rounded border px-3 py-1.5'
          style={{ backgroundColor: c.background, borderColor: c.border }}
        >
          <WifiOff size={12} color={c.text} />
          <Text
            className='flex-1'
            numberOfLines={2}
            style={{ color: c.text, fontSize: 11, lineHeight: 14, flexShrink: 1 }}
          >
            {isEditing
              ? "You're offline. Edits can't be saved until you reconnect."
              : "You're offline. Messages will be saved as drafts until you reconnect."}
          </Text>
          <Pressable
            onPress={refreshConnection}
            disabled={isReconnecting}
            accessibilityRole='button'
            accessibilityLabel='Reconnect'
            hitSlop={8}
            className='shrink-0 rounded px-2 py-0.5'
            style={{
              backgroundColor: isReconnecting ? c.buttonReconnecting : c.button,
            }}
          >
            <Text
              style={{
                color: isReconnecting ? c.buttonReconnectingText : c.buttonText,
                fontSize: 11,
                fontWeight: '500',
                lineHeight: 14,
              }}
            >
              {isReconnecting ? 'Reconnecting…' : 'Reconnect'}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  if (isReconnected) {
    const c = isDark ? RECONNECTED_COLORS.dark : RECONNECTED_COLORS.light;
    return (
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)}>
        <View
          className='mx-3 mb-1 flex-row items-center gap-1.5 rounded border px-3 py-1.5'
          style={{ backgroundColor: c.background, borderColor: c.border }}
        >
          <Wifi size={12} color={c.text} />
          <Text style={{ color: c.text, fontSize: 11, lineHeight: 14 }}>Connected</Text>
        </View>
      </Animated.View>
    );
  }

  return null;
};
