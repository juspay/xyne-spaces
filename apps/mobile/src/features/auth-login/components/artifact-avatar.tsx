import { Image } from 'expo-image';
import { memo, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { loginPalette } from '../theme';
import type { ArtifactAuthor } from '../model/artifacts';

const AVATAR_SIZE = 30;

const AGENT_TONES = {
  coral: ['#FF4B4B', '#FF8585', '#D93A3A'],
  amber: ['#D9D06C', '#E6DE8A', '#C4BA52'],
} as const satisfies Record<'coral' | 'amber', readonly [string, string, string]>;

/**
 * An agent's identity mark: a loose cluster of discs rather than a photo, so agents stay visually
 * distinct from people at this size without needing a bundled asset.
 */
function AgentBlob({ tone }: { tone: keyof typeof AGENT_TONES }): ReactElement {
  const [base, light, dark] = AGENT_TONES[tone];
  return (
    <View style={styles.avatar}>
      <View
        style={[styles.blob, { width: 17, height: 17, left: 0, top: 4, backgroundColor: base }]}
      />
      <View
        style={[styles.blob, { width: 15, height: 15, right: 0, top: 0, backgroundColor: light }]}
      />
      <View
        style={[styles.blob, { width: 13, height: 13, left: 6, bottom: 0, backgroundColor: dark }]}
      />
    </View>
  );
}

/** Avatar for one feed row, with the `@` mention glyph clipped to its lower-left corner. */
export const ArtifactAvatar = memo(function ArtifactAvatar({
  author,
  badge = false,
}: {
  author: ArtifactAuthor;
  badge?: boolean;
}): ReactElement {
  return (
    <View style={styles.wrapper}>
      {author.kind === 'person' ? (
        <Image
          source={{ uri: author.avatarUrl }}
          style={styles.avatar}
          contentFit='cover'
          transition={200}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <AgentBlob tone={author.tone} />
      )}

      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeGlyph}>@</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: loginPalette.surfaceRaised,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    borderRadius: 999,
  },
  badge: {
    position: 'absolute',
    left: -4,
    bottom: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: loginPalette.surfaceRaised,
    borderWidth: 2,
    borderColor: loginPalette.background,
  },
  badgeGlyph: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
    color: loginPalette.textSecondary,
  },
});
