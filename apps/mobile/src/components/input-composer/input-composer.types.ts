import type { ReactNode, RefObject, SetStateAction } from 'react';
import type {
  EnrichedTextInputInstance,
  OnChangeSelectionEvent,
  OnChangeStateEvent,
} from 'react-native-enriched';
import type { EmojiPickerSelection } from '@/src/components/emoji-picker';

export type ComposerAttachmentSource = 'gallery' | 'camera' | 'file' | 'recent';

export type ComposerAttachment = {
  attachmentId: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  width?: number;
  height?: number;
  localUri: string;
  thumbnailUri?: string;
  source: ComposerAttachmentSource;
  status: 'local' | 'uploading' | 'uploaded' | 'failed';
  error?: string;
};

export type ChatInputSendPayload = {
  text: string;
  html: string;
  attachments: ComposerAttachment[];
  alsoSendToChannel?: boolean;
};

/**
 * Called by handlers when the mutation was accepted client-side but the server
 * later rejects with a non-transient error (or the client-side mutator throws).
 * Restores the composer to the state it was in just before send.
 */
export type ChatInputRestoreSnapshot = () => void;

export type ChatInputSendHandler = (
  payload: ChatInputSendPayload,
  restore: ChatInputRestoreSnapshot,
) => void | Promise<void>;

export type ChatInputSelection = OnChangeSelectionEvent;
export type ChatInputMentionMode = '@' | '#';

export type ChatInputLinkModalState = {
  text: string;
  url: string;
  selection: ChatInputSelection | null;
};

export type ChatInputEditingMessage = {
  messageId: string;
  conversationId: string;
  channelId: string;
  content: string;
};

export type ComposerSnapshot = {
  text: string;
  html: string;
  attachments: ComposerAttachment[];
  alsoSendToChannel: boolean;
};

/**
 * Stable conversation identity — set once at mount, never changes while
 * the Root component is alive (it is re-keyed on conversationId / editing).
 * Split out so components that only need these never re-render on typing.
 */
export type ChatInputConversation = {
  conversationId: string;
  threadId: string | undefined;
  isEditing: boolean;
  isTwinEditing: boolean;
  /** One-shot HTML for native `defaultValue` when entering edit mode. */
  editDefaultValue?: string;
};

/**
 * Panel toggle states — only change when user explicitly opens / closes a
 * sheet or toolbar. Split out so emoji/format/attach consumers never
 * re-render on typing or send.
 */
export type ChatInputPanelState = {
  isEmojiPickerOpen: boolean;
  isAttachSheetOpen: boolean;
  isFormattingVisible: boolean;
  isInputFocused: boolean;
  isLinkModalOpen: boolean;
  linkModal: ChatInputLinkModalState;
};

/** Mutable composer state — attachments and send-option flags. Resets on send. */
export type ChatInputComposerState = {
  alsoSendToChannel: boolean;
  attachments: ComposerAttachment[];
};

/** Isolated context for high-frequency rich-text state (cursor movement, formatting marks). */
export type ChatInputRichState = {
  styleState: OnChangeStateEvent | null;
  selection: ChatInputSelection | null;
};

/** Isolated context for mention query state — changes on every mention keystroke. */
export type ChatInputMentionState = {
  isMentionOpen: boolean;
  mentionMode: ChatInputMentionMode;
  mentionQuery: string;
};

/** Send-button UI only — no plain text (kept in a ref to avoid Input re-renders while typing). */
export type ChatInputText = {
  hasComposerContent: boolean;
  /** True when the payload is sendable: content is present and nothing is loading. */
  canSend: boolean;
};

export type ChatInputActions = {
  setIsFormattingVisibleState: (visible: boolean) => void;
  setIsEmojiPickerOpenState: (open: boolean) => void;
  setIsMentionOpenState: (visible: boolean) => void;
  setMentionModeState: (mode: ChatInputMentionMode) => void;
  setMentionQueryState: (query: string) => void;
  setIsAttachSheetOpenState: (open: boolean) => void;
  setAlsoSendToChannelState: (enabled: boolean) => void;
  setAttachments: (attachments: SetStateAction<ComposerAttachment[]>) => void;
  openLinkModal: (selection: ChatInputSelection | null) => void;
  closeLinkModal: () => void;
  setLinkModalText: (text: string) => void;
  setLinkModalUrl: (url: string) => void;
  beginAttachmentMutation: () => void;
  endAttachmentMutation: () => void;
};

export type TwinEditComposerSession = {
  message: string;
  placeholder?: string;
  /** Approve the Twin draft with this text. Must not `messages.send`. */
  onApprove: (editedText: string) => void | Promise<void>;
};

export type ChatInputHandlers = {
  inputRef: RefObject<EnrichedTextInputInstance | null>;
  placeholder: string;
  setInputFocused: (focused: boolean) => void;
  setTextState: (text: string) => void;
  insertEmoji: (selection: EmojiPickerSelection) => void;
  /** Snapshot the caret before the emoji sheet blurs the input. */
  rememberSelectionForEmojiInsert: () => void;
  setHtmlState: (html: string) => void;
  setStyleState: (styleState: OnChangeStateEvent | null) => void;
  setSelection: (selection: ChatInputSelection | null) => void;
  /** Apply pending cursor-at-end once native `onChangeText` has content. */
  notifyComposerNativeTextChange: (nativeText: string) => void;
  /** Abandon a pending cursor-at-end when the user moves their own caret. */
  notifyUserSelectionChange: (start: number, end: number) => void;
  flushDraftPersist: () => void;
  send: () => Promise<void>;
  /** Open the schedule sheet (send long-press). No-op while editing / empty / offline. */
  openSchedule: () => void;
  registerOpenSchedule: (handler: (() => void) | null) => void;
  /** Snapshot + clear composer, then create a delayed message. Restores on failure. */
  confirmSchedule: (scheduledFor: number) => Promise<void>;
  registerSendOverride: (handler: ChatInputSendHandler | null) => void;
  beginTwinEdit: (session: TwinEditComposerSession) => boolean;
  endTwinEdit: () => void;
  onCancelEdit?: () => void;
};

export type ChatInputRootProps = {
  conversationId: string;
  threadId?: string;
  onSend: ChatInputSendHandler;
  children: ReactNode;
  placeholder?: string;
  suppressDraftSync?: boolean;
  editingMessage?: ChatInputEditingMessage | null;
  onCancelEdit?: () => void;
  attachments?: ComposerAttachment[];
};

export type ChatInputActionProps = {
  className?: string;
  onPress?: () => void;
};
