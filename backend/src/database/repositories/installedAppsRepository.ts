import { BaseRepository } from './base';
import { Prisma } from '@prisma/client';

export class InstalledAppsRepository extends BaseRepository<
  Prisma.InstalledAppsGetPayload<{}>,
  Prisma.InstalledAppsUncheckedCreateInput,
  Prisma.InstalledAppsUpdateInput
> {
  constructor() {
    super('installedApps');
  }

  async create(data: Prisma.InstalledAppsUncheckedCreateInput) {
    return this.db.installedApps.create({ data });
  }

  async findById(id: string) {
    return this.db.installedApps.findUnique({ where: { id } });
  }

  async findMany(options?: { where?: Prisma.InstalledAppsWhereInput; skip?: number; take?: number; orderBy?: Prisma.InstalledAppsOrderByWithRelationInput }) {
    return this.db.installedApps.findMany(options || {});
  }

  async findFirst(options?: { where?: Prisma.InstalledAppsWhereInput; orderBy?: Prisma.InstalledAppsOrderByWithRelationInput }) {
    return this.db.installedApps.findFirst(options || {});
  }

  async findUnique(args: Prisma.InstalledAppsFindUniqueArgs) {
    return this.db.installedApps.findUnique(args);
  }

  async update(id: string, data: Prisma.InstalledAppsUpdateInput) {
    const dataWithUpdatedAt = {
      ...data,
      updatedAt: new Date(),
    };
    return this.db.installedApps.update({ where: { id }, data: dataWithUpdatedAt });
  }

  async delete(id: string) {
    return this.db.installedApps.delete({ where: { id } });
  }

  /**
   * Find installed apps with webhookUrl configured for given user IDs
   * @param userIds - Array of user IDs to search for
   * @returns Array of installed apps with webhookUrl configured
   */
  async findWithWebhooksByUserIds(userIds: string[]) {
    return this.db.installedApps.findMany({
      where: {
        userId: { in: userIds },
        webhookUrl: {
          not: null,
        },
        AND: [
          { webhookUrl: { not: '' } }
        ],
      },
      select: {
        appId: true,
        userId: true,
        webhookUrl: true,
        // signingSecret is app-level now — pulled via the relation.
        app: { select: { signingSecret: true } },
      },
    });
  }

  /**
   * Find all installed apps for a workspace (through user relation)
   * @param workspaceId - Workspace ID to search for
   * @returns Array of installed apps in the workspace
   */
  async findByWorkspaceId(workspaceId: string) {
    return this.db.installedApps.findMany({
      where: {
        user: {
          workspaceId,
        },
      },
      select: {
        id: true,
        appId: true,
        userId: true,
        webhookUrl: true,
        version: true, // installed version — gates the Update button (installed < latest)
      },
    });
  }
}
