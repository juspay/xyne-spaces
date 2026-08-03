import { useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { apiInstance } from '../services/clients/apiClient';
import { API_BASE_URL } from '../config';
import { generateWebThumbnail, isVideoFile } from '../services/thumbnailService';
import {
  generateDocumentThumbnail,
  isPreviewableDocument,
} from '../services/documentThumbnailService';
import { getFileDimensions } from '../components/ui/utils/files';
import { saveDraft, removeDraft } from './useDraft';

/**
 * Compose-DM draft autosave (Client half of the DB-backed persistence).
 *
 * The compose panel does not belong to a real channel yet, so each mount owns a
 * synthetic placeholder channel id `composedm-<uuid>` and a draft id that share the
 * same uuid. `KeyedComposeDmPanel` remounts the panel per compose, so a fresh mount
 * == a fresh compose draft (matches the product decision: old compose drafts are
 * reached through Drafts & Sent, never auto-restored into a new panel).
 *
 * Durability model:
 *  - `save(payload)` is called on every change. It ALWAYS stores the HTML in the
 *    state machine (in-memory + localStorage) keyed by `draftId` — cheap, synchronous,
 *    no API POST — and keeps `latestRef` current for the pageHide flush. It POSTs to
 *    the DB only when the recipient set changed, on a 500ms debounce so rapid recipient
 *    edits collapse to one request. Content-only edits never POST; they rely on flush.
 *  - `flush` is a best-effort `keepalive` fetch that survives page teardown, used on
 *    `pagehide` and on component unmount to persist the final content to the DB.
 *    keepalive fetch (not XHR/axios) is required here because the browser cancels
 *    in-flight XHR during unload.
 *
 * The endpoint (`POST /api/drafts/compose`) is an owner-scoped upsert keyed by
 * (draftId, userId from session), so repeated saves are idempotent and a save can
 * never overwrite another user's draft.
 */

const COMPOSE_CHANNEL_PREFIX = 'composedm-';
const RECIPIENT_DEBOUNCE_MS = 500;
const MAX_RECIPIENTS = 9;

/**
 * Module-level registry of in-flight attachment upload/delete promises, keyed by
 * draftId. Survives component unmount so DraftsPanel can await pending uploads
 * before sending a compose-DM draft from the drafts list (the ComposeDmPanel
 * hook instance may already be unmounted by then).
 */
const pendingAttachmentOps = new Map<string, Set<Promise<void>>>();

function trackPendingAttachmentOp(draftId: string, promise: Promise<void>): void {
  let set = pendingAttachmentOps.get(draftId);
  if (!set) {
    set = new Set();
    pendingAttachmentOps.set(draftId, set);
  }
  set.add(promise);
  void promise.finally(() => {
    set.delete(promise);
    if (set.size === 0) pendingAttachmentOps.delete(draftId);
  });
}

/**
 * Await all in-flight attachment upload/delete operations for the given draftId.
 * Used by DraftsPanel before sending a compose-DM draft so the backend's
 * DRAFT→CHAT re-parent step finds the rows. Never rejects.
 */
export async function flushPendingAttachmentUploads(draftId: string): Promise<void> {
  const pending = pendingAttachmentOps.get(draftId);
  if (!pending || pending.size === 0) return;
  await Promise.allSettled([...pending]);
}

export interface ComposeDmDraftPayload {
  content: string;
  /** Selected recipient user ids (order-insensitive; the backend stores them sorted). */
  recipientIds: string[];
}

/**
 * True only when the HTML carries real user text — strips tags and NBSPs so an "empty"
 * editor (`<p></p>`, `<br>`, whitespace) is treated as nothing to save.
 */
function hasMeaningfulContent(html: string): boolean {
  return (
    html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim().length > 0
  );
}

export interface ComposeDmDraftAutosave {
  draftId: string;
  channelId: string;
  /**
   * Store content in the state machine (in-memory + localStorage) keyed by `draftId`,
   * and — when the recipient set has changed since the last call — schedule a 500ms-
   * debounced POST to persist (content + recipients) to the DB. Call on every content
   * change and every recipient change. The hook internally diffs recipients to decide
   * whether a POST is needed; content-only changes never POST.
   */
  save: (payload: ComposeDmDraftPayload) => void;
  /** Immediate best-effort persist that survives page unload. */
  flush: (payload: ComposeDmDraftPayload) => void;
  /** Call after a successful send so the teardown flush does not re-persist a sent draft. */
  markSent: () => void;
  /**
   * Persist a locally-added compose-DM attachment to the DB exactly once (idempotent by
   * id). Fires a single multipart POST per attachment — not the debounced autosave path.
   * Generates a thumbnail + dimensions client-side (mirroring the regular upload path)
   * so the persisted MessageAttachment row carries thumbnailUrl and width/height.
   *
   * `onPersistFailure` is invoked (with the attachmentId) if the persist POST fails, so
   * the caller can remove the orphaned local entry from the InputBox tray. The hook
   * itself shows a toast and clears its internal persisted-id tracker to allow retry.
   */
  persistAttachment: (
    attachmentId: string,
    file: File,
    recipientIds: string[],
    onPersistFailure?: (attachmentId: string) => void,
  ) => void;
  /**
   * Delete a compose-DM draft attachment from the DB. Owner-scoped + DRAFT-only on the
   * server. Call when the user removes an attachment from the tray so the row doesn't
   * reappear on restore. Tracked in the same in-flight map as persists so
   * flushPendingPersists drains deletes before send.
   */
  deleteAttachment: (attachmentId: string) => void;
  /**
   * Await all in-flight attachment persist/delete POSTs. Call before send so the backend's
   * re-parent step (DRAFT → CHAT) finds the right rows. Never rejects — failed operations
   * are logged and the send proceeds best-effort.
   */
  flushPendingPersists: () => Promise<void>;
}

/**
 * Optional identity for RESTORING an existing compose-DM draft (opened from Drafts &
 * Sent). When provided, autosave continues writing the SAME (draftId, channelId) row
 * instead of minting a fresh `composedm-<uuid>`, so editing a restored draft updates it
 * in place rather than spawning a duplicate. A brand-new compose passes nothing and gets
 * a fresh identity per mount (the product default).
 */
export interface ComposeDmDraftIdentity {
  draftId: string;
  channelId: string;
}

export function useComposeDmDraftAutosave(
  restoreIdentity?: ComposeDmDraftIdentity,
): ComposeDmDraftAutosave {
  // One stable draft identity per mount: reuse the restored identity when editing an
  // existing draft, otherwise mint a fresh `composedm-<uuid>` for a new compose.
  const idsRef = useRef<{ draftId: string; channelId: string } | null>(null);
  if (idsRef.current === null) {
    if (restoreIdentity) {
      idsRef.current = {
        draftId: restoreIdentity.draftId,
        channelId: restoreIdentity.channelId,
      };
    } else {
      const uuid = uuidv4();
      idsRef.current = { draftId: uuid, channelId: `${COMPOSE_CHANNEL_PREFIX}${uuid}` };
    }
  }
  const { draftId, channelId } = idsRef.current;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<ComposeDmDraftPayload | null>(null);
  const sentRef = useRef(false);
  // Last persisted recipient set — used to detect whether a `save` call is a
  // recipient change (triggers 500ms-debounced POST) or content-only change (no POST).
  const lastRecipientsRef = useRef<string[]>([]);
  // In-flight debounced POST promise, if any. Awaited by the unmount cleanup
  // before flushing so a stale POST (older recipients) commits before the
  // teardown flush (newer recipients) and cannot overwrite it out of order.
  const inFlightPostRef = useRef<Promise<void> | null>(null);
  // Attachment ids already persisted this mount — guarantees one POST per attachment.
  const persistedIdsRef = useRef<Set<string>>(new Set());
  // In-flight persist promises keyed by attachmentId — drained by flushPendingPersists
  // before send so the backend's re-parent step (DRAFT → CHAT) finds the rows.
  const pendingPersistsRef = useRef<Map<string, Promise<void>>>(new Map());
  // Whether a draft row for this draftId exists in the DB. Starts true for restored
  // drafts (loaded from the DB), false for a fresh compose. Set true after any
  // successful upsert/attachment POST; set false after a DELETE or markSent. Used by
  // flush() and the debounced save path to decide between upsert (non-empty content)
  // and DELETE (empty content + row exists).
  const dbRowExistsRef = useRef<boolean>(!!restoreIdentity);

  const buildBody = useCallback(
    (payload: ComposeDmDraftPayload) => ({
      draftId,
      channelId,
      content: payload.content,
      recipientIds: payload.recipientIds.slice(0, MAX_RECIPIENTS),
    }),
    [draftId, channelId],
  );

  const canSave = useCallback(
    // Persist as soon as there is meaningful content, even with no recipients yet —
    // such drafts must appear in Drafts & Sent as "No Destination". Only empty content is skipped.
    (payload: ComposeDmDraftPayload | null): payload is ComposeDmDraftPayload =>
      !!payload && hasMeaningfulContent(payload.content),
    [],
  );

  const clearPendingDebounce = useCallback((): void => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const save = useCallback(
    (payload: ComposeDmDraftPayload): void => {
      latestRef.current = payload;
      if (sentRef.current) return;

      // Always store content in the state machine (in-memory + localStorage) keyed by
      // draftId. No API POST — cheap and synchronous. Keeps latestRef current for flush.
      saveDraft(draftId, payload.content, '');

      // Detect recipient change: if the recipient set changed since the last save,
      // schedule a 500ms-debounced POST to persist (content + recipients) to the DB.
      // Content-only changes never POST — they rely on the pageHide/unmount flush.
      const prev = lastRecipientsRef.current;
      const next = payload.recipientIds.slice(0, MAX_RECIPIENTS);
      const recipientsChanged = prev.length !== next.length || prev.some((id, i) => id !== next[i]);

      if (recipientsChanged) {
        lastRecipientsRef.current = next;
        clearPendingDebounce();
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          const p = latestRef.current;
          if (!p) return;
          // Always POST when recipients changed.
          inFlightPostRef.current = apiInstance
            .post('/drafts/compose', buildBody(p))
            .then(() => {
              dbRowExistsRef.current = true;
            })
            .catch(() => {
              toast.error('Draft not saved', {
                description:
                  'Your recipient changes could not be saved. Will retry on next change.',
              });
            })
            .then(() => {
              inFlightPostRef.current = null;
            });
        }, RECIPIENT_DEBOUNCE_MS);
      }
    },
    [draftId, buildBody, clearPendingDebounce],
  );

  const flush = useCallback(
    (payload: ComposeDmDraftPayload): void => {
      latestRef.current = payload;
      if (sentRef.current) return;
      clearPendingDebounce();

      if (canSave(payload)) {
        // Non-empty content — upsert. keepalive fetch (NOT axios/XHR) is required:
        // the browser cancels in-flight XHR during page unload. Same-origin in prod;
        // credentialed CORS in dev. Auth is via HTTP-only cookies (credentials: 'include').
        try {
          // eslint-disable-next-line local-rules/no-fetch-use-axios
          void fetch(`${API_BASE_URL}/drafts/compose`, {
            method: 'POST',
            credentials: 'include',
            keepalive: true,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody(payload)),
          }).catch(() => undefined);
        } catch {
          // best-effort — nothing else to do during teardown
        }
        return;
      }

      // Empty content — if a DB row exists, delete it (or clear content if the draft
      // still has attachments). The backend makes the delete-vs-clear decision based
      // on hasAttachment so the client doesn't need to track attachment state here.
      if (!dbRowExistsRef.current) return;
      try {
        // eslint-disable-next-line local-rules/no-fetch-use-axios
        void fetch(`${API_BASE_URL}/drafts/compose/${draftId}`, {
          method: 'DELETE',
          credentials: 'include',
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // best-effort — nothing else to do during teardown
      }
      // Optimistically clear the local state machine + localStorage entry so a remount
      // with the same draftId doesn't restore stale content.
      removeDraft(draftId);
    },
    [draftId, buildBody, canSave, clearPendingDebounce],
  );

  const persistAttachment = useCallback(
    (
      attachmentId: string,
      file: File,
      recipientIds: string[],
      onPersistFailure?: (attachmentId: string) => void,
    ): void => {
      if (sentRef.current) return;
      // Fire at most once per attachment id — these persists are not recurring.
      if (persistedIdsRef.current.has(attachmentId)) return;
      persistedIdsRef.current.add(attachmentId);

      const promise = (async (): Promise<void> => {
        // Generate thumbnail + dimensions client-side, mirroring the regular upload path
        // (useExistingDmChannel.sendConversationWithAttachments). Without this, video/doc
        // attachments lose their thumbnailUrl on navigate-away / restore.
        let thumbnailBlob: Blob | undefined;
        let width: number | undefined;
        let height: number | undefined;
        let duration: number | undefined;

        if (isVideoFile(file)) {
          try {
            const thumb = await generateWebThumbnail(file);
            thumbnailBlob = thumb.blob;
            width = thumb.width;
            height = thumb.height;
            duration = thumb.duration;
          } catch {
            // best-effort — persist without thumbnail
          }
        } else if (isPreviewableDocument(file.type)) {
          try {
            thumbnailBlob = (await generateDocumentThumbnail(file)) ?? undefined;
          } catch {
            // best-effort
          }
        } else if (file.type.startsWith('image/')) {
          const dims = await getFileDimensions(file);
          if (dims) {
            width = dims.width ?? undefined;
            height = dims.height ?? undefined;
          }
        }

        const formData = new FormData();
        formData.append('files', file);
        if (thumbnailBlob) {
          formData.append('thumbnails', thumbnailBlob, `${file.name}_thumb.jpg`);
        }
        formData.append(
          'fileMetadata',
          JSON.stringify([
            {
              fileIndex: 0,
              hasThumbnail: !!thumbnailBlob,
              thumbnailIndex: thumbnailBlob ? 0 : undefined,
              width,
              height,
              duration,
            },
          ]),
        );
        formData.append('attachmentIds', JSON.stringify([attachmentId]));
        formData.append('draftId', draftId);
        formData.append('channelId', channelId);
        formData.append('recipientIds', JSON.stringify(recipientIds.slice(0, MAX_RECIPIENTS)));

        await apiInstance.post('/drafts/compose/attachments', formData);
        // The attachment endpoint creates the draft row if it didn't exist — track that.
        dbRowExistsRef.current = true;
      })().catch(() => {
        // On failure, drop the id so a later add of the same file can retry.
        persistedIdsRef.current.delete(attachmentId);
        toast.error('Failed to upload attachment', {
          description: `"${file.name}" could not be uploaded.`,
        });
        // Let the caller remove the orphaned local entry from the InputBox tray so
        // it doesn't appear sendable when no DRAFT row exists for it.
        onPersistFailure?.(attachmentId);
      });

      pendingPersistsRef.current.set(attachmentId, promise);
      trackPendingAttachmentOp(draftId, promise);
      // Clean up the map entry once resolved so it doesn't grow unbounded.
      void promise.then(() => {
        pendingPersistsRef.current.delete(attachmentId);
      });
    },
    [draftId, channelId],
  );

  const deleteAttachment = useCallback(
    (attachmentId: string): void => {
      if (sentRef.current) return;
      // Cancel any in-flight persist for this id — once deleted, the persist would 404
      // or re-create a row the user just removed. We don't await it; the DELETE will
      // simply win over a persist that hasn't landed yet (server is owner-scoped + idempotent).
      pendingPersistsRef.current.delete(attachmentId);
      // Allow re-persist if the user re-adds the same file later.
      persistedIdsRef.current.delete(attachmentId);

      const promise = apiInstance
        .delete(`/drafts/compose/attachments/${attachmentId}`)
        .then(() => undefined)
        .catch(() => {
          toast.error('Failed to delete attachment', {
            description: 'The attachment may reappear when you restore this draft.',
          });
        });

      pendingPersistsRef.current.set(attachmentId, promise);
      trackPendingAttachmentOp(draftId, promise);
      void promise.then(() => {
        pendingPersistsRef.current.delete(attachmentId);
      });
    },
    [draftId],
  );

  const flushPendingPersists = useCallback(async (): Promise<void> => {
    const pending = Array.from(pendingPersistsRef.current.values());
    if (pending.length === 0) return;
    // Never reject — a failed persist should not block send. The backend's re-parent
    // step simply won't find that attachment's DRAFT row, and it stays orphaned (best-effort).
    await Promise.allSettled(pending);
  }, []);

  const markSent = useCallback((): void => {
    sentRef.current = true;
    dbRowExistsRef.current = false;
    inFlightPostRef.current = null;
    clearPendingDebounce();
  }, [clearPendingDebounce]);

  // Flush on tab hide / navigation away, and on component teardown (remount for a new
  // compose, or route change). Guards inside flush() skip empty/sent drafts.
  // On unmount we first await any in-flight debounced POST so it commits before
  // the teardown flush — otherwise a stale POST (older recipients) could land
  // after the flush and clobber the newer recipient set.
  useEffect(() => {
    const onPageHide = (): void => {
      if (latestRef.current) flush(latestRef.current);
    };
    window.addEventListener('pagehide', onPageHide);
    return (): void => {
      window.removeEventListener('pagehide', onPageHide);
      if (latestRef.current) {
        const pending = inFlightPostRef.current;
        if (pending) {
          void pending.then(() => flush(latestRef.current!));
        } else {
          flush(latestRef.current);
        }
      }
    };
  }, [flush]);

  return {
    draftId,
    channelId,
    save,
    flush,
    markSent,
    persistAttachment,
    deleteAttachment,
    flushPendingPersists,
  };
}
