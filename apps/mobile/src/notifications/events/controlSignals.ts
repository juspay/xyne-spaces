import { Platform } from 'react-native';

import { CONTROL_NOTIFICATION_TYPES } from '../config';
import { presentSilentAndroidGroup, presentSilentIosBubble } from '../display/presentNotification';
import {
  formatBodyWithSender,
  parseMetadata,
  readNonEmptyString,
  resolveControlSignalTarget,
  type ControlSignalTarget,
} from '../message/messageContext';
import {
  clearMessageGroup,
  removeMessageFromGroup,
  updateMessageTextInGroup,
} from '../message/messageStore';
import type { MessageGroup, TrayData } from '../types';
import {
  cancelConversationTray,
  cancelIosBubbleByMessageId,
  isConversationTrayVisible,
} from './trayEvents';

/**
 * Silent control signals — the counterpart to the inbound display path.
 *
 * The backend fires these data-only pushes when a chat changes elsewhere:
 *   • CHANNEL_READ / THREAD_READ → user read it → dismiss the tray + clear MMKV
 *   • MESSAGE_DELETED            → drop that bubble (or dismiss the tray if last)
 *   • MESSAGE_EDITED             → rewrite that bubble's text in place
 *
 * None of them ever buzz the user: Android rewrites on the LOW-importance silent
 * channel; iOS redraws bubbles without sound. We only touch a tray we can see,
 * so a stale signal for an already-dismissed chat is a no-op.
 *
 * @returns true when the payload was a control signal (handled or knowingly
 *          skipped) so the caller stops before the display path.
 */
export async function handleControlSignal(data: Record<string, string>): Promise<boolean> {
  const type = readNonEmptyString(data['type']) ?? '';
  if (!CONTROL_NOTIFICATION_TYPES.has(type)) return false;

  const target = resolveControlSignalTarget(data, type);
  if (!target) {
    return true;
  }

  try {
    switch (type) {
      case 'CHANNEL_READ':
      case 'THREAD_READ':
        await applyRead(target);
        break;
      case 'MESSAGE_DELETED':
        await applyDelete(target);
        break;
      case 'MESSAGE_EDITED':
        await applyEdit(target, data);
        break;
    }
  } catch {
    // Control signal handling failed; treat as handled so display path is skipped.
  }
  return true;
}

// Build the flat tray payload for a silent rewrite so a later tap/reply still
// routes correctly. Mirrors the shape `buildTrayData` bakes on inbound draws.
function buildSilentTrayData(target: ControlSignalTarget, group: MessageGroup): TrayData {
  const lastMessageId = group.messages[group.messages.length - 1]?.messageId;
  return {
    _v4: 'true',
    type: target.isThread ? 'THREAD_REPLY' : 'CHANNEL_MESSAGE',
    channelId: target.channelId,
    conversationId: target.conversationId ?? '',
    threadId: target.isThread ? (target.conversationId ?? '') : '',
    isThreadReply: target.isThread ? 'true' : '',
    messageId: lastMessageId ?? target.messageId ?? '',
    notificationId: target.serverNotificationId ?? '',
    scopeType: target.scopeType ?? group.scopeType ?? '',
  };
}

// READ — user already saw the chat elsewhere. Clear locally + dismiss the tray.
async function applyRead(target: ControlSignalTarget): Promise<void> {
  clearMessageGroup(target.storeKey);
  await cancelConversationTray(target.notificationId, target.storeKey);
}

// DELETED — drop one bubble. Tray gone if it was the last; otherwise rewrite.
async function applyDelete(target: ControlSignalTarget): Promise<void> {
  if (!target.messageId) return;

  // Chat MMKV alignment used to live here — the shared threadConversations /
  // channelConversations caches now receive the delete through Zero directly,
  // and there is no parallel notification-side cache to keep in sync.

  // iOS bubbles are independent notifications — cancel the matching one directly,
  // even when it was delivered by APNS while the JS group was never populated.
  if (Platform.OS === 'ios') {
    await cancelIosBubbleByMessageId(target.notificationId, target.storeKey, target.messageId);
    const updated = removeMessageFromGroup(target.storeKey, target.messageId);
    if (updated && updated.messages.length === 0) clearMessageGroup(target.storeKey);
    return;
  }

  const updated = removeMessageFromGroup(target.storeKey, target.messageId);
  if (!updated) return; // message wasn't in our group → nothing to redraw

  if (updated.messages.length === 0) {
    await cancelConversationTray(target.notificationId, target.storeKey);
    return;
  }

  // The user may have already swiped the banner away — don't resurrect a tray.
  if (!(await isConversationTrayVisible(target.notificationId, target.storeKey))) {
    clearMessageGroup(target.storeKey);
    return;
  }

  await presentSilentAndroidGroup({
    notificationId: target.notificationId,
    title: updated.title,
    ...(updated.scopeType ? { scopeType: updated.scopeType } : {}),
    messages: updated.messages,
    trayData: buildSilentTrayData(target, updated),
  });
}

// EDITED — rewrite one bubble's text in place.
async function applyEdit(target: ControlSignalTarget, data: Record<string, string>): Promise<void> {
  if (!target.messageId) return;

  const metadata = parseMetadata(data);
  const newContent = readNonEmptyString(metadata['content']) ?? readNonEmptyString(data['content']);
  if (!newContent) return;

  // Same as applyDelete: Zero owns the authoritative edit path, no parallel
  // MMKV blob to update here.

  const updated = updateMessageTextInGroup(target.storeKey, target.messageId, newContent);
  if (!updated) return; // not in our group → nothing to rewrite

  const trayData = buildSilentTrayData(target, updated);

  if (Platform.OS === 'ios') {
    const bubble = updated.messages.find(m => m.messageId === target.messageId);
    if (!bubble) return;
    await cancelIosBubbleByMessageId(target.notificationId, target.storeKey, target.messageId);
    await presentSilentIosBubble({
      notificationId: target.notificationId,
      bubbleId: target.messageId,
      title: updated.title || bubble.person.name,
      body: formatBodyWithSender(newContent, updated.scopeType, bubble.person.name),
      ...(updated.scopeType ? { scopeType: updated.scopeType } : {}),
      senderName: bubble.person.name,
      ...(bubble.person.icon ? { senderPicture: bubble.person.icon } : {}),
      trayData,
    });
    return;
  }

  // Don't redraw a banner the user already dismissed.
  if (!(await isConversationTrayVisible(target.notificationId, target.storeKey))) {
    clearMessageGroup(target.storeKey);
    return;
  }

  await presentSilentAndroidGroup({
    notificationId: target.notificationId,
    title: updated.title,
    ...(updated.scopeType ? { scopeType: updated.scopeType } : {}),
    messages: updated.messages,
    trayData,
  });
}
