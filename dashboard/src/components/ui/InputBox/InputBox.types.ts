export type { MentionResult, CommandItem, ChannelResult } from '../Selectors/Selectors.types';
import type { FocusPosition } from '@tiptap/react';

export interface TypingUser {
  userId: string;
  username: string;
  picture?: string;
}

export interface InputBoxFeatures {
  richText?: boolean;
  commands?: boolean;
  mentions?: boolean;
  fileAttachments?: boolean;
  emojiPicker?: boolean;
}

export interface InputBoxProps {
  autoFocus?: FocusPosition;
  id: string;
  channelId?: string;
  conversationId?: string;
  onSendMessage: (
    content: string,
    html: string,
    files: File[],
    videoThumbnails?: Map<File, Blob>,
  ) => void | Promise<void>;
  onContentChange?: (html: string, text: string) => void;
  onCancel?: () => void;
  mentionItems?: import('../Selectors/Selectors.types').MentionResult[];
  onMentionSearch?: (query: string) => void;
  onMentionSelect?: (mention: import('../Selectors/Selectors.types').MentionResult) => void;
  channelItems?: import('../Selectors/Selectors.types').ChannelResult[];
  onChannelSearch?: (query: string) => void;
  onChannelSelect?: (channel: import('../Selectors/Selectors.types').ChannelResult) => void;
  commandItems?: import('../Selectors/Selectors.types').CommandItem[];
  onCommandSelect?: (
    command: import('../Selectors/Selectors.types').CommandItem,
  ) => void | Promise<void>;
  isLoadingCommands?: boolean;
  onTyping?: () => void;
  typingUsers?: TypingUser[];
  showTypingIndicator?: boolean;
  placeholder?: React.ReactNode;
  value?: string | undefined;
  disabled?: boolean;
  className?: string;
  features?: InputBoxFeatures;
  blockedExtensions?: readonly string[];
  maxFiles?: number;
  onAlsoSendToChannelChange?: (checked: boolean) => void;
  alsoSendToChannelChecked?: boolean;
  onCreateTicket?: (description?: string) => void;
  onCreateCanvas?: (initialContent?: string) => void;
  onTranscriptSelect?: (content: string) => void;
  onScheduleSend?: (scheduledFor: number, content: string, files: File[]) => void | Promise<void>;
  hasTicket?: boolean;
  disableEnterToSend?: boolean;
  hideSendButton?: boolean;
  sendDisabled?: boolean;
}
