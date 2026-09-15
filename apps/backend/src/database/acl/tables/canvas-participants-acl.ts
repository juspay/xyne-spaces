import { CanvasRole, CanvasVisibility } from '@xyne/shared';
import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleCanvasIds, isGuestContext } from './channel-access-helper'

export class CanvasParticipantsACL extends BaseQueryACL<
  Prisma.CanvasParticipantWhereInput,
  Prisma.CanvasParticipantUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasParticipantWhereInput | null> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const canvasIds = await getGuestAccessibleCanvasIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        workspaceId: ctx.workspaceId,
        OR: [
          { userId: this.ctx.userId },
          { canvasId: { in: canvasIds } },
        ],
      }
    }

    const userGroupMappings = await this.prisma.userGroupMapping.findMany({
      where: { userId: this.ctx.userId },
      select: { userGroupId: true },
    });
    const userGroupIds = userGroupMappings.map(mapping => mapping.userGroupId);

    const groupParticipantWhere = userGroupIds.length
      ? ({ userGroupId: { in: userGroupIds } } satisfies Prisma.CanvasParticipantWhereInput)
      : null;

    const channelMemberships = await this.prisma.channelParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { channelId: true },
    });
    const channelIds = channelMemberships.map(c => c.channelId);
    const channelParticipantWhere = channelIds.length
      ? ({ channelId: { in: channelIds } } satisfies Prisma.CanvasParticipantWhereInput)
      : null;

    // The PUBLIC arm below matches on canvas visibility alone, so without a
    // workspace term this clause would reach rows in other workspaces. The sync
    // layer applies the same scope structurally after every canSelect.
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { userId: this.ctx.userId },
        ...(groupParticipantWhere ? [groupParticipantWhere] : []),
        ...(channelParticipantWhere ? [channelParticipantWhere] : []),
        {
          canvas: {
            OR: [
              { createdBy: this.ctx.userId },
              { visibility: 'PUBLIC' },
              { participants: { some: { userId: this.ctx.userId } } },
              ...(groupParticipantWhere
                ? [
                    {
                      participants: {
                        some: groupParticipantWhere,
                      },
                    },
                  ]
                : []),
              ...(channelParticipantWhere
                ? [
                    {
                      participants: {
                        some: channelParticipantWhere,
                      },
                    },
                  ]
                : []),
            ],
          },
        },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.CanvasParticipantWhereInput> {
    const workspaceId = this.ctx.workspaceId;
    const mappings = await this.prisma.userGroupMapping.findMany({
      where: { userId: this.ctx.userId },
      select: { userGroupId: true },
    });
    const userGroupIds = mappings.map(m => m.userGroupId);
    const channelMemberships = await this.prisma.channelParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { channelId: true },
    });
    const channelIds = channelMemberships.map(c => c.channelId);

    const managerFilters: Prisma.CanvasParticipantWhereInput[] = [{ userId: this.ctx.userId }];
    if (userGroupIds.length) managerFilters.push({ userGroupId: { in: userGroupIds } });
    if (channelIds.length) managerFilters.push({ channelId: { in: channelIds } });

    return {
      workspaceId,
      OR: [
        { userId: this.ctx.userId },
        {
          canvas: {
            participants: {
              some: {
                role: { in: [CanvasRole.OWNER, CanvasRole.EDITOR] },
                OR: managerFilters,
              },
            },
          },
        },
      ],
    };
  }

  async canCreate(data: Prisma.CanvasParticipantUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false;
    const canvas = await this.prisma.canvas.findFirst({
      where: { id: data.canvasId, workspaceId: this.ctx.workspaceId },
      select: { visibility: true },
    });
    if (!canvas) {
      return data.userId === this.ctx.userId && data.role === CanvasRole.OWNER;
    }
    if (canvas.visibility === CanvasVisibility.PUBLIC) return true;

    const existing = await this.prisma.canvasParticipant.findFirst({
      where: { canvasId: data.canvasId },
      select: { id: true },
    });
    if (!existing) return true;

    const mappings = await this.prisma.userGroupMapping.findMany({
      where: { userId: this.ctx.userId },
      select: { userGroupId: true },
    });
    const userGroupIds = mappings.map(m => m.userGroupId);
    const channelMemberships = await this.prisma.channelParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { channelId: true },
    });
    const channelIds = channelMemberships.map(c => c.channelId);

    const roleFilters: Prisma.CanvasParticipantWhereInput[] = [{ userId: this.ctx.userId }];
    if (userGroupIds.length) roleFilters.push({ userGroupId: { in: userGroupIds } });
    if (channelIds.length) roleFilters.push({ channelId: { in: channelIds } });

    const effective = await this.prisma.canvasParticipant.findFirst({
      where: { canvasId: data.canvasId, OR: roleFilters },
      select: { id: true },
    });
    return effective !== null;
  }
}
