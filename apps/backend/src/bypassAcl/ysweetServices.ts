import { db } from '@/database/client';
import { asSystem } from './base';

/**
 * Resolves the workspace that owns a y-sweet doc. The storage-key route has no session and no
 * ambient workspace — the doc id is the only input — so the read runs as system: under any
 * workspace filter it would resolve to null for every caller.
 *
 * Also accepts a legacy viewAccessId/editAccessId: y-sweet docs created before XYNE-17290 are
 * keyed by one of those instead of the canonical canvas id, and both columns are globally
 * unique so the fallback is unambiguous. Without it those docs could never be written again —
 * the key request would 404 and y-sweet refuses to fall back to an unencrypted write.
 */
export function resolveYSweetDocWorkspaceId(docId: string): Promise<string | null> {
  return asSystem(
    ['Canvas'],
    'y-sweet storage key: the doc id is the only input, so the owning workspace must be read before any scope exists',
    async () => {
      const canvas = await db.canvas.findUnique({
        where: { id: docId },
        select: { workspaceId: true },
      });
      if (canvas) return canvas.workspaceId;

      const legacy = await db.canvas.findFirst({
        where: { OR: [{ viewAccessId: docId }, { editAccessId: docId }] },
        select: { workspaceId: true },
      });
      return legacy?.workspaceId ?? null;
    },
  );
}
