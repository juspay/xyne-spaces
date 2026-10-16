import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeRelatedDraft } from '@xyne/shared';
import { searchService } from '../services/searchService';
import { globalClickTracker } from '../services/Analytics/globalClickTracker';
import { MIN_RELATED_CONTEXT_DEBOUNCE_MS } from './useRelatedContext';

const MIN_WORDS = 12;
const MAX_IGNORED = 3;
const QUIET_AFTER_IGNORES_MS = 7 * 24 * 60 * 60 * 1000;
const BACKOFF_MS = 60_000;
const STORAGE_KEY = 'xyne_discussion_title_offer';

interface IgnoreRecord {
  ignored: number;
  quietUntil: number;
}

const NO_IGNORES: IgnoreRecord = { ignored: 0, quietUntil: 0 };

const readIgnores = (userId: string): IgnoreRecord => {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`${STORAGE_KEY}:${userId}`) ?? 'null',
    ) as Partial<IgnoreRecord> | null;
    return typeof saved?.ignored === 'number' && typeof saved.quietUntil === 'number'
      ? { ignored: saved.ignored, quietUntil: saved.quietUntil }
      : NO_IGNORES;
  } catch {
    return NO_IGNORES;
  }
};

const writeIgnores = (userId: string, record: IgnoreRecord): void => {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${userId}`, JSON.stringify(record));
  } catch {
    return;
  }
};

const isWorthChecking = (text: string): boolean =>
  /\n\s*\S/.test(text.trim()) ||
  text
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/\s+/)
    .filter(word => /\p{L}{2,}/u.test(word) && !word.startsWith('@')).length >= MIN_WORDS;

export interface DiscussionTitleOffer {
  offered: boolean;
  onDraftChange: (text: string) => void;
  interrupt: () => void;
  withdraw: () => void;
  noteSent: (titled: boolean) => void;
}

export function useDiscussionTitleOffer({
  enabled,
  draftKey,
  userId,
}: {
  enabled: boolean;
  draftKey: string;
  userId: string | undefined;
}): DiscussionTitleOffer {
  const [offeredKey, setOfferedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef<AbortController | null>(null);
  const latestText = useRef('');
  const offeredFor = useRef<string | null>(null);
  const shownKey = useRef<string | null>(null);
  const score = useRef<number | undefined>(undefined);
  const quietUntil = useRef(0);
  const isEnabled = useRef(enabled);
  isEnabled.current = enabled;
  const key = useRef(draftKey);
  key.current = draftKey;
  const user = useRef(userId);
  user.current = userId;

  const cancel = useCallback((): void => {
    clearTimeout(timer.current);
    timer.current = undefined;
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const show = useCallback((on: boolean): void => {
    shownKey.current = on ? key.current : null;
    setOfferedKey(shownKey.current);
  }, []);

  const check = useCallback(async (): Promise<void> => {
    const text = latestText.current;
    if (!isEnabled.current) return;
    if (!isWorthChecking(text)) {
      if (shownKey.current === key.current) show(false);
      return;
    }
    const now = Date.now();
    if (now < quietUntil.current) return;
    if (user.current && readIgnores(user.current).quietUntil > now) return;

    const controller = new AbortController();
    inFlight.current = controller;
    const draftKey = key.current;
    try {
      const verdict = await searchService.getDiscussionTitleVerdict(
        normalizeRelatedDraft(text),
        controller.signal,
      );
      if (controller.signal.aborted || !isEnabled.current || draftKey !== key.current) return;
      if (!verdict) {
        quietUntil.current = Date.now() + BACKOFF_MS;
        return;
      }
      if (verdict.score !== undefined) score.current = verdict.score;
      if (shownKey.current === draftKey) {
        if (!verdict.hold) show(false);
      } else if (verdict.offer && offeredFor.current !== draftKey) {
        offeredFor.current = draftKey;
        show(true);
        globalClickTracker.trackManualEvent('CHAT_INPUT', 'DISCUSSION_TITLE_OFFERED');
      }
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 429
      ) {
        quietUntil.current = Date.now() + BACKOFF_MS;
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [show]);

  const interrupt = useCallback((): void => {
    cancel();
    if (!isEnabled.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void check();
    }, MIN_RELATED_CONTEXT_DEBOUNCE_MS);
  }, [cancel, check]);

  const reset = useCallback((): void => {
    cancel();
    show(false);
    offeredFor.current = null;
    score.current = undefined;
  }, [cancel, show]);

  const onDraftChange = useCallback(
    (text: string): void => {
      latestText.current = text;
      if (!text.trim()) reset();
    },
    [reset],
  );

  const withdraw = useCallback((): void => {
    cancel();
    show(false);
  }, [cancel, show]);

  const noteSent = useCallback(
    (titled: boolean): void => {
      const wasOffered = offeredFor.current === key.current;
      if (score.current !== undefined) {
        globalClickTracker.trackManualEvent('CHAT_INPUT', 'DISCUSSION_TITLE_SENT', undefined, {
          titled,
          offered: wasOffered,
          score: score.current,
        });
      }
      const userId = user.current;
      if (userId && (titled || wasOffered)) {
        const { ignored, quietUntil } = readIgnores(userId);
        if (titled && ignored > 0) {
          writeIgnores(userId, NO_IGNORES);
        } else if (!titled) {
          writeIgnores(
            userId,
            ignored + 1 >= MAX_IGNORED
              ? { ignored: 0, quietUntil: Date.now() + QUIET_AFTER_IGNORES_MS }
              : { ignored: ignored + 1, quietUntil },
          );
        }
      }
      reset();
    },
    [reset],
  );

  return {
    offered: enabled && offeredKey === draftKey,
    onDraftChange,
    interrupt,
    withdraw,
    noteSent,
  };
}
