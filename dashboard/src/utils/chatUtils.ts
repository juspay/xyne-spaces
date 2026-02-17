/**
 * Chat utility functions for processing messages and conversations
 */

import { isSameDay, formatDatePill } from './dateUtils';
import type { CombinedMessageItem } from '../components/Chat/ChatList/ChatListUtils';
import type { QueryResultType } from '@rocicorp/zero';
import type { queries } from '../zero/queries';
import type { Message } from '@xyne/shared';
import { MessageType } from '@xyne/shared';

/**
 * Type for date separator items
 */
export interface DateSeparator {
  type: 'date-separator';
  id: string;
  dateText: string;
  date: Date;
}

/**
 * Union type for chat list items with date separators
 */
export type ChatListItemWithSeparator = CombinedMessageItem | DateSeparator;

/**
 * Type for thread message items
 */
export interface ThreadMessageItem {
  type: 'message';
  data: QueryResultType<typeof queries.conversationMessages>[number];
  createdAt: Date;
}

/**
 * Union type for thread list items with date separators
 */
export type ThreadListItemWithSeparator = ThreadMessageItem | DateSeparator;

/**
 * Insert date separators between combined message items (conversations + thread messages)
 * Specialized function for CombinedMessageItem arrays
 *
 * @param combinedMessages - Array of combined message items
 * @returns Array with date separators inserted
 */
export const insertDateSeparatorsForCombinedMessages = (
  combinedMessages: CombinedMessageItem[] | undefined,
): ChatListItemWithSeparator[] => {
  if (!combinedMessages || combinedMessages.length === 0) {
    return [];
  }

  const result: ChatListItemWithSeparator[] = [];
  // let lastDate: Date | null = null;

  for (const item of combinedMessages) {
    // Extract creation date from the item
    // const currentDate = item.createdAt;

    // Insert date separator if this is a new day
    // if (!lastDate || !isSameDay(lastDate, currentDate)) {
    //   const dateText = formatDatePill(currentDate);
    //   result.push({
    //     type: 'date-separator',
    //     id: `date-${currentDate.toISOString()}`,
    //     dateText,
    //     date: currentDate,
    //   });
    //   lastDate = currentDate;
    // }

    // Add the original item
    result.push(item);
  }

  return result;
};

/**
 * Insert date separators between thread messages
 * Used for ticket threads to show date pills like in ChatList
 * Note: Skips the date pill for the first message (conversation creation date)
 *
 * @param messages - Array of thread messages
 * @returns Array with date separators inserted
 */
export const insertDateSeparatorsForThreadMessages = (
  messages: QueryResultType<typeof queries.conversationMessages> | undefined,
): ThreadListItemWithSeparator[] => {
  if (!messages || messages.length === 0) {
    return [];
  }

  const result: ThreadListItemWithSeparator[] = [];
  let lastDate: Date | null = null;
  let isFirstMessage = true;

  for (const message of messages) {
    const currentDate = new Date(message.createdAt);

    // Insert date separator if this is a new day
    // Skip for the first message (conversation creation date)
    if (!isFirstMessage && (!lastDate || !isSameDay(lastDate, currentDate))) {
      const dateText = formatDatePill(currentDate);
      result.push({
        type: 'date-separator',
        id: `date-${currentDate.toISOString()}`,
        dateText,
        date: currentDate,
      });
    }

    lastDate = currentDate;
    isFirstMessage = false;

    // Add the message as a wrapped item
    result.push({
      type: 'message',
      data: message,
      createdAt: currentDate,
    });
  }

  return result;
};

/**
 * Check if a message is editable by the given user
 */
export const isMessageEditable = (message: Message | undefined | null, userId: string): boolean => {
  if (!message) return false;
  if (message.senderId !== userId) return false;
  if (message.msgType === MessageType.SYSTEM) return false;
  if (message.isDeleted) return false;
  return true;
};

/**
 * Find the last editable message in a list of messages or conversations
 */
export const findLastEditableMessage = <T>(
  items: T[],
  userId: string | undefined,
  getMessage: (item: T) => Message | undefined | null,
): { item: T; index: number } | null => {
  if (!userId) return null;

  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) continue;
    const message = getMessage(item);
    if (isMessageEditable(message, userId)) {
      return { item, index: i };
    }
  }

  return null;
};

/**
 * Check if a keyboard event originated from a specific input element
 */
export const isEventFromInput = (event: KeyboardEvent, inputId: string): boolean => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest(`[data-input-id="${inputId}"]`));
};

/**
 * Check if a message has meaningful text content
 * Returns false for empty strings, whitespace-only strings, or strings with only empty HTML tags
 */
export const hasMessageContent = (content: string | undefined | null): boolean => {
  if (!content) return false;
  const trimmed = content.trim();
  if (trimmed === '') return false;
  // Check if content contains custom emoji images (data-emoji="true")
  const hasCustomEmojis = /<img[^>]*data-emoji="true"[^>]*>/i.test(trimmed);
  if (hasCustomEmojis) return true;
  // Check if content is just empty HTML tags
  const textOnly = trimmed.replace(/<[^>]*>/g, '').trim();
  return textOnly !== '';
};
