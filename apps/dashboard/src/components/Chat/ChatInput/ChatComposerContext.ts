import { createContext, use } from 'react';
import type { FocusPosition } from '@tiptap/react';
import type { Conversation, MentionResult } from '@xyne/shared';
import type { useChannel } from '../../../hooks/useChannels';
import type { useChannelShortcuts } from '../../../hooks/useChannelAppCommands';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import type { ChannelResult, CommandItem, TypingUser } from '../../ui/InputBox/InputBox.types';
import type { RelatedItem } from '../../../types/search';
import type { ChatComposerCapabilities, ChatComposerMode } from './chatComposerMode';

/** The related-context popup. It keeps the items it opened with. */
export interface RelatedPopupState {
  open: boolean;
  items: RelatedItem[];
  draft: string;
  selectedId: string | null;
}

export interface ChatComposerState {
  channel: ReturnType<typeof useChannel>;
  /** Text the editor is seeded with: the draft, or the message being edited. */
  editorValue: string | undefined;
  typingUsers: TypingUser[];
  /** The agent-progress pill has content, so it can take the typing indicator's place. */
  agentActive: boolean;
  alsoSendToChannel: boolean;
  activeArtifactCommand: string | null;
  isAttachmentUploading: boolean;
  discussionTitle: string;
  related: {
    items: RelatedItem[];
    loading: boolean;
    popup: RelatedPopupState;
  };
  /** When a scheduled message from this channel or thread goes out, if one is waiting. */
  bannerScheduledFor: number | null;
  connection: {
    isOffline: boolean;
    showOfflineBanner: boolean;
    isReconnecting: boolean;
    isReconnected: boolean;
  };
  dialogs: {
    createTicket: { open: boolean; description: string; source: string };
    scheduleCall: boolean;
    addPeople: boolean;
    shortcuts: boolean;
  };
}

export interface ChatComposerActions {
  send: (plainText: string, html: string, files: File[]) => void;
  scheduleSend: (scheduledFor: number, html: string, files: File[]) => void;
  contentChange: (html: string, text: string) => void;
  typing: () => void;
  selectCommand: (command: CommandItem, text?: string) => Promise<void>;
  cancelArtifact: () => void;
  searchMentions: (query: string) => void;
  searchChannels: (query: string) => void;
  setAlsoSendToChannel: (checked: boolean) => void;
  setDiscussionTitle: (title: string) => void;
  setAgentActive: (active: boolean) => void;
  cancelEdit: () => void;
  createTicketFromComposer: (description: string | undefined) => void;
  createCanvas: (initialContent?: string) => void;
  insertTranscript: (content: string) => void;
  refreshConnection: () => void;
  openScheduledMessages: () => void;
  related: {
    open: (item: RelatedItem, event: React.MouseEvent) => void;
    select: (id: string) => void;
    jump: (item: RelatedItem, event: React.MouseEvent | React.KeyboardEvent) => void;
    close: () => void;
    dismiss: () => void;
  };
  dialogs: {
    closeCreateTicket: () => void;
    ticketCreated: () => void;
    closeScheduleCall: () => void;
    setAddPeopleOpen: (open: boolean) => void;
    setShortcutsOpen: (open: boolean) => void;
  };
}

export interface ChatComposerMeta {
  mode: ChatComposerMode;
  capabilities: ChatComposerCapabilities;
  channelId: string;
  conversation: Conversation | undefined;
  conversationId: string | undefined;
  /** The draft's and the typing indicator's key: the thread, else the channel. */
  sessionId: string;
  /** Includes a conversation this composer just started, before the view moves into it. */
  agentProgressConversationId: string | undefined;
  inputBoxRef: React.RefObject<InputBoxHandle | null>;
  discussionTitleRef: React.RefObject<HTMLInputElement | null>;
  autoFocus: FocusPosition;
  placeholder: React.ReactNode;
  className: string;
  showTypingIndicator: boolean;
  hasTicket: boolean;
  isDM: boolean;
  /** "#general" or the DM's name, for the artifact chip. Empty in tests. */
  artifactChannelLabel: string | undefined;
  isMobile: boolean;
  isXyneAIOpen: boolean;
  mentionItems: MentionResult[];
  /** Mention results plus every channel member, so dictated names resolve. */
  voiceMentionItems: MentionResult[];
  channelItems: ChannelResult[];
  commandItems: CommandItem[];
  globalShortcuts: ReturnType<typeof useChannelShortcuts>;
}

export interface ChatComposerContextValue {
  state: ChatComposerState;
  actions: ChatComposerActions;
  meta: ChatComposerMeta;
}

export const ChatComposerContext = createContext<ChatComposerContextValue | null>(null);

/** The composer around this part. Parts only work inside a `ChatComposerProvider`. */
export function useChatComposer(): ChatComposerContextValue {
  const value = use(ChatComposerContext);
  if (!value) {
    throw new Error('ChatComposer parts must be rendered inside <ChatComposerProvider>');
  }
  return value;
}
