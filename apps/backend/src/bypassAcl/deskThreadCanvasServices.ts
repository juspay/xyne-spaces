import { db } from '@/database/client';
import type { Prisma } from '@prisma/client';
import { asService } from './base';

/**
 * Relocated from controllers/deskThreadCanvasCallback.handler.ts. Unauthenticated claw callback —
 * no HTTP session to derive the tenant from, so scope is opened off the canvas's own workspaceId.
 */
export function updateDeskThreadCanvasMetadata(
  workspaceId: string,
  canvasId: string,
  metadata: Prisma.InputJsonValue,
) {
  return asService(
    ['Canvas'],
    'desk thread canvas callback: unauthenticated callback has no session, scope opened off the canvas\'s workspaceId',
    'desk-thread-canvas-callback',
    workspaceId,
    () =>
      db.canvas.update({
        where: { id: canvasId },
        data: { metadata, lastEditedAt: new Date() },
      }),
  );
}
