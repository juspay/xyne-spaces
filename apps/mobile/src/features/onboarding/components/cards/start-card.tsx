import { ChevronRight, Info } from 'lucide-react-native';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CardHeading } from '../card-heading';
import { StartChoice } from '../../model/answers';
import { deckPalette } from '../../theme';

export interface StartCardProps {
  value: StartChoice | undefined;
  onChange: (choice: StartChoice) => void;
  /** The public community space, once the listing lands. */
  community: { name: string; description: string | null } | null;
}

/**
 * "Where do you want to start?" — the fork the rest of the deck hangs off.
 *
 * The community row names the real workspace from `/community/workspaces`; it falls back to the
 * product name while the listing is in flight, so the card never renders empty.
 */
export function StartCard({ value, onChange, community }: StartCardProps): ReactElement {
  const isCommunity = value === StartChoice.COMMUNITY;
  const isWorkspace = value === StartChoice.WORKSPACE;

  return (
    <View style={styles.card}>
      <CardHeading title='Where do you want to start?' />

      <Pressable
        onPress={() => onChange(StartChoice.COMMUNITY)}
        accessibilityRole='radio'
        accessibilityState={{ selected: isCommunity }}
        accessibilityLabel={`Join ${community?.name ?? 'Xyne'} community space`}
        style={[styles.communityRow, isCommunity ? styles.communityRowSelected : null]}
      >
        <View style={styles.logo}>
          <Text style={styles.logoGlyph}>x</Text>
        </View>

        <View style={styles.communityText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {community?.name ?? 'Xyne'}
            </Text>
            <View style={styles.tag}>
              <Text style={styles.tagLabel}>Community space</Text>
            </View>
          </View>
          <Text style={styles.subtle} numberOfLines={1}>
            {community?.description ?? 'Open to everyone'}
          </Text>
        </View>

        <View style={[styles.joinPill, isCommunity ? styles.joinPillSelected : null]}>
          <Text style={[styles.joinLabel, isCommunity ? styles.joinLabelSelected : null]}>
            {isCommunity ? 'Joining' : 'Join'}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => onChange(StartChoice.WORKSPACE)}
        accessibilityRole='radio'
        accessibilityState={{ selected: isWorkspace }}
        accessibilityLabel='Join or create workspace'
        style={styles.workspaceRow}
      >
        <View style={styles.workspaceText}>
          <Text style={[styles.workspaceTitle, isWorkspace ? styles.accented : null]}>
            Join or create workspace
          </Text>
          <Text style={styles.subtle}>A private Xyne Workspace to try with your team</Text>
        </View>
        <ChevronRight
          size={20}
          color={isWorkspace ? deckPalette.accent : deckPalette.textMuted}
          strokeWidth={2}
        />
      </Pressable>

      <View style={styles.footnote}>
        <Info size={16} color={deckPalette.textMuted} strokeWidth={1.8} />
        <Text style={styles.footnoteLabel}>You can join or create workspace anytime.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: 20,
  },
  communityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 12,
    backgroundColor: deckPalette.row,
  },
  communityRowSelected: {
    borderColor: deckPalette.accent,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2F2F2F',
  },
  logoGlyph: {
    fontSize: 22,
    fontWeight: '700',
    fontStyle: 'italic',
    color: deckPalette.accent,
  },
  communityText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '600',
    color: deckPalette.textPrimary,
  },
  tag: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#333333',
  },
  tagLabel: {
    fontSize: 11,
    color: deckPalette.textSecondary,
  },
  subtle: {
    fontSize: 13,
    color: deckPalette.textSecondary,
  },
  joinPill: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#3A3A3A',
  },
  joinPillSelected: {
    backgroundColor: deckPalette.selected,
  },
  joinLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: deckPalette.textPrimary,
  },
  joinLabelSelected: {
    color: deckPalette.selectedText,
  },
  workspaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  workspaceText: {
    flex: 1,
    gap: 2,
  },
  workspaceTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: deckPalette.textPrimary,
  },
  accented: {
    color: deckPalette.accent,
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
