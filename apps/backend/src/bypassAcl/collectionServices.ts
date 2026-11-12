import type { Prisma, PrismaClient } from '@prisma/client';
import type { DriveImportJobData } from '@/services/driveImport/driveImportWorker';
import { asService, rawQuery } from './base';

type CollectionClient = PrismaClient | Prisma.TransactionClient;

/**
 * Relocated from collectionRepository. A recursive CTE Prisma cannot express; the workspace
 * predicate is repeated on both the anchor and the recursive term. SQL unchanged.
 */
export async function queryCollectionFolderTree(client: CollectionClient, folderId: string, workspaceId: string): Promise<Array<{ id: string; name: string; parentId: string | null }>> {
  return rawQuery(
    ['Collection'],
    'collections: recursive folder-tree walk, workspace predicate written explicitly on every level',
    () => client.$queryRaw<Array<{ id: string; name: string; parentId: string | null }>>`
            WITH RECURSIVE folder_tree AS (
                SELECT id, name, "parentId"
                FROM collections
                WHERE id = ${folderId} AND "workspaceId" = ${workspaceId} AND "deletedAt" IS NULL
                UNION ALL
                SELECT c.id, c.name, c."parentId"
                FROM collections c
                INNER JOIN folder_tree ft ON c."parentId" = ft.id
                WHERE c."deletedAt" IS NULL AND c."workspaceId" = ${workspaceId}
            )
            SELECT id, name, "parentId" FROM folder_tree
        `,
  );
}

/**
 * Relocated from services/driveImport/driveImportWorker.ts's processor. Background job → no
 * request context; acts as the importing user in their workspace, as the in-process import from
 * the request does.
 */
export function runDriveImportJob(job: DriveImportJobData): Promise<void> {
  return asService(
    ['Collection', 'CollectionItem'],
    'drive import job: background job has no request context, scope opened from the job\'s workspace',
    job.userId,
    job.workspaceId,
    async () => {
      // Lazy import: the worker module imports this file.
      const { processDriveImportJob } = await import('@/services/driveImport/driveImportWorker');
      await processDriveImportJob(job);
    },
  );
}
