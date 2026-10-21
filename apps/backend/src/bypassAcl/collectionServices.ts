import type { Prisma, PrismaClient } from '@prisma/client';
import { rawQuery } from './base';

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
