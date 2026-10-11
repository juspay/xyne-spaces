import type { ReactElement } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { CardHeading } from '../card-heading';
import { deckMetrics, deckPalette } from '../../theme';

export interface WorkspaceSetupCardProps {
  workspaceName: string | undefined;
  companyName: string | undefined;
  allowDomainJoin: boolean;
  onChange: (patch: {
    workspaceName?: string;
    companyName?: string;
    allowDomainJoin?: boolean;
  }) => void;
  /** The part after the `@` in their address, for the domain-join line. */
  emailDomain: string;
  /** Set when the address is a personal one, which the backend refuses to build an org from. */
  publicEmailDomainError: string | null;
}

/**
 * "Set up your workspace".
 *
 * Leaving the name blank is the skip in the spec's fourth path — the deck reads an empty name as
 * "passed on it" and lands the user in the community instead.
 */
export function WorkspaceSetupCard({
  workspaceName,
  companyName,
  allowDomainJoin,
  onChange,
  emailDomain,
  publicEmailDomainError,
}: WorkspaceSetupCardProps): ReactElement {
  return (
    <View style={styles.card}>
      <CardHeading title='Set up your workspace' />

      <View style={styles.fields}>
        <View style={styles.field}>
          <Text style={styles.label}>Workspace name</Text>
          <TextInput
            value={workspaceName ?? ''}
            onChangeText={text => onChange({ workspaceName: text })}
            placeholder='Acme'
            placeholderTextColor={deckPalette.textMuted}
            autoCapitalize='words'
            autoCorrect={false}
            accessibilityLabel='Workspace name'
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Company name</Text>
          <TextInput
            value={companyName ?? ''}
            onChangeText={text => onChange({ companyName: text })}
            placeholder='Acme'
            placeholderTextColor={deckPalette.textMuted}
            autoCapitalize='words'
            autoCorrect={false}
            accessibilityLabel='Company name'
            style={styles.input}
          />
        </View>
      </View>

      {publicEmailDomainError === null ? (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Anyone with an @{emailDomain} email can join</Text>
          <Switch
            value={allowDomainJoin}
            onValueChange={next => onChange({ allowDomainJoin: next })}
            accessibilityLabel={`Anyone with an @${emailDomain} email can join`}
            trackColor={{ false: deckPalette.row, true: deckPalette.accent }}
            thumbColor={deckPalette.selected}
            ios_backgroundColor={deckPalette.row}
          />
        </View>
      ) : (
        <Text style={styles.notice}>{publicEmailDomainError}</Text>
      )}

      <Text style={styles.footnote}>Leave this blank to skip — you can set one up later.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: 18,
  },
  fields: {
    gap: 14,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    color: deckPalette.textSecondary,
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
    color: deckPalette.textSecondary,
  },
  notice: {
    fontSize: 13,
    lineHeight: 19,
    color: deckPalette.accent,
  },
  footnote: {
    marginTop: 'auto',
    fontSize: 13,
    color: deckPalette.textMuted,
  },
});
