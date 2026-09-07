import type { SummaryTemplate } from '@prisma/client';
import { AccessType, SummaryTemplateVisibility } from '@xyne/shared';
import { db } from '@/database/client';

export type SummaryTemplatePublicationAction =
  | 'request'
  | 'publish'
  | 'withdraw'
  | 'approve'
  | 'deny'
  | 'unpublish';

export interface SummaryTemplatePublicationActor {
  userId: string;
  workspaceId: string;
}

export interface SummaryTemplatePublicationAdmin {
  id: string;
  name: string | null;
  email: string | null;
}

export class SummaryTemplatePublicationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = 'SummaryTemplatePublicationError';
  }
}

export class SummaryTemplatePublicationService {
  async getContext(actor: SummaryTemplatePublicationActor): Promise<{
    admins: SummaryTemplatePublicationAdmin[];
    isAdmin: boolean;
  }> {
    const admins = await this.getAdmins(actor.workspaceId);
    const isAdmin = admins.some((admin) => admin.id === actor.userId);
    return { admins, isAdmin };
  }

  async execute(
    templateId: string,
    actor: SummaryTemplatePublicationActor,
    action: SummaryTemplatePublicationAction
  ): Promise<SummaryTemplate & { canEdit: boolean; isSystem: false }> {
    const template = await db.summaryTemplate.findFirst({
      where: { id: templateId, workspaceId: actor.workspaceId },
    });
    if (!template) throw new SummaryTemplatePublicationError('Summary template not found', 404);

    const isOwner = template.createdBy === actor.userId;
    const isAdmin = await this.isAdmin(actor.workspaceId, actor.userId);
    let visibility: string;

    if (action === 'publish') {
      if (!isOwner || !isAdmin) {
        throw new SummaryTemplatePublicationError(
          'Only a Scribe admin can directly publish their template',
          403
        );
      }
      if (template.visibility !== SummaryTemplateVisibility.PRIVATE) {
        throw new SummaryTemplatePublicationError('Template is not private', 409);
      }
      visibility = SummaryTemplateVisibility.PUBLIC;
    } else if (action === 'request') {
      if (!isOwner) throw new SummaryTemplatePublicationError('Only the owner can publish it', 403);
      if (template.visibility !== SummaryTemplateVisibility.PRIVATE) {
        throw new SummaryTemplatePublicationError('Template is not private', 409);
      }
      if ((await this.getAdmins(actor.workspaceId)).length === 0) {
        throw new SummaryTemplatePublicationError('No Scribe admins are available', 409);
      }
      visibility = SummaryTemplateVisibility.WAITING_FOR_APPROVAL;
    } else if (action === 'unpublish') {
      // Reverses a publish. Allowed for the owner or any Scribe admin, mirroring who
      // could have made it public in the first place. Existing EntityAccess shares are
      // left intact, so explicitly shared recipients keep their access.
      if (!isOwner && !isAdmin) {
        throw new SummaryTemplatePublicationError(
          'Only the template owner or a Scribe admin can make it private',
          403
        );
      }
      if (template.visibility !== SummaryTemplateVisibility.PUBLIC) {
        throw new SummaryTemplatePublicationError('Template is not public', 409);
      }
      visibility = SummaryTemplateVisibility.PRIVATE;
    } else if (action === 'withdraw') {
      if (!isOwner)
        throw new SummaryTemplatePublicationError('Only the owner can withdraw it', 403);
      if (template.visibility !== SummaryTemplateVisibility.WAITING_FOR_APPROVAL) {
        throw new SummaryTemplatePublicationError('Template is not awaiting review', 409);
      }
      visibility = SummaryTemplateVisibility.PRIVATE;
    } else {
      if (!isAdmin) {
        throw new SummaryTemplatePublicationError('Scribe admin access is required', 403);
      }
      if (template.visibility !== SummaryTemplateVisibility.WAITING_FOR_APPROVAL) {
        throw new SummaryTemplatePublicationError('Template is not awaiting review', 409);
      }
      visibility =
        action === 'approve' ? SummaryTemplateVisibility.PUBLIC : SummaryTemplateVisibility.PRIVATE;
    }

    const updated = await db.summaryTemplate.update({
      where: { id: template.id },
      data: { visibility },
    });
    return { ...updated, canEdit: updated.createdBy === actor.userId, isSystem: false };
  }

  private async isAdmin(workspaceId: string, userId: string): Promise<boolean> {
    return (await this.getAdmins(workspaceId)).some((admin) => admin.id === userId);
  }

  private async getAdmins(workspaceId: string): Promise<SummaryTemplatePublicationAdmin[]> {
    const resource = await db.resource.findUnique({
      where: { name: 'SCRIBE' },
      select: { id: true },
    });
    if (!resource) return [];

    const grants = await db.resourceAccess.findMany({
      where: { workspaceId, resourceId: resource.id, accessType: AccessType.ADMIN },
      select: { userId: true, groupId: true },
    });
    const directIds = grants.flatMap((grant) => (grant.userId ? [grant.userId] : []));
    const groupIds = grants.flatMap((grant) => (grant.groupId ? [grant.groupId] : []));
    const mappings = groupIds.length
      ? await db.userGroupMapping.findMany({
          where: { workspaceId, userGroupId: { in: groupIds } },
          select: { userId: true },
        })
      : [];
    const userIds = [...new Set([...directIds, ...mappings.map((mapping) => mapping.userId)])];
    if (userIds.length === 0) return [];
    return db.user.findMany({
      where: { workspaceId, id: { in: userIds }, leftAt: null },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }, { id: 'asc' }],
    });
  }
}

export const summaryTemplatePublicationService = new SummaryTemplatePublicationService();
