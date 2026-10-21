/**
 * Design §9 — twelve-action × flag matrix as a pure function.
 * Pending rows replace the sheet (v2 `use-message-actions`).
 */

import type { MessageRowModel } from '../model/chatRow.types';
import { attachmentMediaKindFor } from '../model/attachmentKind';
import { channelHtmlHasTextContent, composerHtmlHasSendableBody } from '../model/messageCopy';

export const QUICK_REACTIONS = ['👍', '😂', '✅', '🙌', '🎉', '❤️'] as const;

export type MessageActionId =
  | 'pending-retry'
  | 'pending-delete'
  | 'reply-in-thread'
  | 'send-to-channel'
  | 'edit-in-chat'
  | 'copy-message'
  | 'copy-link'
  | 'forward-message'
  | 'copy-image'
  | 'pin'
  | 'bookmark'
  | 'remind-me'
  | 'start-call'
  | 'mark-as-unread'
  | 'delete';

/** Sheet order matches v2 `use-message-actions`. */
export const ACTION_ORDER: readonly MessageActionId[] = [
  'pending-retry',
  'pending-delete',
  'reply-in-thread',
  'send-to-channel',
  'edit-in-chat',
  'copy-message',
  'copy-link',
  'forward-message',
  'copy-image',
  'pin',
  'bookmark',
  'remind-me',
  'start-call',
  'mark-as-unread',
  'delete',
];

export type ActionFlags = {
  isMessageDeleted: boolean;
  isSystemMessage: boolean;
  isTicketCreationMessage: boolean;
  isCallMessage: boolean;
  isShowInChannel: boolean;
  isOwnMessage: boolean;
  canEditMessage: boolean;
  hasImages: boolean;
  hasTextContent: boolean;
  isThread: boolean;
  isChannelArchived: boolean;
  isFirstInThread: boolean;
  hasTicket: boolean;
  repliesEnabled: boolean;
  hasEditHandler: boolean;
  hasReminderHandler: boolean;
  isPending: boolean;
  isFailed: boolean;
  canDeletePending: boolean;
};

export type ActionFlagContext = {
  isThread: boolean;
  isChannelArchived: boolean;
  isFirstInThread: boolean;
  hasTicket: boolean;
  repliesEnabled: boolean;
  hasEditHandler: boolean;
  hasReminderHandler: boolean;
  isPending: boolean;
  isFailed: boolean;
  canDeletePending: boolean;
};

export const actionFlagsFor = (model: MessageRowModel, ctx: ActionFlagContext): ActionFlags => {
  const isOwnMessage = model.rowKind === 'CURRENT_USER';
  const isSystemMessage =
    model.rowKind === 'SYSTEM' && !model.isTicketCreation && !model.isTicketActivity;
  return {
    isMessageDeleted: model.isDeleted,
    isSystemMessage,
    isTicketCreationMessage: model.isTicketCreation,
    isCallMessage: model.isCall,
    isShowInChannel: model.isShowInChannel,
    isOwnMessage,
    canEditMessage: isOwnMessage && model.messageType !== 'SYSTEM' && !model.isDeleted,
    hasImages:
      model.mediaPreview?.items.some(
        item => attachmentMediaKindFor(item.mimetype, item.originalFilename) === 'image',
      ) ?? false,
    hasTextContent: ctx.isThread
      ? composerHtmlHasSendableBody(model.storedHtml)
      : channelHtmlHasTextContent(model.storedHtml),
    ...ctx,
  };
};

const add = (visible: Set<MessageActionId>, id: MessageActionId, when: boolean): void => {
  if (when) {
    visible.add(id);
  }
};

/** Visible action ids for the long-press sheet. Empty set = nothing shown. */
export const actionVisibility = (flags: ActionFlags): ReadonlySet<MessageActionId> => {
  const visible = new Set<MessageActionId>();
  if (flags.isPending) {
    add(visible, 'pending-retry', flags.isFailed);
    add(visible, 'pending-delete', flags.canDeletePending);
    return visible;
  }

  const pinOrBookmark = !flags.isSystemMessage || flags.isTicketCreationMessage;
  add(
    visible,
    'reply-in-thread',
    !flags.isThread &&
      flags.repliesEnabled &&
      (!flags.isSystemMessage || flags.isTicketCreationMessage || flags.isCallMessage) &&
      !flags.isShowInChannel,
  );
  add(
    visible,
    'send-to-channel',
    flags.isThread &&
      !flags.isShowInChannel &&
      !flags.isFirstInThread &&
      flags.isOwnMessage &&
      !flags.isMessageDeleted,
  );
  add(
    visible,
    'edit-in-chat',
    flags.canEditMessage && !flags.isChannelArchived && flags.hasEditHandler,
  );
  add(visible, 'copy-message', !flags.isMessageDeleted && flags.hasTextContent);
  add(visible, 'copy-image', !flags.isMessageDeleted && flags.hasImages);
  add(visible, 'copy-link', flags.isThread ? true : !flags.isMessageDeleted);
  add(visible, 'forward-message', !flags.isMessageDeleted && !flags.isSystemMessage);
  add(visible, 'pin', pinOrBookmark && !flags.isMessageDeleted && !flags.isThread);
  add(visible, 'bookmark', pinOrBookmark && !flags.isMessageDeleted);
  add(visible, 'remind-me', !flags.isMessageDeleted && flags.hasReminderHandler);
  add(visible, 'start-call', flags.isThread && !flags.isSystemMessage && !flags.isMessageDeleted);
  add(
    visible,
    'mark-as-unread',
    !flags.isSystemMessage && !flags.isMessageDeleted && !flags.isTicketCreationMessage,
  );
  add(visible, 'delete', flags.canEditMessage && !flags.hasTicket);
  return visible;
};

export const dividerBeforeMarkAsUnread = (visible: ReadonlySet<MessageActionId>): boolean =>
  visible.has('edit-in-chat') || visible.has('delete');

export const dividerBeforeDelete = (visible: ReadonlySet<MessageActionId>): boolean =>
  !visible.has('mark-as-unread');

/** Failed → retry. Pending with chrome → sheet. Healthy in-flight → thread. */
export type RowPressIntent = 'retry' | 'actions' | 'open';

export const rowPressIntent = (isPending: boolean, status: string | null): RowPressIntent => {
  if (!isPending) {
    return 'open';
  }
  if (status === 'failed') {
    return 'retry';
  }
  if (status !== null) {
    return 'actions';
  }
  return 'open';
};
