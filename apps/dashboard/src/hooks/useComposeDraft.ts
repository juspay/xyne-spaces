import { useCallback, useMemo } from 'react';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { mutators } from '../zero/mutators';

/**
 * A server-side compose draft = an `email_drafts` row with `conversationId IS NULL`
 * (a brand-new email with no thread yet). Reply drafts (conversationId set) live in
 * the same table but are handled by `useEmailDraft`. Compose drafts are keyed by the
 * compose-window id, which is reused as the `email_drafts.id`, so a draft is one
 * synced record across devices instead of browser-local localStorage.
 */
export interface ComposeDraftRecord {
  id: string;
  channelId: string;
  userId?: string | null;
  conversationId?: string | null;
  subject?: string | null;
  fromAddress?: string | null;
  draftContent: string;
  attachmentIds?: string[] | null;
  toRecipients?: string[] | null | undefined;
  ccRecipients?: string[] | null | undefined;
  bccRecipients?: string[] | null | undefined;
  createdAt: number;
  updatedAt: number;
}

export interface ComposeDraftFields {
  subject?: string;
  fromAddress?: string;
  draftContent?: string;
  attachmentIds?: string[];
  toRecipients?: string[];
  ccRecipients?: string[];
  bccRecipients?: string[];
}

/**
 * The recipient columns are TEXT ("string only") holding a JSON-stringified string[]
 * (the emailDraft mutators stringify on write). Parse back at read boundaries,
 * preserving the presence semantics consumers rely on: null/undefined = never
 * persisted, '[]' = persisted-but-empty (an explicit "cleared" state). Invalid or
 * non-string values read as undefined (= not persisted).
 */
export function parseStringList(raw: unknown): string[] | null | undefined {
  if (raw === null) return null;
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : undefined;
  } catch {
    return undefined;
  }
}

/** Map a raw Zero email_drafts row (recipients as TEXT) to the app-facing record. */
export function parseComposeDraftRow(row: ComposeDraftRecord): ComposeDraftRecord {
  return {
    ...row,
    toRecipients: parseStringList(row.toRecipients),
    ccRecipients: parseStringList(row.ccRecipients),
    bccRecipients: parseStringList(row.bccRecipients),
  };
}

/**
 * All of the caller's compose drafts for a channel (most-recent first). Reactive —
 * surfaces drafts saved on other devices too.
 */
export function useComposeDrafts(channelId: string | null | undefined): ComposeDraftRecord[] {
  const [rows] = useCachedQuery(queries.composeDraftsByChannel({ channelId: channelId || '' }), {
    enabled: !!channelId,
  });
  const raw = rows as unknown as ComposeDraftRecord[] | undefined;
  // Memoized on the row snapshot so consumers keep stable references between renders.
  return useMemo(() => (raw ?? []).map(parseComposeDraftRow), [raw]);
}

/**
 * Save/delete operations for compose drafts. `saveComposeDraft` merges server-side
 * (only the provided fields are written), so partial autosaves don't clobber each
 * other. The caller is responsible for deleting the draft when it becomes empty.
 */
export function useComposeDraftOperations(channelId: string | null | undefined): {
  saveComposeDraft: (id: string, fields: ComposeDraftFields) => void;
  deleteComposeDraft: (id: string) => void;
} {
  const zero = useZero();

  const deleteComposeDraft = useCallback(
    (id: string): void => {
      void zero.mutate(mutators.emailDraft.deleteComposeDraft({ id }));
    },
    [zero],
  );

  const saveComposeDraft = useCallback(
    (id: string, fields: ComposeDraftFields): void => {
      if (!channelId) return;
      void zero.mutate(
        mutators.emailDraft.upsertComposeDraft({
          id,
          channelId,
          ...(fields.subject !== undefined && { subject: fields.subject }),
          ...(fields.fromAddress !== undefined && { fromAddress: fields.fromAddress }),
          ...(fields.draftContent !== undefined && { draftContent: fields.draftContent }),
          ...(fields.attachmentIds !== undefined && { attachmentIds: fields.attachmentIds }),
          ...(fields.toRecipients !== undefined && { toRecipients: fields.toRecipients }),
          ...(fields.ccRecipients !== undefined && { ccRecipients: fields.ccRecipients }),
          ...(fields.bccRecipients !== undefined && { bccRecipients: fields.bccRecipients }),
          updatedAt: Date.now(),
        }),
      );
    },
    [channelId, zero],
  );

  return { saveComposeDraft, deleteComposeDraft };
}
