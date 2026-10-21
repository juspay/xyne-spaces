import { Platform } from 'react-native';
import { isGlassEffectAPIAvailable } from 'expo-glass-effect';

const getIosMajorVersion = (): number => {
  if (Platform.OS !== 'ios') return 0;
  const version = Platform.Version;
  if (typeof version === 'string') return parseInt(version.split('.')[0] ?? '0', 10);
  return typeof version === 'number' ? version : 0;
};

/** iOS major version, 0 on every other platform. */
export const IOS_MAJOR_VERSION = getIosMajorVersion();

/**
 * True when the OS ships the iOS 26 design system. This is a version check
 * only — it does NOT imply expo-glass-effect's UIGlassEffect API is usable.
 * Use it for design decisions such as the native tab bar shape, and use
 * SUPPORTS_LIQUID_GLASS before rendering a GlassView.
 */
export const IOS_USES_LIQUID_GLASS_DESIGN = Platform.OS === 'ios' && IOS_MAJOR_VERSION >= 26;

/**
 * True when a GlassView can be rendered safely. isGlassEffectAPIAvailable()
 * validates iOS 26+, that UIGlassEffect exists, and that it responds to
 * effectWithStyle: — some iOS 26 betas ship without it and crash. The
 * try/catch keeps it degrading silently if the native module isn't linked.
 *
 * Constant for the lifetime of the process, so it is safe to branch component
 * identity on it without risking a hook-order change.
 *
 * To exercise the pre-iOS-26 fallback while running on an iOS 26 simulator,
 * temporarily `return false` here. This is deliberately not driven by an
 * EXPO_PUBLIC_* env var — see the note at the top of src/config.ts about
 * Metro/Babel workers inlining the wrong env during export:embed.
 */
export const SUPPORTS_LIQUID_GLASS = ((): boolean => {
  try {
    return Platform.OS === 'ios' && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
})();
