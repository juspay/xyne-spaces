import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import type { SurfaceAreaType, SurfaceLinkKind } from '@prisma/client';

interface CreateLinkInput {
  sourceType: SurfaceAreaType;
  sourceId: string;
  targetType: SurfaceAreaType;
  targetId: string;
  linkKind: SurfaceLinkKind;
  createdBy: string;
  projectId: string;
}

class SurfaceLinkService {
  async createLink(input: CreateLinkInput): Promise<void> {
    const { sourceType, sourceId, targetType, targetId, linkKind, createdBy, projectId } = input;

    try {
      await db.surfaceLink.upsert({
        where: {
          sourceType_sourceId_targetType_targetId_linkKind: {
            sourceType,
            sourceId,
            targetType,
            targetId,
            linkKind,
          },
        },
        create: {
          sourceType,
          sourceId,
          targetType,
          targetId,
          linkKind,
          createdBy,
          projectId,
        },
        update: {},
      });

      logger.info('[SurfaceLinkService] Link created/ensured', {
        sourceType,
        sourceId,
        targetType,
        targetId,
        linkKind,
      });
    } catch (error) {
      // P2002 = unique constraint violation — safe to ignore (idempotent)
      const prismaError = error as { code?: string };
      if (prismaError.code === 'P2002') return;

      logger.error('[SurfaceLinkService] Failed to create link', {
        sourceType,
        sourceId,
        targetType,
        targetId,
        linkKind,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async deleteLinksForSource(sourceType: SurfaceAreaType, sourceId: string): Promise<void> {
    try {
      const result = await db.surfaceLink.deleteMany({
        where: { sourceType, sourceId },
      });

      if (result.count > 0) {
        logger.info('[SurfaceLinkService] Deleted links for source', {
          sourceType,
          sourceId,
          count: result.count,
        });
      }
    } catch (error) {
      logger.error('[SurfaceLinkService] Failed to delete links for source', {
        sourceType,
        sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const surfaceLinkService = new SurfaceLinkService();
