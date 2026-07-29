import { useSyncExternalStore } from 'react';
import { stateMachineActor, type DraftMessage } from '../machines/stateMachine.js';
import { draftLookupId, refKey, type ConversationRef } from './conversationRef.js';

export type Draft = DraftMessage;
export type DraftInput = { html: string; text: string };

/**
 * Synchronous read of the current draft for `ref`. Safe to call from any
 * callback (composer mount, send onError, non-React handlers).
 */
export function getDraft(ref: ConversationRef): Draft | null {
  const lookupId = draftLookupId(ref);
  const drafts = stateMachineActor.getSnapshot().context.drafts;
  return drafts[lookupId] ?? null;
}

/**
 * Persist a draft. Fires SAVE_DRAFT, which mirrors to sync storage via the
 * platform bridge configured in `syncStorage.ts` (localStorage on Dashboard,
 * MMKV on Lotus).
 */
export function setDraft(ref: ConversationRef, draft: DraftInput): void {
  stateMachineActor.send({
    type: 'SAVE_DRAFT',
    lookupId: draftLookupId(ref),
    html: draft.html,
    text: draft.text,
  });
}

export function clearDraft(ref: ConversationRef): void {
  stateMachineActor.send({
    type: 'REMOVE_DRAFT',
    lookupId: draftLookupId(ref),
  });
}

/**
 * Subscribe to draft changes for `ref`. Callback fires when the referenced
 * slot changes — writes to other refs are filtered out. Returns an unsubscribe.
 */
export function subscribeDraft(
  ref: ConversationRef,
  cb: (draft: Draft | null) => void,
): () => void {
  const lookupId = draftLookupId(ref);
  let last = stateMachineActor.getSnapshot().context.drafts[lookupId] ?? null;
  const sub = stateMachineActor.subscribe(snapshot => {
    const next = snapshot.context.drafts[lookupId] ?? null;
    if (next === last) return;
    last = next;
    cb(next);
  });
  return () => sub.unsubscribe();
}

/**
 * React binding for composers that want the draft to drive their input
 * initial value / restore. Non-React callers should use `getDraft` / `setDraft`
 * directly.
 */
export function useDraft(ref: ConversationRef): [Draft | null, (d: DraftInput) => void] {
  const key = refKey(ref);
  const draft = useSyncExternalStore(
    subscribe => subscribeDraft(ref, () => subscribe()),
    () => getDraft(ref),
    () => getDraft(ref),
  );
  const write = (d: DraftInput): void => setDraft(ref, d);
  // key is included so React ties subscription identity to the ref.
  void key;
  return [draft, write];
}
