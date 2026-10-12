import { ChannelScopeType } from '@xyne/shared';
import type { TwinEditSession } from '../TwinReplyDraft/twinReplyDraftApi';

/**
 * What the composer is writing. Each variant component fixes one of these, so the
 * provider never has to guess the mode from which props happen to be set.
 *
 * - `compose`: a new message. Top level in a channel, or a reply when the
 *   composer has a conversation. A thread composer may hand the box to a digital
 *   twin's draft for a while (`twinEdit`).
 * - `edit`: rewriting a message that was already sent.
 */
export type ChatComposerMode =
  | { kind: 'compose'; twinEdit?: TwinEditSession | undefined }
  | {
      kind: 'edit';
      messageId: string;
      initialContent: string;
      /** A forwarded message: only its optional text is editable. */
      isForwardedContent: boolean;
      onEditComplete?: (() => void) | undefined;
      onCancel?: (() => void) | undefined;
    };

export interface ComposerCapabilityInput {
  isEditing: boolean;
  isTwinEditing: boolean;
  conversationId: string | undefined;
  /** Conversations here are shown as a discussion list. */
  hasDiscussionList: boolean;
  onMobilePlatform: boolean;
  /** `window.innerWidth < 500`, read at render. */
  isNarrowViewport: boolean;
  relatedPreferenceOn: boolean;
  relatedAvailable: boolean;
  activeArtifactCommand: string | null;
  channelScopeType: ChannelScopeType | undefined;
  isSdlcChannel: boolean;
  isDM: boolean;
  canCreateTicket: boolean;
  channelHasBoards: boolean;
  allowThreadBroadcastMentions: boolean;
  hasCancelHandler: boolean;
}

/** Everything the composer may offer, decided in one place from its mode and channel. */
export interface ChatComposerCapabilities {
  /** Keystrokes are saved as the channel's (or thread's) draft. */
  savesDraft: boolean;
  /** A new discussion starts with a title, sent as its opening message's first line. */
  startsDiscussion: boolean;
  /** Related threads, tickets, canvases and calls are looked up as the draft changes. */
  relatedContext: boolean;
  fileAttachments: boolean;
  /** A thread reply can also be posted to the channel. */
  alsoSendToChannel: boolean;
  createTicket: boolean;
  schedulePresets: boolean;
  /** The box shows a cancel button that leaves edit mode. */
  cancelEdit: boolean;
  /** @channel / @here are refused in this reply. */
  threadBroadcastBlocked: boolean;
}

export function deriveComposerCapabilities(
  input: ComposerCapabilityInput,
): ChatComposerCapabilities {
  const {
    isEditing,
    isTwinEditing,
    conversationId,
    hasDiscussionList,
    onMobilePlatform,
    isNarrowViewport,
    relatedPreferenceOn,
    relatedAvailable,
    activeArtifactCommand,
    channelScopeType,
    isSdlcChannel,
    isDM,
    canCreateTicket,
    channelHasBoards,
    allowThreadBroadcastMentions,
    hasCancelHandler,
  } = input;
  const isThread = !!conversationId;
  return {
    savesDraft: !isEditing && !isTwinEditing,
    // Not on a phone: the editor keeps its header, where the title field sits, off
    // mobile, so a title there could never be given. Replies, edits and twin drafts
    // are messages as ever.
    startsDiscussion:
      hasDiscussionList && !onMobilePlatform && !isEditing && !isThread && !isTwinEditing,
    // Opt-in per device, for new messages only — not edits, twin replies or a
    // slash-command artifact being declared.
    relatedContext:
      relatedPreferenceOn &&
      relatedAvailable &&
      !isEditing &&
      !isTwinEditing &&
      !isNarrowViewport &&
      !activeArtifactCommand,
    fileAttachments: !isEditing,
    // SDLC channels are hidden from the chat directory, so "also send to channel"
    // has no destination a user could ever see.
    alsoSendToChannel: isThread && !isEditing && !isSdlcChannel,
    // No linked boards means nowhere to put a ticket, so don't offer it.
    createTicket:
      channelScopeType === ChannelScopeType.DEFAULT &&
      canCreateTicket &&
      channelHasBoards &&
      !isThread,
    schedulePresets: isDM && !isThread,
    cancelEdit: isEditing && hasCancelHandler,
    threadBroadcastBlocked: isThread && !isEditing && !isDM && !allowThreadBroadcastMentions,
  };
}
