import { transaction } from '../base';
import { CollectionRepository } from '@/database/repositories/collectionRepository';
import { AttachmentEntityType, CollectionRole, IngestionStatus } from '@xyne/shared';


export function updateCollectionTx(self: CollectionRepository, data: { name?: string; permissions?: { userId?: string; userGroupId?: string; role: CollectionRole; canShare?: boolean; }[]; }, collectionId: string) {
  return transaction(['Collection', 'CollectionPermission'], 'updateCollection: collection rename with permission wipe and recreate must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
      if (data.name) {
          await tx.collection.update({ where: { id: collectionId }, data: { name: data.name } });
      }
      await tx.collectionPermission.deleteMany({ where: { collectionId } });
      if (data.permissions && data.permissions.length > 0) {
          const now = new Date();
          const collection = await tx.collection.findUniqueOrThrow({
              where: { id: collectionId },
              select: { workspaceId: true },
          });
          await tx.collectionPermission.createMany({
              data: data.permissions.map(p => ({
                  collectionId,
                  workspaceId: collection.workspaceId,
                  userId: p.userId,
                  userGroupId: p.userGroupId,
                  role: p.role,
                  canShare: p.canShare || false,
                  createdAt: now,
              })),
          });
      }
      return await tx.collection.findUniqueOrThrow({
          where: { id: collectionId },
          include: { permissions: true },
      });
  });
}
export function createItemVersionTx(self: CollectionRepository, data: { currentItemId: string; storageKey: string; mimeType: string; fileSize: bigint; uploadedById: string; workspaceId: string; ingestionStatus: IngestionStatus; }, current: any) {
  return transaction(['CollectionItem', 'MessageAttachment'], 'createItemVersion: collection item version rollover and attachment creation must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
      await tx.collectionItem.update({
          where: { id: data.currentItemId },
          data: { isLatest: false },
      });

      const newItem = await tx.collectionItem.create({
          data: {
              rootCollectionId: current.rootCollectionId,
              collectionId: current.collectionId,
              workspaceId: data.workspaceId,
              fileId: current.fileId,
              ownerId: current.ownerId,
              name: current.name,
              uploadedById: data.uploadedById,
              versionNumber: current.versionNumber + 1,
              isLatest: true,
              ingestionStatus: data.ingestionStatus,
              createdAt: new Date(),
          },
      });

      await tx.messageAttachment.create({
          data: {
              entityType: AttachmentEntityType.COLLECTION,
              entityId: newItem.id,
              workspaceId: data.workspaceId,
              storageProvider: 'GCS',
              originalFilename: current.name,
              mimetype: data.mimeType,
              size: Number(data.fileSize),
              url: data.storageKey,
              uploadedByUserId: data.uploadedById,
              createdBy: data.uploadedById,
          },
      });

      return newItem;
  });
}
export function restoreItemVersionTx(self: CollectionRepository, currentItemId: string, targetVersionId: string) {
  return transaction(['CollectionItem'], 'restoreItemVersion: collection item latest-flag swap must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
      await tx.collectionItem.update({
          where: { id: currentItemId },
          data: { isLatest: false },
      });
      return await tx.collectionItem.update({
          where: { id: targetVersionId },
          data: { isLatest: true },
      });
  });
}
