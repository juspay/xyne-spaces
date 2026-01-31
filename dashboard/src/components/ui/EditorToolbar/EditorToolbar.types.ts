import type { Editor } from '@tiptap/react';
import { EmojiClickData } from 'emoji-picker-react';

export interface EditorToolbarProps {
  editor: Editor | null;
}

export interface EmojiPickerButtonProps {
  onEmojiSelect: (emoji: EmojiClickData) => void;
  disabled?: boolean;
}
