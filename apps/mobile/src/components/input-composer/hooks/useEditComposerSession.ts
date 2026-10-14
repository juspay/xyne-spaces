import { useState } from 'react';

import type { ChatInputEditingMessage } from '../input-composer.types';

/**
 * Monotonic counter that bumps every time an edit opens or the edit target
 * switches. It drives the composer remount key, so each edit-open gets a fresh
 * native input tree that can load the message through `defaultValue`.
 *
 * Leaving edit mode (send / cancel) deliberately KEEPS the current value.
 * useComposerDraft's leave-edit layout effect already resets the composer in
 * place, so remounting on exit would only cause a visible flicker + refocus
 * jump with no behavioural benefit.
 */
export function useEditComposerSession(
  editingMessage: ChatInputEditingMessage | null | undefined,
): number {
  const [editSession, setEditSession] = useState(0);
  const [prevEditingMessage, setPrevEditingMessage] = useState(editingMessage);

  if (editingMessage !== prevEditingMessage) {
    setPrevEditingMessage(editingMessage);
    // Only a NEW edit target needs a fresh native tree. Exiting edit keeps the
    // session stable so the existing composer instance stays mounted.
    if (editingMessage) {
      setEditSession(session => session + 1);
    }
  }

  return editSession;
}
