type TwinDraftOpenSelection = {
  conversationId: string;
  draftId: string;
};

let pendingSelection: TwinDraftOpenSelection | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const setTwinDraftOpenSelection = (selection: TwinDraftOpenSelection | null): void => {
  pendingSelection = selection;
  emit();
};

export const peekTwinDraftOpenSelection = (): TwinDraftOpenSelection | null => pendingSelection;

/**
 * Returns the pending draft id when it belongs to this thread, then clears it
 * so a later visit does not re-select a stale proposal.
 */
export const consumeTwinDraftOpenSelection = (conversationId: string): string | null => {
  const trimmed = conversationId.trim();
  if (!trimmed || !pendingSelection || pendingSelection.conversationId !== trimmed) {
    return null;
  }
  const draftId = pendingSelection.draftId;
  pendingSelection = null;
  emit();
  return draftId;
};

export const subscribeTwinDraftOpenSelection = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};
