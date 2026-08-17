import { randomUUID } from 'node:crypto';
import { Prisma, type EntityAccess, type SummaryTemplate } from '@prisma/client';
import { EntityUserAccess, ShareableEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import {
  summaryTemplateSharingNotificationService,
  type SummaryTemplateAccessActivity,
} from './summaryTemplateSharingNotificationService';

export type SummaryTemplateShareTarget =
  | { type: 'user'; id: string }
  | { type: 'user_group'; id: string }
  | { type: 'channel'; id: string };

export type SummaryTemplateSharingCommand =
  | { action: 'grant'; targets: SummaryTemplateShareTarget[] }
  | { action: 'revoke'; targets: SummaryTemplateShareTarget[] };

export interface SummaryTemplateSharingActor {
  userId: string;
  workspaceId: string;
}

export interface SummaryTemplateShareView {
  id: string;
  userId: string | null;
  userGroupId: string | null;
  channelId: string | null;
  entityUserAccess: string;
  user: { id: string; name: string | null; email: string | null } | null;
  userGroup: { id: string; name: string } | null;
  channel: { id: string; name: string } | null;
}

export class SummaryTemplateSharingError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'SummaryTemplateSharingError';
  }
}

const targetWhere = (target: SummaryTemplateShareTarget): Prisma.EntityAccessWhereInput =>
  target.type === 'user'
    ? { userId: target.id }
    : target.type === 'user_group'
      ? { userGroupId: target.id }
      : { channelId: target.id };

const targetData = (
  target: SummaryTemplateShareTarget
): { userId: string } | { userGroupId: string } | { channelId: string } =>
  target.type === 'user'
    ? { userId: target.id }
    : target.type === 'user_group'
      ? { userGroupId: target.id }
      : { channelId: target.id };

export class SummaryTemplateSharingService {
  async list(
    templateId: string,
    actor: SummaryTemplateSharingActor
  ): Promise<SummaryTemplateShareView[]> {
    await this.loadManageableTemplate(db, templateId, actor);
    const shares = await db.entityAccess.findMany({
      where: {
        workspaceId: actor.workspaceId,
        shareableEntityType: ShareableEntityType.SUMMARY_TEMPLATE,
        entityId: templateId,
        entityUserAccess: { not: EntityUserAccess.REVOKED },
        OR: [
          { userId: { not: null } },
          { userGroupId: { not: null } },
          { channelId: { not: null } },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });

    const [users, groups, channels] = await Promise.all([
      db.user.findMany({
        where: { id: { in: shares.flatMap((share) => (share.userId ? [share.userId] : [])) } },
        select: { id: true, name: true, email: true },
      }),
      db.userGroup.findMany({
        where: {
          id: { in: shares.flatMap((share) => (share.userGroupId ? [share.userGroupId] : [])) },
        },
        select: { id: true, name: true },
      }),
      db.channel.findMany({
        where: {
          id: { in: shares.flatMap((share) => (share.channelId ? [share.channelId] : [])) },
        },
        select: { id: true, name: true },
      }),
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

    return shares.map((share) => ({
      id: share.id,
      userId: share.userId,
      userGroupId: share.userGroupId,
      channelId: share.channelId,
      entityUserAccess: share.entityUserAccess,
      user: share.userId ? (usersById.get(share.userId) ?? null) : null,
      userGroup: share.userGroupId ? (groupsById.get(share.userGroupId) ?? null) : null,
      channel: share.channelId ? (channelsById.get(share.channelId) ?? null) : null,
    }));
  }

  async execute(
    templateId: string,
    actor: SummaryTemplateSharingActor,
    command: SummaryTemplateSharingCommand
  ): Promise<{
    action: SummaryTemplateSharingCommand['action'];
    shares: SummaryTemplateShareView[];
  }> {
    const activities = await this.runTransaction(async (tx) => {
      const template = await this.loadManageableTemplate(tx, templateId, actor);
      const targets = [
        ...new Map(
          command.targets.map((target) => [`${target.type}:${target.id}`, target])
        ).values(),
      ];
      await this.validateTargets(tx, template, actor.workspaceId, targets);

      const changes: SummaryTemplateAccessActivity[] = [];
      for (const target of targets) {
        const existing = await this.findShare(tx, template.id, actor.workspaceId, target);
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

    await summaryTemplateSharingNotificationService.publish(actor.userId, activities);
    return { action: command.action, shares: await this.list(templateId, actor) };
  }

  private async loadManageableTemplate(
    client: Prisma.TransactionClient | typeof db,
    templateId: string,
    actor: SummaryTemplateSharingActor
  ): Promise<SummaryTemplate> {
    const template = await client.summaryTemplate.findFirst({
      where: { id: templateId, workspaceId: actor.workspaceId },
    });
    if (!template) throw new SummaryTemplateSharingError('Summary template not found', 404);
    if (template.createdBy !== actor.userId) {
      throw new SummaryTemplateSharingError('Only the template creator can manage sharing', 403);
    }
    return template;
  }

  private async validateTargets(
    tx: Prisma.TransactionClient,
    template: SummaryTemplate,
    workspaceId: string,
    targets: SummaryTemplateShareTarget[]
  ): Promise<void> {
    for (const target of targets) {
      if (target.type === 'user') {
        if (target.id === template.createdBy) {
          throw new SummaryTemplateSharingError('The template owner already has access', 400);
        }
        const user = await tx.user.findFirst({
          where: { id: target.id, workspaceId, leftAt: null },
          select: { id: true },
        });
        if (!user) throw new SummaryTemplateSharingError('User not found in this workspace', 400);
      } else if (target.type === 'user_group') {
        const group = await tx.userGroup.findFirst({
          where: { id: target.id, workspaceId },
          select: { id: true },
        });
        if (!group) {
          throw new SummaryTemplateSharingError('User group not found in this workspace', 400);
        }
      } else {
        const channel = await tx.channel.findFirst({
          where: { id: target.id, workspaceId },
          select: { id: true },
        });
        if (!channel) {
          throw new SummaryTemplateSharingError('Channel not found in this workspace', 400);
        }
      }
    }
  }

  private findShare(
    tx: Prisma.TransactionClient,
    templateId: string,
    workspaceId: string,
    target: SummaryTemplateShareTarget
  ): Promise<EntityAccess | null> {
    return tx.entityAccess.findFirst({
      where: {
        workspaceId,
        shareableEntityType: ShareableEntityType.SUMMARY_TEMPLATE,
        entityId: templateId,
        ...targetWhere(target),
      },
    });
  }

  private async runTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await db.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const isWriteConflict = (error as { code?: string } | null)?.code === 'P2034';
        if (!isWriteConflict || attempt === 3) throw error;
      }
    }
    throw new Error('Summary template sharing transaction retry limit exceeded');
  }
}

export const summaryTemplateSharingService = new SummaryTemplateSharingService();
