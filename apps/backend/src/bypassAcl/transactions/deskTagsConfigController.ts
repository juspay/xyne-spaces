import { transaction } from '../base';
import { db } from '@/database/client';
import { DESK_EMAIL_SOURCE_TYPE } from '@/tags';
import { TagServiceError } from '@/tags/service';
import { TagMethod } from '@xyne/shared';
import { advisoryXactLock } from '@/bypassAcl/lockServices';


export function addDeskEmailTagTx(emailId: string, category: string, tag: any, catConfig: any, workspaceId: string, configKey: string, userId: string) {
  return transaction(['Tag'], 'addDeskEmailTag: advisory lock plus duplicate check and tag insert must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    await advisoryXactLock(tx, ['Tag'],
      'desk tags: serialize concurrent manual tag adds for the same entity+category',
      `tag-add:${DESK_EMAIL_SOURCE_TYPE}:${emailId}:${category}`);

    const existing = await tx.tag.findFirst({
      where: { sourceId: emailId, sourceType: DESK_EMAIL_SOURCE_TYPE, tagCategory: category, tag, isDeleted: false },
    });
    if (existing) {
      throw new TagServiceError(
        `Active tag "${tag}" already exists for ${DESK_EMAIL_SOURCE_TYPE}/${emailId} in category "${category}"`,
        409,
      );
    }

    if (catConfig.count != null) {
      const current = await tx.tag.count({
        where: { sourceId: emailId, sourceType: DESK_EMAIL_SOURCE_TYPE, tagCategory: category, isDeleted: false },
      });
      if (current >= catConfig.count) {
        throw new TagServiceError(
          `Maximum tag count (${catConfig.count}) reached for category "${category}"`,
          400,
        );
      }
    }

    await tx.tag.create({
      data: {
        sourceId: emailId,
        sourceType: DESK_EMAIL_SOURCE_TYPE,
        workspaceId,
        configKey,
        tagCategory: category,
        tag,
        method: TagMethod.MANUAL,
        createdBy: userId,
        updatedBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
      },
    });
  });
}
