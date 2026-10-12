import type { ReactElement } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { CardHeading } from '../card-heading';
import { deckMetrics, deckPalette } from '../../theme';

/**
 * "What's your role in your team?" — the dashboard's question, free text and optional, asked on
 * every path that ends in a session.
 */
export function RoleCard({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (role: string) => void;
}): ReactElement {
  return (
    <View style={styles.card}>
      <CardHeading
        title="What's your role in your team?"
        subtitle='Helps your teammates recognise and connect with you.'
      />
      <TextInput
        value={value ?? ''}
        onChangeText={onChange}
        placeholder='Ex: Product Manager'
        placeholderTextColor={deckPalette.textMuted}
        autoCapitalize='words'
        autoCorrect={false}
        returnKeyType='done'
        accessibilityLabel='Your role'
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
