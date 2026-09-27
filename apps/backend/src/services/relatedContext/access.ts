import { db } from '@/database/client';
import type { ACLContext } from '@/database/acl/base-acl';
import { MessagesACL } from '@/database/acl/tables/messages-acl';
import { TicketsACL } from '@/database/acl/tables/tickets-acl';
import { CanvasesACL } from '@/database/acl/tables/canvases-acl';
import { callShareService } from '@/services/callShareService';
import type { TransformedSearchResult } from '@/services/vespaSearch/resultTransform';
import { logger } from '@/utils/logger';

export type AccessKind = 'thread' | 'ticket' | 'canvas' | 'call';

/**
 * Keeps only the search results the person typing can open, by the app's own read
 * rules — the same ones the screens and the sync layer enforce — before anything is
 * shown to them or sent to the classifier.
 *
 * The search already filters by permissions, but it cannot be the last word here:
 * - its permission fields are copies, updated after the fact, so someone just removed
 *   from a private channel still matches for a while;
 * - it lets anyone in a workspace match public channels, where a guest may only see
 *   the channels granted to them;
 * - it lets every member of a call's channel match the call's transcript, where a
 *   recording is only open to the people it is shared with.
 *
 * Fails closed: a kind whose check errors contributes nothing.
 */
export async function keepReadable(
  kind: AccessKind,
  results: TransformedSearchResult[],
  auth: ACLContext
): Promise<TransformedSearchResult[]> {
  if (results.length === 0) return results;
  try {
    const readable = await readableIds(kind, results, auth);
    const kept = results.filter((result) => readable.has(idOf(kind, result)));
    if (kept.length < results.length) {
      logger.info('[RelatedContext] dropped unreadable results', {
        kind,
        dropped: results.length - kept.length,
        of: results.length,
      });
    }
    return kept;
  } catch (error) {
    logger.error('[RelatedContext] access check failed; dropping results', {
      kind,
      count: results.length,
      error: error instanceof Error ? error.name : 'unknown',
    });
    return [];
  }
}

/** The id each kind's read rule is checked against. */
function idOf(kind: AccessKind, result: TransformedSearchResult): string {
  // A thread hit is a message; its own row decides, since a reply can be visible to
  // one person only.
  return kind === 'thread' ? (result.searchContext?.messageId ?? result.id) : result.id;
}

async function readableIds(
  kind: AccessKind,
  results: TransformedSearchResult[],
  auth: ACLContext
): Promise<Set<string>> {
  const ids = [...new Set(results.map((result) => idOf(kind, result)))];
  switch (kind) {
    case 'thread': {
      const rows = await db.message.findMany({
        where: {
          AND: [
            { messageId: { in: ids }, isDeleted: false },
            await new MessagesACL(auth, db).getWhereClause(),
          ],
        },
        select: { messageId: true },
      });
      return new Set(rows.map((row) => row.messageId));
    }
    case 'ticket': {
      const rows = await db.ticket.findMany({
        where: { AND: [{ id: { in: ids } }, await new TicketsACL(auth, db).getWhereClause()] },
        select: { id: true },
      });
      return new Set(rows.map((row) => row.id));
    }
    case 'canvas': {
      const rows = await db.canvas.findMany({
        where: { AND: [{ id: { in: ids } }, await new CanvasesACL(auth, db).getWhereClause()] },
        select: { id: true },
      });
      return new Set(rows.map((row) => row.id));
    }
    case 'call': {
      // The rule the recording and call screens enforce, not the search's.
      const calls = await db.call.findMany({ where: { id: { in: ids } } });
      const allowed = await Promise.all(
        calls.map(async (call) =>
          (await callShareService.hasAtLeast(call, auth.userId, auth.workspaceId, 'view'))
            ? call.id
            : null
        )
      );
      return new Set(allowed.filter((id): id is string => id !== null));
    }
  }
}
