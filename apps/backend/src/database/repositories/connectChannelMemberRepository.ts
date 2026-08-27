import { BaseRepository } from './base';
import { ConnectChannelMember } from '@prisma/client';
import { QueryOptions } from '@/types/database';

/**
 * Slack-Connect — flat member index keyed by the HOST channel id.
 * Host + guest members live here together. `leftAt` is a tombstone: set on leave,
 * cleared on rejoin, row is KEPT (never deleted) so departed authors still resolve.
 * Reachability/membership reads filter `leftAt IS NULL`; resolution does not.
 * See slack-connect-solution.md §1/§3.
 */
export interface CreateConnectChannelMemberInput {
  /** = ConnectChannel.hostChannelId (the host channel). */
  channelId: string;
  userId: string;
  /** The member's home org (globally-unique cuid space, so this may differ from the host org). */
  userWorkspaceId: string;
}

export interface UpdateConnectChannelMemberInput {
  leftAt?: Date | null;
}

export class ConnectChannelMemberRepository extends BaseRepository<
  ConnectChannelMember,
  CreateConnectChannelMemberInput,
  UpdateConnectChannelMemberInput
> {
  constructor() {
    super('connectChannelMember');
  }

  async create(data: CreateConnectChannelMemberInput): Promise<ConnectChannelMember> {
    return this.db.connectChannelMember.create({
      data: {
        channelId: data.channelId,
        userId: data.userId,
        userWorkspaceId: data.userWorkspaceId,
        leftAt: null,
        createdAt: new Date(),
      },
    });
  }

  async findById(id: string): Promise<ConnectChannelMember | null> {
    return this.db.connectChannelMember.findUnique({ where: { id } });
  }

  async findMany(_options?: QueryOptions): Promise<ConnectChannelMember[]> {
    return this.db.connectChannelMember.findMany();
  }

  async update(
    id: string,
    data: UpdateConnectChannelMemberInput,
  ): Promise<ConnectChannelMember> {
    return this.db.connectChannelMember.update({ where: { id }, data });
  }

  async delete(id: string): Promise<ConnectChannelMember> {
    return this.db.connectChannelMember.delete({ where: { id } });
  }

  // ── domain-specific ──────────────────────────────────────────────────────

  /**
   * Add a member, or if the row already exists (including a departed one), reactivate
   * it by clearing `leftAt`. This is the single entry point for both join and rejoin.
   */
  async upsertActive(
    channelId: string,
    userId: string,
    userWorkspaceId: string,
  ): Promise<ConnectChannelMember> {
    return this.db.connectChannelMember.upsert({
      where: { channelId_userId: { channelId, userId } },
      update: { leftAt: null },
      create: { channelId, userId, userWorkspaceId, leftAt: null, createdAt: new Date() },
    });
  }

  /** Tombstone a member on leave (row kept for historical resolution). No-op if absent. */
  async markLeft(channelId: string, userId: string): Promise<void> {
    await this.db.connectChannelMember.updateMany({
      where: { channelId, userId },
      data: { leftAt: new Date() },
    });
  }

  async findMember(
    channelId: string,
    userId: string,
  ): Promise<ConnectChannelMember | null> {
    return this.db.connectChannelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
  }

  /** Active roster for a host channel (`leftAt IS NULL`). */
  async listActiveByChannel(channelId: string): Promise<ConnectChannelMember[]> {
    return this.db.connectChannelMember.findMany({
      where: { channelId, leftAt: null },
    });
  }

  /** Which connect channels a user is in — reachability (default: active only). */
  async listChannelsForUser(
    userId: string,
    activeOnly: boolean = true,
  ): Promise<ConnectChannelMember[]> {
    return this.db.connectChannelMember.findMany({
      where: { userId, ...(activeOnly ? { leftAt: null } : {}) },
    });
  }
}
