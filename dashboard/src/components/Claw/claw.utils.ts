import type { Message, PendingActionResolution } from '../Chat/XyneAISidebar/utils/XyneAITypes';

export function isExternalHttpHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export function resolveMessagePendingAction(
  messages: Message[],
  messageId: string,
  actionIndex: number,
  resolution: PendingActionResolution,
): Message[] {
  const messageIndex = messages.findIndex(message => message.id === messageId);
  const message = messages[messageIndex];
  const action = message?.pendingActions?.[actionIndex];
  if (!message || !action || action.resolution === resolution) return messages;

  const pendingActions = [...(message.pendingActions ?? [])];
  pendingActions[actionIndex] = { ...action, resolution };
  const resolvedMessages = [...messages];
  resolvedMessages[messageIndex] = { ...message, pendingActions };
  return resolvedMessages;
}
