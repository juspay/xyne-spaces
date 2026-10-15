import type { EmojiEntry } from './emoji-picker.data';
import type { CustomEmojiItem } from '@/src/hooks/useCustomEmojis';

export type EmojiCategoryBarItem = {
  id: string;
  icon: string;
  useXyneIcon?: boolean;
  disabled?: boolean;
  loading?: boolean;
};

export type EmojiPickerItemLayout = {
  index: number;
  length: number;
  offset: number;
};

export type PickerListItem =
  | {
      kind: 'header';
      id: string;
      categoryId: string;
      label: string;
    }
  | {
      kind: 'emoji-row';
      id: string;
      row: EmojiEntry[];
    }
  | {
      kind: 'custom-row';
      id: string;
      row: CustomEmojiItem[];
    };

export type EmojiPickerSelection =
  | {
      type: 'emoji';
      value: string;
    }
  | {
      type: 'custom';
      value: string;
      emojiId: string;
      name: string;
    };
