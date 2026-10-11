import { useEffect, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { deckPalette } from '../theme';

/** How long the greeting holds before the deck takes over. */
const DWELL_MS = 2000;

/**
 * "Welcome to Xyne Spaces, {name}" — a beat before the first card, which moves on by itself.
 *
 * The name is dropped on the email sign-up path, where we have not asked for it yet; the greeting
 * then reads as a plain welcome rather than addressing a blank.
 */
export function WelcomeScreen({
  name,
  onDone,
}: {
  name: string | null;
  onDone: () => void;
}): ReactElement {
  useEffect(() => {
    const timer = setTimeout(onDone, DWELL_MS);
    return (): void => clearTimeout(timer);
  }, [onDone]);

  return (
    <View style={styles.screen}>
      <Animated.Text
        entering={FadeIn.duration(500)}
        exiting={FadeOut.duration(220)}
        style={styles.greeting}
        accessibilityRole='header'
      >
        {name === null ? 'Welcome to Xyne Spaces' : `Welcome to Xyne Spaces, ${name}`}
      </Animated.Text>
      {/* Keeps the greeting optically centred rather than sitting on the exact middle. */}
      <Text style={styles.ballast} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: deckPalette.background,
  },
  greeting: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '500',
    letterSpacing: -0.4,
    textAlign: 'center',
    color: deckPalette.textPrimary,
  },
  ballast: {
    height: 48,
  },
});
