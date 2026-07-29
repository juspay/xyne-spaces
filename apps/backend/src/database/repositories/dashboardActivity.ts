import { BaseRepository } from './base';
import type {
  DashboardActivity,
  CreateDashboardActivityInput,
  UpdateDashboardActivityInput,
  QueryOptions,
} from '@/types/database';

export class DashboardActivityRepository extends BaseRepository<
  DashboardActivity,
  CreateDashboardActivityInput,
  UpdateDashboardActivityInput
> {
  constructor() {
    super('dashboardActivity');
  }

  async create(data: CreateDashboardActivityInput): Promise<DashboardActivity> {
    return this.db.dashboardActivity.create({ data });
  }

  async findById(id: string): Promise<DashboardActivity | null> {
    return this.db.dashboardActivity.findUnique({ where: { id } });
  }

  // The hot query: events for one entity, newest first. Backed by the
  // composite index (entityType, entityId, createdAt DESC).
  async findForEntity(
    entityType: string,
    entityId: string,
    limit = 50,
  ): Promise<DashboardActivity[]> {
    return this.db.dashboardActivity.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // Recent activity feed scoped to a single user (audit view).
  async findByActor(
    actorUserId: string,
    limit = 50,
  ): Promise<DashboardActivity[]> {
    return this.db.dashboardActivity.findMany({
      where: { actorUserId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findMany(options?: QueryOptions): Promise<DashboardActivity[]> {
    const { skip, take, orderBy, where } = options ?? {};
    return this.db.dashboardActivity.findMany({ skip, take, orderBy, where });
  }

  async update(
    id: string,
    data: UpdateDashboardActivityInput,
  ): Promise<DashboardActivity> {
    return this.db.dashboardActivity.update({ where: { id }, data });
  }

  async delete(id: string): Promise<DashboardActivity> {
    return this.db.dashboardActivity.delete({ where: { id } });
  }
}
