import type { ChatRow } from './chatRow.types';

/** Same-key replacements that do not change paint or layout. */
export const rowsAreEqual = (previous: ChatRow, next: ChatRow): boolean => {
  if (previous.type !== next.type || previous.id !== next.id) {
    return false;
  }
  if (previous.type === 'message' && next.type === 'message') {
    return (
      previous.model.contentSignature === next.model.contentSignature &&
      previous.model.showAvatar === next.model.showAvatar &&
      previous.model.showSenderName === next.model.showSenderName &&
      previous.model.isExpanded === next.model.isExpanded &&
      previous.model.isHighlighted === next.model.isHighlighted &&
      previous.model.isEntering === next.model.isEntering &&
      previous.model.reminderLabel === next.model.reminderLabel &&
      previous.model.threadReplyCount === next.model.threadReplyCount
    );
  }
  if (previous.type === 'date' && next.type === 'date') {
    return previous.date === next.date;
  }
  if (previous.type === 'unread-divider' && next.type === 'unread-divider') {
    return true;
  }
  return true;
};
