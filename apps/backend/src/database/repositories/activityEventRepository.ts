import { BaseRepository } from './base';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import { UserActivityEvent } from '@prisma/client';
import { QueryOptions } from '@/types/database';
import { CreateActivityEventInput } from '@xyne/shared';

export type { CreateActivityEventInput };

export interface UpdateActivityEventInput {
  // Activity events are immutable - this is for base class compatibility only
  contextMetadata?: Record<string, unknown>;
}

export class ActivityEventRepository extends BaseRepository<
  UserActivityEvent,
  CreateActivityEventInput,
  UpdateActivityEventInput
> {

    constructor() {
    super('userActivityEvent');
  }

  async findById(id: string): Promise<UserActivityEvent | null> {
    return await this.db.userActivityEvent.findUnique({
      where: { id },
    });
  }
  async findMany(_options?: QueryOptions): Promise<UserActivityEvent[]> {
      return [];
  }
  async update(id: string, data: UpdateActivityEventInput): Promise<UserActivityEvent> {
    return await this.db.userActivityEvent.update({
      where: { id },
      data: {
        contextMetadata: data.contextMetadata as Record<string,string>,
      },
    });
  }
  async delete(id: string): Promise<UserActivityEvent> {
    return await this.db.userActivityEvent.delete({
      where: { id },
    });
  }
  

  async create(data: CreateActivityEventInput): Promise<UserActivityEvent> {
    await this.validateString(data.userId, 'userId');
    await this.validateString(data.sessionId, 'sessionId');
    await this.validateString(data.eventCategory, 'eventCategory');
    await this.validateString(data.eventName, 'eventName');
    await this.validateString(data.url, 'url');

    const workspaceId = await resolveWorkspaceIdFromModel(this.db, 'user', { id: data.userId });

    return await this.db.userActivityEvent.create({
      data: {
        userId: data.userId,
        workspaceId,
        sessionId: data.sessionId,
        eventCategory: data.eventCategory,
        eventName: data.eventName,
        eventLabel: data.eventLabel,
        url: data.url,
        triggerType: data.triggerType ?? 'CLICK',
        contextMetadata: data.contextMetadata as Record<string,string>,
        platform: data.platform,
        timestamp: data.timestamp,
      },
    });
  }
}
