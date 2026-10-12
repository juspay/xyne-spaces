import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardHeading } from '../card-heading';
import { OptionRow } from '../option-row';
import { COMPANY_SIZE_OPTIONS, type CompanySize } from '../../model/answers';

/**
 * "Tell us about your company" — the dashboard's org-size question, asked only of someone who is
 * creating the org (see `buildFlow`).
 */
export function CompanySizeCard({
  value,
  onChange,
}: {
  value: CompanySize | undefined;
  onChange: (size: CompanySize) => void;
}): ReactElement {
  return (
    <View style={styles.card}>
      <CardHeading
        title='Tell us about your company'
        subtitle='This helps us set up your Xyne workspace for your team.'
      />
      <View style={styles.options} accessibilityRole='radiogroup' accessibilityLabel='Company size'>
        {COMPANY_SIZE_OPTIONS.map(size => (
          <OptionRow
            key={size}
            label={size}
            selected={value === size}
            onPress={() => onChange(size)}
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
