import { Info } from 'lucide-react-native';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CardHeading } from '../card-heading';
import { OptionRow } from '../option-row';
import { CompanyChoice } from '../../model/answers';
import { deckPalette } from '../../theme';

/**
 * "{Company} is on Xyne".
 *
 * Shown when the sign-in exchange reported that this email domain already belongs to an org, so
 * the user cannot start their own: they either ask that org for access, or spin up a separate
 * workspace inside it.
 */
export function CompanyOnXyneCard({
  orgName,
  value,
  onChange,
}: {
  orgName: string;
  value: CompanyChoice | undefined;
  onChange: (choice: CompanyChoice) => void;
}): ReactElement {
  return (
    <View style={styles.card}>
      <CardHeading
        title={`${orgName} is on Xyne`}
        subtitle={`People at ${orgName} already use a workspace. Ask to join it, or start your own.`}
      />

      <View style={styles.options} accessibilityRole='radiogroup'>
        <OptionRow
          label={`Request to join ${orgName}`}
          selected={value === CompanyChoice.REQUEST_JOIN}
          onPress={() => onChange(CompanyChoice.REQUEST_JOIN)}
        />
        <OptionRow
          label='Create a new workspace'
          selected={value === CompanyChoice.CREATE_NEW}
          onPress={() => onChange(CompanyChoice.CREATE_NEW)}
        />
      </View>

      <View style={styles.footnote}>
        <Info size={16} color={deckPalette.textMuted} strokeWidth={1.8} />
        <Text style={styles.footnoteLabel}>
          An admin reviews join requests. You can use Xyne once yours is approved.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: 20,
  },
  options: {
    gap: 10,
  },
  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 'auto',
  },
  footnoteLabel: {
    flex: 1,
    fontSize: 13,
    color: deckPalette.textMuted,
  },
});
