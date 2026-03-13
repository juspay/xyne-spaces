import { BaseRepository } from './base';
import { Prisma } from '@prisma/client';

export interface CreateAppInput {
  name: string;
  description?: string;
  createdBy: string;
}

export class AppsRepository extends BaseRepository<
  Prisma.AppsGetPayload<{}>,
  Prisma.AppsUncheckedCreateInput,
  Prisma.AppsUpdateInput
> {
  constructor() {
    super('apps');
  }

  async create(data: Prisma.AppsUncheckedCreateInput) {
    return this.db.apps.create({ data });
  }

  /**
   * Create a new app with duplicate name validation
   */
  async createApp(data: CreateAppInput) {
    // Check if app with same name already exists (case-insensitive)
    const trimmedName = data.name.trim();
    const existingApps = await this.findMany({
      where: {
        name: {
          equals: trimmedName,
          mode: 'insensitive',
        },
      },
    });

    if (existingApps.length > 0) {
      throw new Error(`App with name '${data.name}' already exists.`);
    }

    // Create the app
    const now = new Date();
    const appData: Prisma.AppsUncheckedCreateInput = {
      name: data.name.trim(),
      description: data.description?.trim() || null,
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    return await this.create(appData);
  }

  async findById(id: string) {
    return this.db.apps.findUnique({ where: { id } });
  }

  async findMany(options?: { where?: Prisma.AppsWhereInput; skip?: number; take?: number; orderBy?: Prisma.AppsOrderByWithRelationInput }) {
    return this.db.apps.findMany(options || {});
  }

  async findUnique(args: Prisma.AppsFindUniqueArgs) {
    return this.db.apps.findUnique(args);
  }

  async update(id: string, data: Prisma.AppsUpdateInput) {
    const dataWithUpdatedAt = {
      ...data,
      updatedAt: new Date(),
    };
    return this.db.apps.update({ where: { id }, data: dataWithUpdatedAt });
  }

  async delete(id: string) {
    return this.db.apps.delete({ where: { id } });
  }
}
