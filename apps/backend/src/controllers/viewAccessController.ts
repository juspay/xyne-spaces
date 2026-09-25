import { Response, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { SavedConfigVisibility, ViewAccessEntityType } from '@xyne/shared';

/**
 * REST access-list for a ticket "view" (SavedUserConfiguration).
 *
 * The share modal uses this instead of a Zero query because view_access rows only sync
 * to the user they target (entityId = self); the view owner can't read the grants they
 * created via Zero.
 *
 * Reads use raw SQL on purpose. The `db` client's ACL extension (see
 * database/tenant/acl-extension.ts) scopes SavedUserConfiguration reads to
 * "owner OR PUBLIC", which would hide a view merely shared with the caller and make the
 * findUnique return null. Raw queries carry no model, so they bypass that extension —
 * authorization is enforced explicitly below instead.
 */
export const viewAccessController = {
  getAccessList: async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { viewId } = req.params;

      const views = await db.$queryRaw<Array<{ userId: string; visibility: string }>>(
        Prisma.sql`
          SELECT "userId", "visibility"
          FROM "public"."saved_user_configurations"
          WHERE "id" = ${viewId}
          LIMIT 1
        `,
      );
      const view = views[0];
      if (!view) {
        res.status(404).json({ error: 'View not found' });
        return;
      }

      // Authorize: the owner, a public view, or a user the view is shared with.
      const isOwner = view.userId === userId;
      const isPublic = view.visibility === SavedConfigVisibility.PUBLIC;
      let hasGrant = false;
      if (!isOwner && !isPublic) {
        const grantRows = await db.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            SELECT "id"
            FROM "public"."view_access"
            WHERE "viewId" = ${viewId}
              AND "entityType" = ${ViewAccessEntityType.USER}
              AND "entityId" = ${userId}
            LIMIT 1
          `,
        );
        hasGrant = grantRows.length > 0;
      }
      if (!isOwner && !isPublic && !hasGrant) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const grants = await db.$queryRaw<
        Array<{ id: string; entityType: string; entityId: string; sharedBy: string }>
      >(
        Prisma.sql`
          SELECT "id", "entityType", "entityId", "sharedBy"
          FROM "public"."view_access"
          WHERE "viewId" = ${viewId}
          ORDER BY "createdAt" DESC
        `,
      );

      res.json({ ownerId: view.userId, grants });
    } catch (error) {
      logger.error('Failed to get view access list:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};
