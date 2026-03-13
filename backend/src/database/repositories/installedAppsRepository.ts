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
}
