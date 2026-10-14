import { StyleSheet } from 'react-native';

import {
  EMOJI_PICKER_CELL_SIZE,
  EMOJI_PICKER_CUSTOM_EMOJI_SIZE,
  EMOJI_PICKER_HEADER_HEIGHT,
  EMOJI_PICKER_ROW_HEIGHT,
} from './emoji-picker.constants';

export const emojiPickerStyles = StyleSheet.create({
  cell: {
    width: EMOJI_PICKER_CELL_SIZE,
    height: EMOJI_PICKER_CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellPressed: {
    opacity: 0.55,
  },
  emojiText: {
    fontSize: 28,
    lineHeight: 32,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    height: EMOJI_PICKER_ROW_HEIGHT,
  },
  customImage: {
    width: EMOJI_PICKER_CUSTOM_EMOJI_SIZE,
    height: EMOJI_PICKER_CUSTOM_EMOJI_SIZE,
  },
  customImagePlaceholder: {
    width: EMOJI_PICKER_CUSTOM_EMOJI_SIZE,
    height: EMOJI_PICKER_CUSTOM_EMOJI_SIZE,
    borderRadius: 6,
    backgroundColor: 'rgba(142, 142, 147, 0.18)',
  },
  sectionHeader: {
    height: EMOJI_PICKER_HEADER_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  categoryTab: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  categoryIcon: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
  },
  xyneCategoryIcon: {
    width: 22,
    height: 22,
    borderRadius: 5,
  },
});
