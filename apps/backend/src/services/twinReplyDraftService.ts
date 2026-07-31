import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import type { TwinReplyDraft } from './twinReplyDraft';

/**
 * Digital Twin in-thread reply draft — DB IO layer.
 *
 * A twin proposal is stored as an ordinary `draft_messages` row with
 * `origin = 'twin'` (owner = the mentioned user, `userId`). Zero's per-user
 * replication delivers it live to the owner's client (the `twinDrafts` query),
 * so there is no bespoke fetch or socket — the row appearing IS the notification,
 * and deleting it clears the dock/badge everywhere.
 *
 * Owner-only by construction: the read/act paths always scope to
 * `userId = req.user.id AND origin = 'twin'`, and Zero's drafts ACL already
 * restricts every draft_messages row to its own `userId`.
 *
 * The rich twin payload (action/emoji/reasoning/citations/destination/sessionId/…)
 * rides in the row's `metadata` JSON; `content` mirrors the reply text. Unlike a
 * user draft there is NO unique constraint, so a thread can hold several twin
 * proposals (one per @mention). Rows live until the owner approves or declines
 * (both delete the row); an ignored proposal simply stays.
 *
 * Pure types + validation/projection live in `./twinReplyDraft` and are
 * re-exported here so existing importers are unaffected.
 */
export * from './twinReplyDraft';

const db = (): ReturnType<typeof DatabaseClient.getInstance> => DatabaseClient.getInstance();

/** Parse the stringified-JSON twin payload from a row's `metadata` (TEXT column).
 *  Returns null for empty/absent/malformed metadata (treated as "no draft"). */
function parseTwinMetadata(metadata: string | null | undefined): TwinReplyDraft | null {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as TwinReplyDraft;
  } catch (error) {
    logger.warn('[TwinReplyDraft] metadata parse failed, ignoring row', { error });
    return null;
  }
}

/**
 * Persist a twin proposal as a draft_messages row. Called only by the S2S create
 * route. A re-run of the twin for the SAME trigger (same owner + thread +
 * sourceMessageId) replaces its prior proposal; distinct triggers accumulate as
 * separate drafts in the thread.
 */
export async function createTwinReplyDraft(draft: TwinReplyDraft): Promise<void> {
  const prisma = db();
  // Best-effort dedup: drop a stale proposal for the same @mention before insert.
  // metadata is stringified JSON (TEXT), so we can't filter by JSON path in SQL —
  // fetch this thread's twin proposals and match sourceMessageId in JS.
  if (draft.sourceMessageId) {
    try {
      const existing = await prisma.draftMessage.findMany({
        where: {
          userId: draft.ownerUserId,
          conversationId: draft.conversationId,
          origin: 'twin',
        },
        select: { id: true, metadata: true },
      });
      const staleIds = existing
        .filter(row => parseTwinMetadata(row.metadata)?.sourceMessageId === draft.sourceMessageId)
        .map(row => row.id);
      if (staleIds.length > 0) {
        await prisma.draftMessage.deleteMany({ where: { id: { in: staleIds } } });
      }
    } catch (error) {
      logger.warn('[TwinReplyDraft] dedup delete failed (harmless duplicate possible)', { error });
    }
  }
  await prisma.draftMessage.create({
    data: {
      workspaceId: draft.workspaceId,
      channelId: draft.channelId,
      conversationId: draft.conversationId,
      userId: draft.ownerUserId,
      content: draft.message ?? '',
      hasAttachment: false,
      origin: 'twin',
      metadata: JSON.stringify(draft),
      createdAt: new Date(draft.createdAt),
      updatedAt: new Date(draft.createdAt),
    },
  });
}

/** Read one twin proposal by its row id, scoped to the owner. Returns the full
 *  stored TwinReplyDraft (from `metadata`) — the delivery context approve/decline
 *  forward to claw-auth — or null if it's gone / not the caller's / not a twin. */
export async function getTwinReplyDraftById(
  id: string,
  ownerUserId: string,
): Promise<TwinReplyDraft | null> {
  try {
    const row = await db().draftMessage.findFirst({
      where: { id, userId: ownerUserId, origin: 'twin' },
      select: { metadata: true },
    });
    return parseTwinMetadata(row?.metadata);
  } catch (error) {
    logger.warn('[TwinReplyDraft] read failed, treating as no draft', { error });
    return null;
  }
}

/** Remove a twin proposal once approved/declined (consumed). Owner-scoped. */
export async function deleteTwinReplyDraftById(id: string, ownerUserId: string): Promise<void> {
  try {
    await db().draftMessage.deleteMany({ where: { id, userId: ownerUserId, origin: 'twin' } });
  } catch (error) {
    logger.warn('[TwinReplyDraft] delete failed', { error });
  }
}
