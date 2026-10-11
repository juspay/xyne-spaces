import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardHeading } from '../card-heading';
import { OptionRow } from '../option-row';
import { ROLE_OPTIONS, type RoleId } from '../../model/answers';

/** "What's your day mostly made of?" — the one card every path shows. */
export function RoleCard({
  value,
  onChange,
}: {
  value: RoleId | undefined;
  onChange: (role: RoleId) => void;
}): ReactElement {
  return (
    <View style={styles.card}>
      <CardHeading title="What's your day mostly made of?" />
      <View style={styles.options} accessibilityRole='radiogroup'>
        {ROLE_OPTIONS.map(option => (
          <OptionRow
            key={option.id}
            label={option.label}
            selected={value === option.id}
            onPress={() => onChange(option.id)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: 24,
  },
  options: {
    gap: 10,
  },
});
