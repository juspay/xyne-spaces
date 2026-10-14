import { memo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { EMOJI_PICKER_COLUMNS, type EmojiEntry } from '../emoji-picker.data';
import { emojiPickerStyles } from '../emoji-picker.styles';
import type { EmojiPickerSelection } from '../emoji-picker.types';

type EmojiPickerEmojiCellProps = {
  entry: EmojiEntry;
  onSelect: (selection: EmojiPickerSelection) => void;
};

const EmojiPickerEmojiCell = memo(function EmojiPickerEmojiCell({
  entry,
  onSelect,
}: EmojiPickerEmojiCellProps): ReactElement {
  return (
    <Pressable
      style={({ pressed }) =>
        pressed ? [emojiPickerStyles.cell, emojiPickerStyles.cellPressed] : emojiPickerStyles.cell
      }
      onPress={() => onSelect({ type: 'emoji', value: entry.emoji })}
    >
      <Text style={emojiPickerStyles.emojiText}>{entry.emoji}</Text>
    </Pressable>
  );
});

type EmojiPickerEmojiRowProps = {
  row: EmojiEntry[];
  onSelect: (selection: EmojiPickerSelection) => void;
};

const EmojiPickerEmojiRow = memo(function EmojiPickerEmojiRow({
  row,
  onSelect,
}: EmojiPickerEmojiRowProps): ReactElement {
  const padCount = EMOJI_PICKER_COLUMNS - row.length;

  return (
    <View style={emojiPickerStyles.row}>
      {row.map((entry, index) => (
        <EmojiPickerEmojiCell key={`${entry.slug}-${index}`} entry={entry} onSelect={onSelect} />
      ))}
      {padCount > 0
        ? Array.from({ length: padCount }, (_, index) => (
            <View key={`pad-${index}`} style={emojiPickerStyles.cell} />
          ))
        : null}
    </View>
  );
});

EmojiPickerEmojiRow.displayName = 'EmojiPickerEmojiRow';

export { EmojiPickerEmojiRow };
