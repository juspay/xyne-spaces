import { UserPresence } from '@prisma/client';
import { BaseRepository } from './base';
import { QueryOptions } from '@/types/database';
import { UserPresenceStatus } from '@xyne/shared';

export interface CreateUserPresenceInput {
  userId: string;
  workspaceId: string;
  status?: string;
  lastActiveAt?: Date;
  lastSeenAt?: Date;
  isManual?: boolean;
  deviceInfo?: string | null;
  statusEmoji?: string | null;
  statusContent?: string | null;
  statusExpiryAt?: Date | null;
}

export interface UpdateUserPresenceInput {
  status?: string;
  lastActiveAt?: Date;
  lastSeenAt?: Date;
  isManual?: boolean;
  deviceInfo?: string | null;
  statusEmoji?: string | null;
  statusContent?: string | null;
  statusExpiryAt?: Date | null;
}

/** The custom-status fields mirrored from the users table. */
export interface PresenceStatusFields {
  statusEmoji: string | null;
  statusContent: string | null;
  statusExpiryAt: Date | null;
}

export class UserPresenceRepository extends BaseRepository<
  UserPresence,
  CreateUserPresenceInput,
  UpdateUserPresenceInput
> {
  constructor() {
    super('userPresence');
  }

  async create(data: CreateUserPresenceInput): Promise<UserPresence> {
    return this.db.userPresence.create({ data });
  }

  async findById(id: string): Promise<UserPresence | null> {
    return this.db.userPresence.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<UserPresence | null> {
    return this.db.userPresence.findUnique({ where: { userId } });
  }

  async findMany(options?: QueryOptions): Promise<UserPresence[]> {
    return this.db.userPresence.findMany({
      ...(options?.where ? { where: options.where } : {}),
      ...(options?.orderBy ? { orderBy: options.orderBy } : {}),
      ...(options?.skip !== undefined ? { skip: options.skip } : {}),
      ...(options?.take !== undefined ? { take: options.take } : {}),
    });
  }

  async update(id: string, data: UpdateUserPresenceInput): Promise<UserPresence> {
    return this.db.userPresence.update({ where: { id }, data });
  }

  async delete(id: string): Promise<UserPresence> {
    return this.db.userPresence.delete({ where: { id } });
  }

  /**
   * Writes the custom-status fields for a user, creating the presence row if the
   * user has never had one. Mirrors what the Zero `userPresence.upsert` mutator
   * writes, so the REST and Zero paths leave the same state behind.
   */
  async upsertStatusByUserId(
    userId: string,
    workspaceId: string,
    status: PresenceStatusFields,
    now: Date = new Date(),
  ): Promise<UserPresence> {
    return this.db.userPresence.upsert({
      where: { userId },
      update: {
        statusEmoji: status.statusEmoji,
        statusContent: status.statusContent,
        statusExpiryAt: status.statusExpiryAt,
        updatedAt: now,
      },
      create: {
        userId,
        workspaceId,
        status: UserPresenceStatus.OFFLINE,
        lastActiveAt: now,
        lastSeenAt: now,
        isManual: false,
        statusEmoji: status.statusEmoji,
        statusContent: status.statusContent,
        statusExpiryAt: status.statusExpiryAt,
      },
    });
  }
}
