/**
 * Looks up what a composer draft relates to — threads, tickets, canvases and calls
 * where it is answered, was asked before, or was discussed — while the user types.
 *
 * Two inputs, so typing never re-renders the composer (state changes only when an
 * answer comes back):
 * - `interrupt`, on every edit as it happens: drops the pending lookup and the
 *   request in flight, and starts the wait again. The wait is timed from here, the
 *   keystroke, so "look up N ms after I stop typing" means exactly that.
 * - `onDraftChange`, the draft's text, which the editor reports a beat later.
 * A draft seen before in this thread is answered from memory.
 *
 * What shows is saved beside the draft in the state machine, so leaving a channel and
 * coming back to the same draft brings the chips back without a new lookup.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';

import { stateMachineActor } from '../machines/stateMachine';
import { searchService } from '../services/searchService';
import type { RelatedItem } from '../types/search';

/** The shortest wait allowed after the last keystroke, and the default. */
export const MIN_RELATED_CONTEXT_DEBOUNCE_MS = 1000;
/**
 * Only keeps one-word drafts from leaving the browser. How many words a draft needs is
 * the server's call (`minWords`, tuned in Superposition); a shorter one comes back as
 * not ready, which leaves the chips as they are.
 */
const MIN_WORDS = 2;
/** The API's limit on the draft; the server reads less than this anyway. */
const MAX_DRAFT_CHARS = 4000;
/**
 * After a "no verdict" answer — the feature is off for this user — stay quiet this
 * long rather than sending a request every pause. A lookup that merely failed comes
 * back marked as failed instead, so it never silences the next one.
 */
const NO_VERDICT_BACKOFF_MS = 60_000;
/** When rate-limited and the server doesn't say for how long. */
const RATE_LIMITED_BACKOFF_MS = 60_000;
const CACHE_SIZE = 20;

const normalize = (text: string): string => text.trim().replace(/\s+/g, ' ');

/** Keeps the same empty array, so clearing on every keystroke never re-renders. */
const cleared = (items: RelatedItem[]): RelatedItem[] => (items.length ? [] : items);

/** The server's check, less its word count: slash commands, links and mentions don't count. */
const isWorthLookingUp = (draft: string): boolean =>
  !draft.startsWith('/') &&
  draft
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/\s+/)
    .filter(word => /\p{L}{2,}/u.test(word) && !word.startsWith('@')).length >= MIN_WORDS;

/** How long a 429 asks us to wait: its Retry-After, in seconds, or a minute. */
const retryAfterMs = (value: unknown): number => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMITED_BACKOFF_MS;
};

