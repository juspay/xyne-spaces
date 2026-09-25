import { transaction } from '../base';
import type { ReleaseReport } from '@xyne/shared';
import type { User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { CanvasVisibility, CanvasRole } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
export function createOrUpdateTx(existingCanvas: any, title: string, report: ReleaseReport, owner: User, now: Date, metadata: Prisma.InputJsonObject, canvasId: any) {
  return transaction(['Canvas', 'CanvasParticipant'], 'createOrUpdate: report canvas and owner participant row must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    if (existingCanvas) {
      await tx.canvas.update({
        where: { id: existingCanvas.id },
        data: {
          title,
          content: [],
          channelId: report.release.channelId,
          projectId: report.release.projectId,
          createdBy: owner.id,
          lastEditedBy: owner.id,
          lastEditedAt: now,
          visibility: CanvasVisibility.PUBLIC,
          isCollaborative: true,
          metadata,
        },
      });
      await tx.canvasParticipant.upsert({
        where: {
          canvasId_userId: {
            canvasId: existingCanvas.id,
            userId: owner.id,
          },
        },
        create: {
          id: uuidv4(),
          canvasId: existingCanvas.id,
          userId: owner.id,
          workspaceId: report.release.workspaceId,
          role: CanvasRole.VIEWER,
          joinedAt: now,
          updatedAt: now,
        },
        update: {
          role: CanvasRole.VIEWER,
          updatedAt: now,
        },
      });

      return {
        canvasId: existingCanvas.id,
        action: 'updated' as const,
      };
    }

    await tx.canvas.create({
      data: {
        id: canvasId,
        title,
        content: [],
        channelId: report.release.channelId,
        projectId: report.release.projectId,
        workspaceId: report.release.workspaceId,
        createdBy: owner.id,
        visibility: CanvasVisibility.PUBLIC,
        isTemplate: false,
        isCollaborative: true,
        lastEditedBy: owner.id,
        lastEditedAt: now,
        metadata,
      },
    });
    await tx.canvasParticipant.create({
      data: {
        id: uuidv4(),
        canvasId,
        userId: owner.id,
        workspaceId: report.release.workspaceId,
        role: CanvasRole.VIEWER,
        joinedAt: now,
        updatedAt: now,
      },
    });

    return { canvasId, action: 'created' as const };
  });
}
