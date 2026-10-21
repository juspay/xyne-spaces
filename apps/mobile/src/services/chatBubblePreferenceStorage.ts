import { lotusStorage } from './localStorage';
import { isChatBubbleColorVar, type ChatBubbleColorVar } from '@/src/theme/chatBubbleTheme';

const KEY = 'lotus.chatTheme.bubbleColorVar';

export function readStoredChatBubblePreference(): ChatBubbleColorVar | null {
  const raw = lotusStorage.getString(KEY);
  if (isChatBubbleColorVar(raw)) {
    return raw;
  }
  if (raw !== undefined) {
    lotusStorage.remove(KEY);
  }
  return null;
}

export function writeStoredChatBubblePreference(value: ChatBubbleColorVar): void {
  lotusStorage.set(KEY, value);
}

export function clearStoredChatBubblePreference(): void {
  lotusStorage.remove(KEY);
}
