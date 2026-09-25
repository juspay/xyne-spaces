import type { SummaryTemplateAccessActivity } from '@/services/summaryTemplateSharingNotificationService';
import { EntityUserAccess, ShareableEntityType } from '@xyne/shared';
import { randomUUID } from 'node:crypto';
import { SummaryTemplateSharingService, SummaryTemplateSharingActor, SummaryTemplateSharingCommand, targetData } from '@/services/summaryTemplateSharingService';
import { transaction, type TableName } from '../base';
import { db } from '@/database/client';
import { Prisma } from '@prisma/client';

/**
 * Relocated from services/summaryTemplateSharingService.ts's runTransaction: serializable
 * transaction, retried on a write conflict (P2034). Deliberately NOT exported — only the named
 * operations in this file may use it, each passing its own tables and reason.
 */
async function runTransaction<T>(
  tables: TableName[],
  reason: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await transaction(tables, reason, db, operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const isWriteConflict = (error as { code?: string } | null)?.code === 'P2034';
      if (!isWriteConflict || attempt === 3) throw error;
    }
  }
  throw new Error('Summary template sharing transaction retry limit exceeded');
}

export function executeTx(self: SummaryTemplateSharingService, templateId: string, actor: SummaryTemplateSharingActor, command: SummaryTemplateSharingCommand) {
  return runTransaction(['Channel', 'EntityAccess', 'SummaryTemplate', 'User', 'UserGroup'], 'execute: summary-template share grants/revokes with template and target validation reads must commit atomically; tx is not ACL-wrapped', async (tx) => {
    const template = await self.loadManageableTemplate(tx, templateId, actor);
    const targets = [
      ...new Map(
        command.targets.map((target) => [`${target.type}:${target.id}`, target])
      ).values(),
    ];
    await self.validateTargets(tx, template, actor.workspaceId, targets);

    const changes: SummaryTemplateAccessActivity[] = [];
    for (const target of targets) {
      const existing = await self.findShare(tx, template.id, actor.workspaceId, target);
      if (command.action === 'grant') {
        const activated = !existing || existing.entityUserAccess === EntityUserAccess.REVOKED;
        const share = existing
          ? await tx.entityAccess.update({
              where: { id: existing.id },
              data: { entityUserAccess: EntityUserAccess.VIEW, updatedAt: new Date() },
            })
          : await tx.entityAccess.create({
              data: {
                id: randomUUID(),
                workspaceId: actor.workspaceId,
                shareableEntityType: ShareableEntityType.SUMMARY_TEMPLATE,
                entityId: template.id,
                entityUserAccess: EntityUserAccess.VIEW,
                updatedAt: new Date(),
                ...targetData(target),
              },
            });
        if (activated && target.type !== 'channel') {
          changes.push({ shareId: share.id, action: 'summary_template_shared' });
        }
        continue;
      }

      if (!existing || existing.entityUserAccess === EntityUserAccess.REVOKED) continue;
      const share = await tx.entityAccess.update({
        where: { id: existing.id },
        data: { entityUserAccess: EntityUserAccess.REVOKED, updatedAt: new Date() },
      });
      if (target.type !== 'channel') {
        changes.push({ shareId: share.id, action: 'summary_template_access_revoked' });
      }
    }
    return changes;
  });
}
