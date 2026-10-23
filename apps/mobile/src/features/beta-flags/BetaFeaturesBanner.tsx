import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Sparkles, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useAuth } from '@/src/contexts/AuthContext';
import { useGuideReturnTarget } from '@/src/features/user-guide/guide-return-store';
import { isFlagTouched } from '@/src/flags';
import { useTabBarHeight } from '@/src/hooks/useTabBarHeight';
import { isOnTabShell } from '@/src/navigation/routes';
import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import { haptics } from '@/src/utils/haptics';

import { untouchedBetaFlags } from './resolve';
import { useBetaFlags } from './use-beta-flags';

const EDGE_MARGIN = 16;
const BOTTOM_GAP = 12;
const ANIMATION_MS = 220;

/**
 * Module scope, not state: applying a flag change or switching workspace
 * remounts the protected shell, and a dismissed banner must stay dismissed for
 * the rest of the session.
 */
let dismissedThisSession = false;

/**
 * Tells the user there are beta features they have not tried.
 *
 * Shows while at least one flag CAC allows them has never been set, on or off.
 * A floating bar above the tab bar, like the guide's return bar: it overlays
 * rather than pushing the screen down, appears only on the tab shell so it
 * never covers a chat composer, and its enter and exit animations run on the
 * UI thread. Tapping opens the Beta screen; either way it stays gone until the
 * next launch.
 *
 * Mounted once in the protected layout, next to the revocation gate.
 */
export function BetaFeaturesBanner(): ReactElement | null {
  const { isSignedIn } = useAuth();
  const { hasFirstFramePainted, isProtectedStartupReady } = useStartupPhase();
  const router = useRouter();
  const segments = useSegments() as string[];
  const { tabBarHeight } = useTabBarHeight();
  const guideReturnTarget = useGuideReturnTarget();
  const [isDismissed, setDismissed] = useState(dismissedThisSession);

  const barBg = useCSSVariable('--color-foreground') as string;
  const barFg = useCSSVariable('--color-background') as string;

  // Same gate as the update prompt and the revocation gate: nothing fetches
  // until the app is up, so this never competes with first paint.
  const enabled = isSignedIn && hasFirstFramePainted && isProtectedStartupReady && !isDismissed;
  const { flags, revoked } = useBetaFlags(enabled);

  const isOnTabs = isOnTabShell(segments);

  // A handful of synchronous MMKV lookups, redone on navigation so choices made
  // on the Beta screen count as soon as the user is back.
  const untouchedCount = useMemo(
    () => (isOnTabs ? untouchedBetaFlags(flags, isFlagTouched).length : 0),
    // `segments` changes identity on every navigation; that is the re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flags, isOnTabs, segments],
  );

  const dismiss = useCallback((): void => {
    dismissedThisSession = true;
    setDismissed(true);
  }, []);

  const openBeta = useCallback((): void => {
    void haptics.buttonTap();
    dismiss();
    router.push('/settings/beta');
  }, [dismiss, router]);

  const close = useCallback((): void => {
    void haptics.selection();
    dismiss();
  }, [dismiss]);

  // The revocation sheet and the guide's return bar both take precedence.
  if (isDismissed || !isOnTabs || untouchedCount === 0 || revoked.length > 0 || guideReturnTarget) {
    return null;
  }

  const title =
    untouchedCount === 1 ? 'A beta feature to try' : `${untouchedCount} beta features to try`;

  return (
    <View pointerEvents='box-none' style={[styles.host, { bottom: tabBarHeight + BOTTOM_GAP }]}>
      <Animated.View
        entering={FadeInDown.duration(ANIMATION_MS)}
        exiting={FadeOutDown.duration(ANIMATION_MS)}
        style={[styles.bar, { backgroundColor: barBg }]}
      >
        <Pressable
          onPress={openBeta}
          accessibilityRole='button'
          accessibilityLabel={`${title}. Open Beta settings`}
          style={({ pressed }) => [styles.main, { opacity: pressed ? 0.75 : 1 }]}
        >
          <Sparkles size={18} color={barFg} strokeWidth={2.2} />
          <View style={styles.textColumn}>
            <Text style={[styles.title, { color: barFg }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.subtitle, { color: barFg }]} numberOfLines={1}>
              Tap to try them in Beta settings
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={close}
          accessibilityRole='button'
          accessibilityLabel='Dismiss'
          hitSlop={10}
          style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.6 : 1 }]}
        >
          <X size={16} color={barFg} strokeWidth={2.4} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: EDGE_MARGIN,
    zIndex: 900,
    elevation: 12,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: 14,
    paddingLeft: 14,
    paddingRight: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  textColumn: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  subtitle: { fontSize: 12, lineHeight: 16, opacity: 0.72 },
  dismiss: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
});
