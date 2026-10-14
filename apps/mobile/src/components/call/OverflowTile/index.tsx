import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { callColors } from '../callTheme';
import { ParticipantAvatar } from '../ParticipantAvatar';
import { useParticipantPicture } from '../hooks/useParticipantPicture';

export interface OverflowPerson {
  identity: string;
  name: string;
}

interface OverflowTileProps {
  people: readonly OverflowPerson[];
  compact?: boolean;
  onPress?: (() => void) | undefined;
}

function OverflowAvatar({
  person,
  size,
  overlap,
}: {
  person: OverflowPerson;
  size: number;
  overlap: boolean;
}): React.ReactElement {
  const pictureUri = useParticipantPicture(person.identity);
  return (
    <View style={[styles.avatarSlot, overlap && { marginLeft: -Math.round(size * 0.3) }]}>
      <ParticipantAvatar
        identity={person.identity}
        name={person.name}
        pictureUri={pictureUri}
        size={size}
      />
    </View>
  );
}

/** "+N" tile that stands in for everyone who doesn't fit on the stage; opens the people list. */
export function OverflowTile({
  people,
  compact = false,
  onPress,
}: OverflowTileProps): React.ReactElement {
  const shown = people.slice(0, 3);
  const avatarSize = compact ? 22 : 36;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`${people.length} more participants`}
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      {!compact ? (
        <View style={styles.avatars}>
          {shown.map((person, index) => (
            <OverflowAvatar
              key={person.identity}
              person={person}
              size={avatarSize}
              overlap={index > 0}
            />
          ))}
        </View>
      ) : null}
      <Text style={[styles.count, compact && styles.countCompact]} maxFontSizeMultiplier={1.2}>
        +{people.length}
      </Text>
      {!compact ? (
        <Text style={styles.label} maxFontSizeMultiplier={1.2}>
          {people.length === 1 ? 'other' : 'others'}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: callColors.surfaceRaised,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.8,
  },
  avatars: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  avatarSlot: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: callColors.surfaceRaised,
  },
  count: {
    color: callColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  countCompact: {
    fontSize: 16,
  },
  label: {
    color: callColors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
});
