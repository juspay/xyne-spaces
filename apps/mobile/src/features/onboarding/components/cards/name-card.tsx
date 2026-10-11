import type { ReactElement } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { CardHeading } from '../card-heading';
import { deckMetrics, deckPalette } from '../../theme';

/**
 * "Let's start with your name" — only on the email sign-up path, where no provider handed us one.
 */
export function NameCard({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (name: string) => void;
}): ReactElement {
  return (
    <View style={styles.card}>
      <CardHeading title="Let's start with your name" />
      <TextInput
        value={value ?? ''}
        onChangeText={onChange}
        placeholder='Your full name'
        placeholderTextColor={deckPalette.textMuted}
        autoCapitalize='words'
        autoCorrect={false}
        autoComplete='name'
        textContentType='name'
        returnKeyType='done'
        accessibilityLabel='Your full name'
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: 24,
  },
  input: {
    minHeight: deckMetrics.rowHeight,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: deckPalette.textPrimary,
    backgroundColor: deckPalette.row,
  },
});