const KINDS = new Set(['thread', 'ticket', 'canvas', 'call']);
const LABELS = new Set(['answers_it', 'same_question', 'related_discussion']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A saved item still in the shape the chips read; storage can hold an older one. */
const isRelatedItem = (value: unknown): value is RelatedItem => {
  if (!isRecord(value)) return false;
  const { id, kind, label, confidence, result } = value;
  if (!isRecord(result)) return false;
  const { id: resultId, type, title } = result;
  return (
    typeof id === 'string' &&
    typeof kind === 'string' &&
    KINDS.has(kind) &&
    typeof label === 'string' &&
    LABELS.has(label) &&
    typeof confidence === 'number' &&
    typeof resultId === 'string' &&
    typeof type === 'string' &&
    typeof title === 'string'
  );
};

/**
 * The chips saved with this draft, while there is still a draft. They are saved for
 * as long as they show, which outlasts the exact words they were found for (typing
 * on keeps them until a new answer), so they come back as they were left.
 */
const restore = (
  draftKey: string,
): { draft: string; foundFor: string; items: RelatedItem[] } | null => {
  const { drafts, relatedContext } = stateMachineActor.getSnapshot().context;
  const saved = relatedContext[draftKey];
  const draft = normalize(drafts[draftKey]?.text ?? '');
  if (!saved || !draft) return null;
  const { items } = saved;
  return items.every(isRelatedItem) ? { draft, foundFor: saved.draft, items } : null;
};

const forget = (draftKey: string): void => {
  // Checked first: this runs on keystrokes, and most drafts have nothing saved.
  if (stateMachineActor.getSnapshot().context.relatedContext[draftKey]) {
    stateMachineActor.send({ type: 'REMOVE_RELATED_CONTEXT', lookupId: draftKey });
  }
};

const remember = (draftKey: string, draft: string, items: RelatedItem[]): void => {
  if (items.length > 0) {
    stateMachineActor.send({ type: 'SAVE_RELATED_CONTEXT', lookupId: draftKey, draft, items });
  } else {
    forget(draftKey);
  }
};

export interface RelatedContextState {
  items: RelatedItem[];
  /** The draft `items` were found for — what the related-context popup quotes. */
  draft: string;
  /** A lookup is in flight. */
  loading: boolean;
  /** Feed every draft change here, as plain text. */
  onDraftChange: (text: string) => void;
  /** Call on every edit, as it happens (see above). */
  interrupt: () => void;
  /** Hides the suggestions until this draft is sent or cleared. */
  dismiss: () => void;
}

export function useRelatedContext({
  enabled,
  conversationId,
  draftKey,
  debounceMs = MIN_RELATED_CONTEXT_DEBOUNCE_MS,
}: {
  enabled: boolean;
  /** The thread being replied in, if any; the lookup leaves it out of the results. */
  conversationId: string | undefined;
  /** The draft's own key — the thread, else the channel — which the chips are saved under. */
  draftKey: string;
  /** Wait after the last keystroke before looking up. Never below the minimum. */
  debounceMs?: number;
}): RelatedContextState {
  // Restored in the first render, so coming back to a draft doesn't grow the composer.
  const [restored] = useState(() => (enabled ? restore(draftKey) : null));
  const [items, setItems] = useState<RelatedItem[]>(restored?.items ?? []);
  const [itemsDraft, setItemsDraft] = useState(restored?.foundFor ?? '');
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, RelatedItem[]>());
  const latestDraft = useRef(restored?.draft ?? '');
  const dismissed = useRef(false);
  const quietUntil = useRef(0);
  const wait = useRef(MIN_RELATED_CONTEXT_DEBOUNCE_MS);
  wait.current = Math.max(MIN_RELATED_CONTEXT_DEBOUNCE_MS, debounceMs);
  // Read through refs so the callbacks below never change: the editor keeps the
  // handlers it was created with, and a stale one must still see the current values.
  const isEnabled = useRef(enabled);
  isEnabled.current = enabled;
  const thread = useRef(conversationId);
  thread.current = conversationId;
  const key = useRef(draftKey);
  key.current = draftKey;

  const cancel = useCallback((): void => {
    clearTimeout(timer.current);
    timer.current = undefined;
    inFlight.current?.abort();
    inFlight.current = null;
    setLoading(false);
  }, []);

  // Another thread or channel is another draft: show what was saved with it, if anything.
  useEffect(() => {
    const saved = enabled ? restore(draftKey) : null;
    latestDraft.current = saved?.draft ?? '';
    dismissed.current = false;
    setItems(current => saved?.items ?? cleared(current));
    setItemsDraft(saved?.foundFor ?? '');
    return cancel;
  }, [draftKey, enabled, cancel]);

  const lookUp = useCallback(async (draft: string): Promise<void> => {
    const conversationId = thread.current;
    const draftKey = key.current;
    const cacheKey = `${conversationId ?? ''}\u0000${draft}`;
    const cached = cache.current.get(cacheKey);
    if (cached) {
      setItems(cached);
      setItemsDraft(draft);
      remember(draftKey, draft, cached);
      return;
    }
    if (Date.now() < quietUntil.current) return;

    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      const data = await searchService.getRelatedContext(
        draft.slice(0, MAX_DRAFT_CHARS),
        conversationId,
        controller.signal,
      );
      if (controller.signal.aborted || draft !== latestDraft.current) return;
      if (!data) {
        quietUntil.current = Date.now() + NO_VERDICT_BACKOFF_MS;
        return;
      }
      // Not ready to search — a pause mid-sentence — or the lookup failed: keep what is
      // showing until a real answer replaces it. Neither is cached, so the same words
      // are asked again at the next pause.
      if (data.ready === false || data.failed) return;
      cache.current.set(cacheKey, data.items);
      if (cache.current.size > CACHE_SIZE) {
        cache.current.delete(cache.current.keys().next().value as string);
      }
      if (!dismissed.current) {
        setItems(data.items);
        setItemsDraft(draft);
        remember(draftKey, draft, data.items);
      }
    } catch (error) {
      // Suggestions are optional, so a failure says nothing. Rate-limited, though,
      // asking again at every pause would only be refused again: wait it out.
      if (isAxiosError(error) && error.response?.status === 429) {
        quietUntil.current = Date.now() + retryAfterMs(error.response.headers['retry-after']);
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, []);

  const interrupt = useCallback((): void => {
    cancel();
    if (!isEnabled.current || dismissed.current) {
      return;
    }
    // What is showing stays until the next answer replaces it, so typing doesn't
    // flicker it. By the time this fires the editor has reported the draft.
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const draft = latestDraft.current;
      if (draft && isWorthLookingUp(draft) && !dismissed.current) {
        void lookUp(draft);
      }
    }, wait.current);
  }, [cancel, lookUp]);

  const onDraftChange = useCallback(
    (text: string): void => {
      const draft = normalize(text);
      latestDraft.current = draft;
      if (!isEnabled.current) return;

      // Sent or cleared: nothing to look up, and the next draft starts fresh,
      // dismissed or not.
      if (!draft) {
        cancel();
        dismissed.current = false;
        setItems(cleared);
        forget(key.current);
        return;
      }
      if (!isWorthLookingUp(draft)) {
        cancel();
        setItems(cleared);
        forget(key.current);
      }
    },
    [cancel],
  );

  const dismiss = useCallback((): void => {
    dismissed.current = true;
    cancel();
    setItems(cleared);
    forget(key.current);
  }, [cancel]);

  return { items, draft: itemsDraft, loading, onDraftChange, interrupt, dismiss };
}
