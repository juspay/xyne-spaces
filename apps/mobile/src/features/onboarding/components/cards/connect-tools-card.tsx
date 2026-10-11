import type { ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CardHeading } from '../card-heading';
import { CONNECTOR_TOOLS, type ConnectorTool } from '../../model/tools';
import { deckPalette } from '../../theme';

function ToolRow({
  tool,
  connected,
  onPress,
}: {
  tool: ConnectorTool;
  connected: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <View style={styles.toolRow}>
      <View style={[styles.mark, { borderColor: tool.tint }]}>
        <Text style={[styles.markGlyph, { color: tool.tint }]}>{tool.initial}</Text>
      </View>
      <Text style={styles.toolLabel} numberOfLines={1}>
        {tool.label}
      </Text>
      <Pressable
        onPress={onPress}
        accessibilityRole='button'
        accessibilityLabel={`${connected ? 'Disconnect' : 'Connect'} ${tool.label}`}
        accessibilityState={{ selected: connected }}
        style={({ pressed }) => [
          styles.connect,
          connected ? styles.connectDone : null,
          pressed ? styles.connectPressed : null,
        ]}
      >
        <Text style={[styles.connectLabel, connected ? styles.connectLabelDone : null]}>
          {connected ? 'Connected' : 'Connect'}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * "Any tools you'd like to connect?" — the last card on every path, and always skippable.
 *
 * The buttons record a choice and nothing more; no OAuth is wired yet, so the card never blocks
 * the way into the app.
 */
export function ConnectToolsCard({
  connected,
  onToggle,
}: {
  connected: readonly string[];
  onToggle: (toolId: string) => void;
}): ReactElement {
  return (
    <View style={styles.card}>
      <CardHeading
        title="Any tools you'd like to connect?"
        subtitle='Xyne works across your tools, answering questions and doing tasks.'
      />
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {CONNECTOR_TOOLS.map(tool => (
          <ToolRow
            key={tool.id}
            tool={tool}
            connected={connected.includes(tool.id)}
            onPress={() => onToggle(tool.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: 18,
  },
  list: {
    flex: 1,
    // Bleeds past the card's padding so a scrolled row runs to the rounded edge.
    marginHorizontal: -4,
  },
  listContent: {
    gap: 10,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    padding: 12,
    backgroundColor: deckPalette.row,
  },
  mark: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161616',
  },
  markGlyph: {
    fontSize: 18,
    fontWeight: '700',
  },
  toolLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: deckPalette.textPrimary,
  },
  connect: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: '#3A3A3A',
  },
  connectDone: {
    backgroundColor: deckPalette.selected,
  },
  connectPressed: {
    opacity: 0.75,
  },
  connectLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: deckPalette.textPrimary,
  },
  connectLabelDone: {
    color: deckPalette.selectedText,
  },
});
