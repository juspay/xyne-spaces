import { LinearGradient } from 'expo-linear-gradient';
import { memo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { ArtifactCard } from './artifact-card';
import { FloatingPresenceCard } from './floating-presence-card';
import { LOGIN_ARTIFACTS } from '../model/artifacts';

/**
 * A smoothstep ramp to the page colour. The last card has to read as *dissolving* rather than as
 * being covered by a band, so the fade is long and starts well above the headline.
 */
const FADE_STOPS = [0, 0.26, 0.48, 0.68, 0.85, 1] as const;
const FADE_ALPHAS = [0, 0.1, 0.34, 0.66, 0.9, 1] as const;

const FADE_COLORS = FADE_ALPHAS.map(alpha => `rgba(6, 6, 6, ${alpha})`) as unknown as readonly [
  string,
  string,
  ...string[],
];

/** Share of the feed's height, measured from its bottom, that the fade covers. */
const FADE_HEIGHT_RATIO = 0.46;

/**
 * The artwork above the headline: a frozen channel scrolled just past its last message, fading
 * out into the page. Inert and hidden from screen readers — it carries no information a signed-out
 * user needs.
 */
export const ArtifactFeed = memo(function ArtifactFeed(): ReactElement {
  return (
    <View
      style={styles.container}
      pointerEvents='none'
      accessibilityElementsHidden
      importantForAccessibility='no-hide-descendants'
    >
      <View style={styles.stack}>
        {LOGIN_ARTIFACTS.map(card => (
          <ArtifactCard key={card.id} card={card} />
        ))}
      </View>

      <FloatingPresenceCard />

      <LinearGradient
        colors={FADE_COLORS}
        locations={FADE_STOPS}
        style={[styles.fade, { height: `${FADE_HEIGHT_RATIO * 100}%` }]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  stack: {
    gap: 10,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
});
