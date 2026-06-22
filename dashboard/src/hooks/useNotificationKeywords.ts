import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { stateMachineActor } from '../machines/stateMachine';
import { MAX_NOTIFICATION_KEYWORDS, MAX_NOTIFICATION_KEYWORD_LENGTH } from '@xyne/shared';

export type AddKeywordResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'duplicate' | 'too_long' | 'limit_reached' };

export interface NotificationKeywords {
  keywords: string[];
  addKeyword: (keyword: string) => AddKeywordResult;
  removeKeyword: (keyword: string) => void;
}

/**
 * Global keyword-notification list ("highlight words") — Preferences →
 * Notifications → Keywords. Mutations apply optimistically via Zero and roll
 * back automatically if the server mutator rejects.
 */
export const useNotificationKeywords = (): NotificationKeywords => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);

  const keywords = userPreference?.notificationKeywords ?? [];

  const save = (next: string[]): void => {
    void zero.mutate(
      mutators.userPreference.setNotificationKeywords({
        id: userPreference?.id ?? crypto.randomUUID(),
        keywords: next,
        timestamp: Date.now(),
      }),
    );
  };

  const addKeyword = (keyword: string): AddKeywordResult => {
    const normalized = keyword.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalized) return { ok: false, reason: 'empty' };
    if (normalized.length > MAX_NOTIFICATION_KEYWORD_LENGTH)
      return { ok: false, reason: 'too_long' };
    if (keywords.length >= MAX_NOTIFICATION_KEYWORDS) return { ok: false, reason: 'limit_reached' };
    if (keywords.some(k => k.toLowerCase() === normalized)) {
      return { ok: false, reason: 'duplicate' };
    }
    save([...keywords, normalized]);
    return { ok: true };
  };

  const removeKeyword = (keyword: string): void => {
    save(keywords.filter(k => k.toLowerCase() !== keyword.toLowerCase()));
  };

  return { keywords, addKeyword, removeKeyword };
};
