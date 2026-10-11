import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInLeft, SlideInRight } from 'react-native-reanimated';

import type { DeckDirection } from '../hooks/use-onboarding-deck';
import { DECK_GHOSTS, deckMetrics, deckPalette } from '../theme';

const SLIDE_MS = 260;
const FADE_MS = 160;

export interface CardDeckProps {
  /** Changes with the card, which is what restarts the enter animation. */
  cardKey: string;
  direction: DeckDirection;
  /** Fixed by the screen from the viewport, since every card in the stack is absolutely placed. */
  height: number;
  children: ReactNode;
}

/**
 * The stack: three turned cards peeking out behind the live one.
 *
 * The front card is keyed by card id so React swaps the element on every move, which is what lets
 * reanimated run the exit and the entrance together — it slides in from whichever side the deck
 * is travelling, and the outgoing one fades as it leaves.
 */
export function CardDeck({ cardKey, direction, height, children }: CardDeckProps): ReactElement {
  return (
    <View style={[styles.area, { height }]}>
      {/* Drawn back-to-front so the nearest ghost sits closest to the live card. */}
      {[...DECK_GHOSTS].reverse().map(ghost => (
        <View
          key={ghost.rotate}
          pointerEvents='none'
          style={[
            styles.card,
            styles.ghost,
            {
              opacity: ghost.opacity,
              transform: [
                { translateX: ghost.translateX },
                { translateY: ghost.translateY },
                { rotate: ghost.rotate },
              ],
            },
          ]}
        />
      ))}

      <Animated.View
        key={cardKey}
        entering={(direction === 1 ? SlideInRight : SlideInLeft).duration(SLIDE_MS)}
        exiting={FadeOut.duration(FADE_MS)}
        style={[styles.card, styles.front]}
      >
        <Animated.View style={styles.fill} entering={FadeIn.delay(60).duration(FADE_MS)}>
          {children}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    marginHorizontal: deckMetrics.gutter,
    // Yields to the keyboard rather than pushing the footer off the screen.
    flexShrink: 1,
    minHeight: 260,
  },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: deckMetrics.cardRadius,
  },
  ghost: {
    backgroundColor: deckPalette.cardGhost,
  },
  front: {
    backgroundColor: deckPalette.card,
    padding: deckMetrics.cardPadding,
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
  },
});
