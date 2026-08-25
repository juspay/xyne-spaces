export type { MentionResult } from '@xyne/shared';
export type { CommandItem, ChannelResult } from '../Selectors/Selectors.types';
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
  mentionItems?: import('@xyne/shared').MentionResult[];
  voiceMentionItems?: import('@xyne/shared').MentionResult[];
  onMentionSearch?: (query: string) => void;
  onMentionSelect?: (mention: import('@xyne/shared').MentionResult) => void;
  channelItems?: import('../Selectors/Selectors.types').ChannelResult[];
  onChannelSearch?: (query: string) => void;
  onChannelSelect?: (channel: import('../Selectors/Selectors.types').ChannelResult) => void;
  commandItems?: import('../Selectors/Selectors.types').CommandItem[];
  onCommandSelect?: (
    command: import('../Selectors/Selectors.types').CommandItem,
    text?: string,
  ) => void | Promise<void>;
  isLoadingCommands?: boolean;
  onTyping?: () => void;
  typingUsers?: TypingUser[];
  showTypingIndicator?: boolean;
  /** Rendered in the activity bar above the input (e.g. agent-progress pill). */
  agentSlot?: React.ReactNode;
  /** Whether the agentSlot currently has active content — drives the typing↔agent flip. */
  hasAgentActivity?: boolean;
  placeholder?: React.ReactNode;
  value?: string | undefined;
  disabled?: boolean;
  className?: string;
  features?: InputBoxFeatures;
  blockedExtensions?: readonly string[];
  maxFiles?: number;
  onAlsoSendToChannelChange?: (checked: boolean) => void;
  alsoSendToChannelChecked?: boolean;
  preserveThreadRoute?: boolean;
  isDMThread?: boolean;
  onCreateTicket?: (description?: string) => void;
  onCreateCanvas?: (initialContent?: string) => void;
  onTranscriptSelect?: (content: string) => void;
  onScheduleSend?: (scheduledFor: number, content: string, files: File[]) => void | Promise<void>;
  hasTicket?: boolean;
  disableEnterToSend?: boolean;
  hideSendButton?: boolean;
  hideComposerTools?: boolean;
  showAttachButtonWhenToolsHidden?: boolean;
  attachmentMenuMode?: 'full' | 'filesOnly';
  hideVoiceInput?: boolean;
  compact?: boolean;
  sendDisabled?: boolean;
  /** Shown on the send button's tooltip in place of 'Send message' while sendDisabled. */
  sendDisabledReason?: string;
  /** Extra buttons rendered in the left side of the desktop bottom action bar, after the # button */
  bottomLeftSlot?: React.ReactNode;
  disableDraftUpload?: boolean;
  dockSlot?: React.ReactNode;
  slashCommandArtifactCommand?: string;
  slashCommandArtifactChannelLabel?: string;
  onCancelSlashCommandArtifact?: () => void;
}
