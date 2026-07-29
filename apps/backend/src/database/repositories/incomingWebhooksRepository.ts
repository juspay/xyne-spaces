import { BaseRepository } from './base';
import { Prisma } from '@prisma/client';

export class IncomingWebhooksRepository extends BaseRepository<
  Prisma.AppIncomingWebhookGetPayload<{}>,
  Prisma.AppIncomingWebhookUncheckedCreateInput,
  Prisma.AppIncomingWebhookUpdateInput
> {
  constructor() {
    super('appIncomingWebhook');
  }

  async create(data: Prisma.AppIncomingWebhookUncheckedCreateInput) {
    return this.db.appIncomingWebhook.create({ data });
  }

  async findById(id: string) {
    return this.db.appIncomingWebhook.findUnique({ where: { id } });
  }

  async findByInstalledAppId(
    installedAppId: string,
    options?: { skip?: number; take?: number; activeOnly?: boolean },
  ) {
    const where = {
      installedAppId,
      ...(options?.activeOnly && { isActive: true }),
    };
    return this.db.appIncomingWebhook.findMany({
      where,
      include: {
        channel: { select: { name: true, visibility: true } },
        board: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...(options?.skip !== undefined && { skip: options.skip }),
      ...(options?.take !== undefined && { take: options.take }),
    });
  }

  async countByInstalledAppId(installedAppId: string, activeOnly?: boolean) {
    return this.db.appIncomingWebhook.count({
      where: { installedAppId, ...(activeOnly && { isActive: true }) },
    });
  }

  async findActiveByInstalledAppId(installedAppId: string) {
    return this.db.appIncomingWebhook.findMany({
      where: { installedAppId, isActive: true },
    });
  }

  async revoke(id: string, revokedBy: string) {
    return this.db.appIncomingWebhook.update({
      where: { id },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedBy,
      },
    });
  }

  async findMany(options?: {
    where?: Prisma.AppIncomingWebhookWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.AppIncomingWebhookOrderByWithRelationInput;
  }) {
    return this.db.appIncomingWebhook.findMany(options || {});
  }

  async update(id: string, data: Prisma.AppIncomingWebhookUpdateInput) {
    return this.db.appIncomingWebhook.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.db.appIncomingWebhook.delete({ where: { id } });
  }
}
