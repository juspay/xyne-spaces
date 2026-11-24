import type { Zero } from '@rocicorp/zero';
import { BookmarkEntityType, isForwardedMessageXml, parseForwardedMessageXml } from '@xyne/shared';

import type { ChatInputEditingMessage } from '@/src/components/input-composer/input-composer.types';
import { composerHtmlToPlainText } from '@/src/components/input-composer/utils/conversation-input.utils';
import { mutators } from '@/src/zero/mutators';
import type { MessageRowModel } from '../model/chatRow.types';
import { channelHtmlToPlainText } from '../model/messageCopy';
import type { MessageActionId } from './actionVisibility';

export type ActionTarget = {
  messageId: string | null;
  conversationId: string;
  channelId: string;
  html: string;
  isForwarded: boolean;
  isBookmarked: boolean;
  threadId?: string;
};

export const actionTargetForModel = (
  model: MessageRowModel,
  html: string,
  threadId?: string,
): ActionTarget => ({
  messageId: model.messageId,
  conversationId: model.conversationId,
  channelId: model.channelId,
  html,
  isForwarded: model.messageType === 'FORWARDED' || isForwardedMessageXml(html),
  isBookmarked: model.isBookmarked,
  ...(threadId ? { threadId } : {}),
});

export type OnActionDeps = {
  zero: Zero;
  createId: () => string;
  now: () => number;
  retryPending: () => void;
  deletePending: () => void;
  pushThread: (channelId: string, conversationId: string) => void;
  copyText: (plain: string, html: string) => void;
  copyLink: () => void;
  copyImage: () => void;
  startCall: (channelId: string) => void;
  confirmDelete: (onConfirm: () => void) => void;
  fail: (title: string, message: string) => void;
  onEditInChat?: (payload: ChatInputEditingMessage) => void;
  onForward?: () => void;
  onRemind?: () => void;
  onBeforeMarkUnread?: () => void;
  onMarkUnreadFailure?: () => void;
};

const catchMutate = (result: unknown, onFail: () => void): void => {
  if (result && typeof result === 'object' && 'client' in result) {
    const client = (result as { client?: Promise<unknown> }).client;
    if (client && typeof client.catch === 'function') {
      void client.catch(onFail);
    }
    return;
  }
  if (result && typeof (result as Promise<unknown>).catch === 'function') {
    void (result as Promise<unknown>).catch(onFail);
  }
};

const runMutate = (run: () => unknown, onFail: () => void): void => {
  try {
    catchMutate(run(), onFail);
  } catch {
    onFail();
  }
};

export const onAction = (
  deps: OnActionDeps,
  id: MessageActionId,
  target: ActionTarget,
  isThread: boolean,
): void => {
  const messageId = target.messageId;
  if (id === 'pending-retry') {
    deps.retryPending();
    return;
  }
  if (id === 'pending-delete') {
    deps.deletePending();
    return;
  }
  if (id === 'reply-in-thread') {
    deps.pushThread(target.channelId, target.conversationId);
    return;
  }
  if (id === 'send-to-channel' && messageId) {
    runMutate(
      () =>
        deps.zero.mutate(
          mutators.messages.updateShowInChannel({
            messageId,
            showInChannel: true,
            childConversationId: deps.createId(),
            timestamp: deps.now(),
          }),
        ),
      () => deps.fail('Failed to send to channel', 'Please try again.'),
    );
    return;
  }
  if (id === 'edit-in-chat' && messageId) {
    const forwarded = parseForwardedMessageXml(target.html);
    deps.onEditInChat?.({
      messageId,
      conversationId: target.conversationId,
      channelId: target.channelId,
      content:
        target.isForwarded || forwarded !== null ? (forwarded?.optionalText ?? '') : target.html,
    });
    return;
  }
  if (id === 'copy-message') {
    const html = parseForwardedMessageXml(target.html)?.content ?? target.html;
    const plain = (isThread ? composerHtmlToPlainText(html) : channelHtmlToPlainText(html)).trim();
    if (plain) {
      deps.copyText(plain, html);
    }
    return;
  }
  if (id === 'copy-link') {
    deps.copyLink();
    return;
  }
  if (id === 'forward-message') {
    deps.onForward?.();
    return;
  }
  if (id === 'copy-image') {
    deps.copyImage();
    return;
  }
  if (id === 'pin') {
    void deps.zero.mutate(
      mutators.conversations.togglePin({ conversationId: target.conversationId }),
    );
    return;
  }
  if (id === 'bookmark' && messageId) {
    if (target.isBookmarked) {
      void deps.zero.mutate(
        mutators.bookmark.remove({
          entityId: messageId,
          entityType: BookmarkEntityType.MESSAGE,
          timestamp: deps.now(),
        }),
      );
    } else {
      void deps.zero.mutate(
        mutators.bookmark.add({
          entityId: messageId,
          entityType: BookmarkEntityType.MESSAGE,
          bookmarkId: deps.createId(),
          timestamp: deps.now(),
        }),
      );
    }
    return;
  }
  if (id === 'remind-me') {
    deps.onRemind?.();
    return;
  }
  if (id === 'start-call') {
    deps.startCall(target.channelId);
    return;
  }
  if (id === 'mark-as-unread' && messageId) {
    deps.onBeforeMarkUnread?.();
    runMutate(
      () =>
        deps.zero.mutate(
          mutators.channel.markChannelUnreadFrom({
            channelId: target.channelId,
            messageId,
            conversationId: isThread
              ? (target.threadId ?? target.conversationId)
              : target.conversationId,
            timestamp: deps.now(),
          }),
        ),
      () => {
        deps.onMarkUnreadFailure?.();
        deps.fail('Error', 'Could not mark as unread');
      },
    );
    return;
  }
  if (id === 'delete' && messageId) {
    deps.confirmDelete((): void => {
      runMutate(
        () => deps.zero.mutate(mutators.messages.delete({ messageId })),
        () => deps.fail('Failed to delete message', 'Please try again.'),
      );
    });
  }
};
