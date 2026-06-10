import type { Editor } from '@tiptap/react';
import { EmojiClickData } from 'emoji-picker-react';

export interface EditorToolbarProps {
  editor: Editor | null;
  showImageUpload?: boolean;
  rightSlot?: React.ReactNode;
  variant?: 'default' | 'compact';
}

export interface EmojiPickerButtonProps {
  onEmojiSelect: (emoji: EmojiClickData) => void;
  disabled?: boolean;
}

export interface MobileEditorToolbarProps {
  editor: Editor | null;
  onClose: () => void;
  onSend: () => void;
  hasContent: boolean;
  isSending: boolean;
  disabled: boolean;
}
