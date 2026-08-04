import { useCallback, useRef } from 'react';

/**
 * Terminal / Slack-style "recall last sent message" history for the message
 * composer.
 *
 * Each composer scope keeps its OWN history so the channel input box and a
 * thread input box never share recalled text. The scope id is the same value
 * `ChatInput` already uses to identify a composer: `conversationId ?? channelId`
 * (a channel composer has no conversationId, so it keys on channelId; a thread
 * composer keys on its conversationId).
 *
 * History survives page reloads because it is persisted to `localStorage` under
 * a per-scope key. Entries are the editor HTML strings (with mention spans
 * intact) so a recalled message re-populates the editor exactly as it was
 * typed and can be edited/re-sent.
 *
 * Navigation model (index over an oldest -> newest list):
 *   index === -1  ->  showing the user's live draft (nothing recalled)
 *   0..len-1      ->  showing a recalled entry (len-1 is the most recent send)
 * The live draft is stashed the moment recall starts and restored when the user
 * pages forward past the newest entry.
 */

const STORAGE_PREFIX = 'xyne:msg-history:';
const MAX_ENTRIES = 50;

function storageKey(scopeId: string): string {
  return `${STORAGE_PREFIX}${scopeId}`;
}

function loadList(scopeId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(scopeId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    // Corrupt JSON / storage disabled / private mode — treat as empty history.
    return [];
  }
}

function saveList(scopeId: string, list: string[]): void {
  try {
    localStorage.setItem(storageKey(scopeId), JSON.stringify(list));
  } catch {
    // Quota exceeded or storage disabled — recall is a convenience, so failing
    // to persist must never break sending. Swallow.
  }
}

export interface SentMessageHistory {
  /** Record a freshly sent message (editor HTML). Resets the recall cursor. */
  push: (html: string) => void;
  /**
   * Move to the previous (older) entry. Returns the HTML to load, or `null` when
   * there is nothing older (or no history at all) — in which case the caller
   * should leave the editor untouched. `currentHtml` is stashed as the live
   * draft the first time recall starts.
   */
  recallPrev: (currentHtml: string) => string | null;
  /**
   * Move to the next (newer) entry, or back to the stashed live draft once past
   * the newest entry. Returns the HTML to load (which may be an empty string =
   * restore an empty draft), or `null` when already on the live draft.
   */
  recallNext: (currentHtml: string) => string | null;
  /** Abandon recall navigation (call when the user edits the text). */
  resetCursor: () => void;
}

export function useSentMessageHistory(scopeId: string): SentMessageHistory {
  // -1 means "showing the live draft"; >=0 indexes into the persisted list.
  const indexRef = useRef(-1);
  const stashRef = useRef<string>('');
  const lastScopeRef = useRef(scopeId);

  // Switching composer scope (e.g. opening a different thread) abandons any
  // in-progress recall so the new composer starts on its own live draft.
  if (lastScopeRef.current !== scopeId) {
    lastScopeRef.current = scopeId;
    indexRef.current = -1;
    stashRef.current = '';
  }

  const push = useCallback(
    (html: string): void => {
      if (!html || html.trim().length === 0) {
        indexRef.current = -1;
        stashRef.current = '';
        return;
      }
      const list = loadList(scopeId);
      // Skip consecutive duplicates so spamming the same message doesn't bloat
      // the recall list.
      if (list[list.length - 1] !== html) {
        list.push(html);
        while (list.length > MAX_ENTRIES) list.shift();
        saveList(scopeId, list);
      }
      indexRef.current = -1;
      stashRef.current = '';
    },
    [scopeId],
  );

  const recallPrev = useCallback(
    (currentHtml: string): string | null => {
      const list = loadList(scopeId);
      if (list.length === 0) return null;

      if (indexRef.current === -1) {
        // Entering recall from the live draft — stash it so ArrowDown can bring
        // it back, then jump to the most recent sent message.
        stashRef.current = currentHtml;
        indexRef.current = list.length - 1;
        return list[indexRef.current] ?? null;
      }
      if (indexRef.current > 0) {
        indexRef.current -= 1;
        return list[indexRef.current] ?? null;
      }
      // Already at the oldest entry — nothing older to show.
      return null;
    },
    [scopeId],
  );

  const recallNext = useCallback(
    (_currentHtml: string): string | null => {
      const list = loadList(scopeId);
      if (indexRef.current === -1) return null; // already on the live draft

      if (indexRef.current < list.length - 1) {
        indexRef.current += 1;
        return list[indexRef.current] ?? null;
      }
      // Past the newest entry — restore the stashed live draft (may be empty).
      indexRef.current = -1;
      const draft = stashRef.current;
      stashRef.current = '';
      return draft;
    },
    [scopeId],
  );

  const resetCursor = useCallback((): void => {
    indexRef.current = -1;
    stashRef.current = '';
  }, []);

  return { push, recallPrev, recallNext, resetCursor };
}
