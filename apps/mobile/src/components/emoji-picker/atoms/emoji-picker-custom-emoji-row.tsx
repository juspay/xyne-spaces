import { memo, type ReactElement } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';

import { useMtlsEmoji } from '@/src/hooks/useMtlsEmoji';
import type { CustomEmojiItem } from '@/src/hooks/useCustomEmojis';

import { EMOJI_PICKER_CUSTOM_EMOJI_SIZE } from '../emoji-picker.constants';
import { EMOJI_PICKER_COLUMNS } from '../emoji-picker.data';
import { emojiPickerStyles } from '../emoji-picker.styles';
import type { EmojiPickerSelection } from '../emoji-picker.types';

type EmojiPickerCustomEmojiCellProps = {
  emojiId: string;
  name: string;
  onSelect: (selection: EmojiPickerSelection) => void;
};

const EmojiPickerCustomEmojiCell = memo(function EmojiPickerCustomEmojiCell({
  emojiId,
  name,
  onSelect,
}: EmojiPickerCustomEmojiCellProps): ReactElement {
  const { uri } = useMtlsEmoji(emojiId);

  let content: ReactElement;
  if (uri) {
    content = (
      <Image
        source={{
          uri,
          width: EMOJI_PICKER_CUSTOM_EMOJI_SIZE,
          height: EMOJI_PICKER_CUSTOM_EMOJI_SIZE,
        }}
        style={emojiPickerStyles.customImage}
        contentFit='contain'
        // Already a local file. memory-disk also keeps decoded GIF frames in
        // HWUI, which SIGSEGVs RenderThread after enough custom-emoji cells.
        cachePolicy='disk'
        recyclingKey={emojiId}
      />
    );
  } else {
    content = <View style={emojiPickerStyles.customImagePlaceholder} />;
  }

  return (
    <Pressable
      style={({ pressed }) =>
        pressed ? [emojiPickerStyles.cell, emojiPickerStyles.cellPressed] : emojiPickerStyles.cell
      }
      onPress={() =>
        onSelect({
          type: 'custom',
          value: `custom:${emojiId}:${name}`,
          emojiId,
          name,
        })
      }
    >
      {content}
    </Pressable>
  );
});

type EmojiPickerCustomEmojiRowProps = {
  row: CustomEmojiItem[];
  onSelect: (selection: EmojiPickerSelection) => void;
};

const EmojiPickerCustomEmojiRow = memo(function EmojiPickerCustomEmojiRow({
  row,
  onSelect,
}: EmojiPickerCustomEmojiRowProps): ReactElement {
  const padCount = EMOJI_PICKER_COLUMNS - row.length;

  return (
    <View style={emojiPickerStyles.row}>
      {row.map(item => (
        <EmojiPickerCustomEmojiCell
          key={item.id}
          emojiId={item.id}
          name={item.name}
          onSelect={onSelect}
        />
      ))}
      {padCount > 0
        ? Array.from({ length: padCount }, (_, index) => (
            <View key={`pad-${index}`} style={emojiPickerStyles.cell} />
          ))
        : null}
    </View>
  );
});

EmojiPickerCustomEmojiRow.displayName = 'EmojiPickerCustomEmojiRow';

export { EmojiPickerCustomEmojiRow };
