import { StyleSheet } from 'react-native';

import type { ChatRow } from '../model/chatRow.types';

export const LIST_STYLE = StyleSheet.create({
  root: { flex: 1 },
}).root;

export const listShellClass = (kind: string): string =>
  kind === 'channel' ? 'flex-1 bg-chat-screen' : 'flex-1 rounded-t-[10px] bg-chat-screen';

export const dateFromVisibleRow = (item: ChatRow): number | null => {
  if (item.type === 'date') {
    return item.date;
  }
  if (item.type === 'message') {
    return item.model.createdAt;
  }
  return null;
};
