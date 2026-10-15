import { MessageType, type User } from '@xyne/shared';

import type { MessageItem } from '../message-composer.types';

export type MessageKind = 'CURRENT_USER' | 'OTHER_USER' | 'BOT' | 'SYSTEM' | 'DELETED';

export const getMessageKind = (item: MessageItem, currentUser: User | undefined): MessageKind => {
  if (item.isDeleted) return 'DELETED';
  if (item.msgType === MessageType.BOT) return 'BOT';
  if (item.msgType === MessageType.SYSTEM) return 'SYSTEM';
  if (item.senderId && currentUser?.id && item.senderId === currentUser.id) {
    return 'CURRENT_USER';
  }
  return 'OTHER_USER';
};

export const isSameDay = (a: number, b: number): boolean => {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
};

export const isContinuationOf = (
  current: MessageItem,
  previous: MessageItem | undefined,
): boolean => {
  if (!previous) return false;
  if (current.senderId !== previous.senderId) return false;
  if (current.msgType !== previous.msgType) return false;
  return isSameDay(previous.createdAt, current.createdAt);
};
