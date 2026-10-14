import type { ChatRowKind, MessageRowModel } from './chatRow.types';
import type { ChannelKind } from './conversationInput';
import { dayKey } from './dayKey';
import { paintsAsSystemFlow, paintsAsSystemJoin } from './rowType';

const paintsAsCenteredSystem = (row: MessageRowModel): boolean =>
  paintsAsSystemJoin(row) || paintsAsSystemFlow(row);

const shouldShowIdentity = (
  row: MessageRowModel,
  channelKind: ChannelKind,
  previous: MessageRowModel | null,
): boolean => {
  if (
    channelKind === 'dm' ||
    row.rowKind === 'CURRENT_USER' ||
    row.callPreview ||
    paintsAsCenteredSystem(row)
  ) {
    return false;
  }
  if (row.rowKind === 'BOT' || row.rowKind === 'SYSTEM') {
    return true;
  }
  const sameSender =
    previous &&
    previous.sender.senderId === row.sender.senderId &&
    previous.rowKind === row.rowKind &&
    dayKey(previous.createdAt) === dayKey(row.createdAt);
  return !sameSender;
};

/** Look-backward: sender name on the first message of a consecutive group. */
export const applySenderNames = (
  rows: MessageRowModel[],
  channelKind: ChannelKind,
): MessageRowModel[] => {
  let previous: MessageRowModel | null = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;
    const showIdentity = shouldShowIdentity(row, channelKind, previous);
    const showSenderName = row.rowKind === 'TICKET' || !!row.ticketPreview ? false : showIdentity;
    if (row.showSenderName !== showSenderName) {
      rows[index] = { ...row, showSenderName };
    }
    if (!paintsAsCenteredSystem(row) && !row.callPreview) {
      previous = rows[index] ?? row;
    }
  }
  return rows;
};

/**
 * Look-ahead: avatar on the last message of a group (`items-end` bubbles).
 * Replaces a row object only when `showAvatar` changes (reference equality).
 */
export const applyTrailingGroupAvatars = (
  rows: MessageRowModel[],
  channelKind: ChannelKind,
): MessageRowModel[] => {
  if (channelKind === 'dm') {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row?.showAvatar) rows[index] = { ...row, showAvatar: false };
    }
    return rows;
  }

  let nextMessage: MessageRowModel | null = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) continue;
    if (paintsAsCenteredSystem(row)) {
      if (row.showAvatar) rows[index] = { ...row, showAvatar: false };
      continue;
    }

    if (row.callPreview) {
      if (row.showAvatar) rows[index] = { ...row, showAvatar: false };
      continue;
    }
    if (row.rowKind === 'CURRENT_USER') {
      if (row.showAvatar) rows[index] = { ...row, showAvatar: false };
      nextMessage = row;
      continue;
    }
    if (row.rowKind === 'BOT' || row.rowKind === 'SYSTEM') {
      if (!row.showAvatar) rows[index] = { ...row, showAvatar: true };
      nextMessage = row;
      continue;
    }
    const sameSenderAsNext =
      !!nextMessage &&
      nextMessage.sender.senderId === row.sender.senderId &&
      nextMessage.rowKind === row.rowKind &&
      dayKey(nextMessage.createdAt) === dayKey(row.createdAt);
    const showAvatar = !sameSenderAsNext;
    if (row.showAvatar !== showAvatar) {
      rows[index] = { ...row, showAvatar };
    }
    nextMessage = row;
  }
  return rows;
};

export const applyGrouping = (
  rows: MessageRowModel[],
  channelKind: ChannelKind,
): MessageRowModel[] => applyTrailingGroupAvatars(applySenderNames(rows, channelKind), channelKind);

export type { ChatRowKind };
