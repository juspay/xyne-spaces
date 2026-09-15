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

export interface LinkDialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
  linkUrl: string;
  setLinkUrl: (url: string) => void;
  linkText: string;
  setLinkText: (text: string) => void;
  hasSelection: boolean;
  isExistingLink: boolean;
  openDialog: () => void;
  applyLink: () => void;
  removeLink: () => void;
}

export interface LinkDialogProps extends LinkDialogState {
  trigger?: React.ReactNode;
}

export interface LinkPopoverProps {
  editor: Editor | null;
}
