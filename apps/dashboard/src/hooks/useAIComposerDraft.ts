import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import {
  NEW_CHAT_DRAFT_SCOPE,
  buildAIDraftKey,
  getDraftStorage,
  isDraftEmpty,
  pruneAIDrafts,
  readAIDraft,
  removeAIDraft,
  writeAIDraft,
  type AIComposerDraft,
  type AIComposerDraftInput,
  type WriteAIDraftOptions,
} from '../utils/aiComposerDraft';

const SAVE_DEBOUNCE_MS = 300;

let prunedThisSession = false;

interface PendingSave {
  key: string;
  input: AIComposerDraftInput;
  options: WriteAIDraftOptions;
}

export interface RestoreInfo {
  /** True for the draft found when the composer first got a key (mount). */
  initial: boolean;
}

export interface UseAIComposerDraftOptions {
  /** Conversation id, {@link NEW_CHAT_DRAFT_SCOPE} for a chat with no id yet,
   *  or null/undefined to turn drafts off for this composer. */
  scope: string | null | undefined;
  /** Called with the draft for the key the composer just moved to — on mount
   *  (after the first render) and when the composer switches to another chat.
   *  Not called when a new chat's draft is carried onto its freshly created id. */
  onRestore?: (draft: AIComposerDraft | null, info: RestoreInfo) => void;
}

export interface UseAIComposerDraftResult {
  /** Draft for the key at first render — read synchronously so a composer can
   *  seed its initial state from it. */
  initialDraft: AIComposerDraft | null;
  /** Debounced save. An empty draft removes the stored one (a genuine clear);
   *  input identical to what is already stored is a no-op. */
  save: (input: AIComposerDraftInput, options?: WriteAIDraftOptions) => void;
  /** Cancel any pending save and delete the draft — call on send / explicit clear. */
  clear: () => void;
}

function sameDraft(a: AIComposerDraftInput, b: AIComposerDraftInput | null): boolean {
  if (!b) return isDraftEmpty(a);
  return (
    a.text === b.text &&
    (a.agentSlug ?? null) === (b.agentSlug ?? null) &&
    (a.attachmentCount ?? 0) === (b.attachmentCount ?? 0) &&
    JSON.stringify(a.context ?? null) === JSON.stringify(b.context ?? null)
  );
}

function stripMeta(draft: AIComposerDraft | null): AIComposerDraftInput | null {
  if (!draft) return null;
  const { v: _v, savedAt: _savedAt, ...rest } = draft;
  return rest;
}

/**
 * Keeps a Xyne AI composer's draft in localStorage (XYNE-67287), keyed per
 * workspace, user and conversation. See utils/aiComposerDraft for the format.
 *
 * Saves are debounced and flushed on unmount, page hide and key change, so
 * navigating away never drops the last keystrokes. Nothing is written until
 * the composer calls `save`, so a composer that mounts empty never deletes an
 * existing draft (the XYNE-17500 failure mode).
 */
export function useAIComposerDraft({
  scope,
  onRestore,
}: UseAIComposerDraftOptions): UseAIComposerDraftResult {
  const { user } = useAuth();
  const key = buildAIDraftKey(user?.workspaceId, user?.id, scope);

  const [initialDraft] = useState<AIComposerDraft | null>(() =>
    readAIDraft(getDraftStorage(), key),
  );

  const keyRef = useRef(key);
  const scopeRef = useRef(scope);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingSave | null>(null);
  /** What this composer last read from / wrote to its current key. */
  const storedRef = useRef<AIComposerDraftInput | null>(stripMeta(initialDraft));
  /** True once this composer has saved user input under its current key. */
  const dirtyRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const flush = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) writeAIDraft(getDraftStorage(), pending.key, pending.input, pending.options);
  }, []);

  const save = useCallback(
    (input: AIComposerDraftInput, options: WriteAIDraftOptions = {}): void => {
      const currentKey = keyRef.current;
      if (!currentKey) return;
      // A text-only composer (keepExistingContext) only owns the text.
      const textOnly = options.keepExistingContext === true && !input.context;
      const stored = storedRef.current;
      const unchanged = textOnly ? (stored?.text ?? '') === input.text : sameDraft(input, stored);
      if (!pendingRef.current && unchanged) return;
      dirtyRef.current = true;
      storedRef.current = textOnly && stored ? { ...stored, text: input.text } : input;
      pendingRef.current = { key: currentKey, input, options };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const clear = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    dirtyRef.current = false;
    storedRef.current = null;
    removeAIDraft(getDraftStorage(), keyRef.current);
  }, []);

  // Mount: housekeeping once per page load, then hand the initial draft over.
  useEffect(() => {
    if (!prunedThisSession) {
      prunedThisSession = true;
      pruneAIDrafts(getDraftStorage());
    }
    if (keyRef.current) onRestoreRef.current?.(initialDraft, { initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Key change: a new chat getting its id carries the draft over; any other
  // switch flushes the old chat's draft and restores the new chat's.
  useEffect(() => {
    const prevKey = keyRef.current;
    const prevScope = scopeRef.current;
    if (prevKey === key) return;
    flush();
    keyRef.current = key;
    scopeRef.current = scope;
    if (!key) {
      storedRef.current = null;
      dirtyRef.current = false;
      return;
    }
    const storage = getDraftStorage();
    const next = readAIDraft(storage, key);
    if (prevKey && prevScope === NEW_CHAT_DRAFT_SCOPE && dirtyRef.current && !next) {
      const carried = readAIDraft(storage, prevKey);
      if (carried) writeAIDraft(storage, key, stripMeta(carried) ?? { text: '' });
      removeAIDraft(storage, prevKey);
      storedRef.current = stripMeta(carried);
      return;
    }
    dirtyRef.current = false;
    storedRef.current = stripMeta(next);
    onRestoreRef.current?.(next, { initial: prevKey === null });
  }, [key, scope, flush]);

  // Flush on unmount and when the tab is hidden or closed.
  useEffect(() => {
    const onHide = (): void => flush();
    window.addEventListener('pagehide', onHide);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return (): void => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flush]);

  return useMemo(() => ({ initialDraft, save, clear }), [initialDraft, save, clear]);
}
