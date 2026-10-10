import { memo, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ArtifactAvatar } from './artifact-avatar';
import { loginPalette } from '../theme';
import type { ArtifactCard as ArtifactCardModel } from '../model/artifacts';

/** The collapsed "Thinking 3s ⌄" row an agent shows while it works. */
function ThinkingRow({ label }: { label: string }): ReactElement {
  return (
    <View style={styles.thinkingRow}>
      <View style={styles.thinkingDots}>
        {[0, 1, 2, 3].map(index => (
          <View key={index} style={styles.thinkingDot} />
        ))}
      </View>
      <Text style={styles.thinkingLabel}>{label}</Text>
      <Text style={styles.chevron}>⌄</Text>
    </View>
  );
}

/**
 * One row of the decorative feed. Presentational and inert — nothing here is pressable, so it
 * carries no accessibility role and is hidden from screen readers by the feed above it.
 */
export const ArtifactCard = memo(function ArtifactCard({
  card,
}: {
  card: ArtifactCardModel;
}): ReactElement {
  const hasSubtitle = card.verb !== undefined || card.channel !== undefined;

  return (
    <View style={styles.row}>
      <View style={styles.gutter}>
        <ArtifactAvatar author={card.author} badge={card.mentionBadge ?? false} />
        {card.threadLine ? <View style={styles.threadLine} /> : null}
      </View>

      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.name} numberOfLines={1}>
            {card.author.name}
          </Text>
          {hasSubtitle ? null : <Text style={styles.time}>{card.time}</Text>}
          {hasSubtitle && card.time !== undefined ? (
            <Text style={[styles.time, styles.timeTrailing]}>{card.time}</Text>
          ) : null}
        </View>

        {hasSubtitle ? (
          <View style={styles.subtitleRow}>
            {card.verb !== undefined ? <Text style={styles.verb}>{card.verb}</Text> : null}
            {card.channel !== undefined ? (
              <View style={styles.channelChip}>
                <Text style={styles.channelLabel}>{card.channel}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {card.thinking !== undefined ? <ThinkingRow label={card.thinking} /> : null}

        {card.body !== undefined ? (
          <Text style={styles.body}>
            {card.mention !== undefined ? (
              <Text style={styles.mention}>{` ${card.mention} `}</Text>
            ) : null}
            {card.mention !== undefined ? ' ' : ''}
            {card.body}
          </Text>
        ) : null}

        {card.reactions !== undefined ? (
          <View style={styles.reactionRow}>
            {card.reactions.map(reaction => (
              <View key={reaction.emoji} style={styles.reaction}>
                <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                <Text style={styles.reactionCount}>{reaction.count}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {card.trailing !== undefined ? <Text style={styles.trailing}>{card.trailing}</Text> : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  gutter: {
    width: 30,
    marginRight: 10,
    marginTop: 14,
    alignItems: 'center',
  },
  threadLine: {
    flex: 1,
    width: 2,
    marginTop: 8,
    borderRadius: 1,
    backgroundColor: loginPalette.surfaceRaised,
  },
  card: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: loginPalette.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    color: loginPalette.textPrimary,
  },
  time: {
    fontSize: 12,
    color: loginPalette.textSecondary,
  },
  timeTrailing: {
    marginLeft: 'auto',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -2,
  },
  verb: {
    fontSize: 13,
    color: loginPalette.textSecondary,
  },
  channelChip: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: loginPalette.chip,
  },
  channelLabel: {
    fontSize: 13,
    color: loginPalette.chipText,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: loginPalette.textBody,
  },
  mention: {
    fontSize: 15,
    lineHeight: 22,
    color: loginPalette.mentionText,
    backgroundColor: loginPalette.mentionBackground,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  thinkingDots: {
    width: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  thinkingDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: loginPalette.accent,
  },
  thinkingLabel: {
    fontSize: 13,
    color: loginPalette.textSecondary,
  },
  chevron: {
    fontSize: 12,
    lineHeight: 14,
    color: loginPalette.textSecondary,
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  reaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: loginPalette.surfaceRaised,
  },
  reactionEmoji: {
    fontSize: 12,
  },
  reactionCount: {
    fontSize: 12,
    fontWeight: '600',
    color: loginPalette.textBody,
  },
  trailing: {
    fontSize: 15,
    lineHeight: 22,
    color: loginPalette.textMuted,
  },
});
