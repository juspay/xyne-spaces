import { BaseRepository } from './base';
import { ConnectChannel } from '@prisma/client';
import { QueryOptions } from '@/types/database';

/**
 * Slack-Connect — established (host channel ↔ guest workspace) links.
 * See slack-connect-solution.md §1 and slack-connect-implementation-plan.md Phase 1.
 *
 * These tables carry no `workspaceId` column and intentionally span workspaces, so
 * the REST tenant extension treats them as UnscopedACL (see database/acl/acl-factory).
 * All non-cuid columns (status, createdAt, updatedAt) are set here in code — the DB
 * has no defaults for them (house convention).
 */
export interface CreateConnectChannelInput {
  hostChannelId: string;
  hostWorkspaceId: string;
  guestWorkspaceId: string;
  guestChannelId?: string | null;
  createdBy: string;
  /** Defaults to 'ACTIVE' when omitted. 'REVOKED' is reserved for a future disconnect feature. */
  status?: string;
}

export interface UpdateConnectChannelInput {
  guestChannelId?: string | null;
  status?: string;
}

export class ConnectChannelRepository extends BaseRepository<
  ConnectChannel,
  CreateConnectChannelInput,
  UpdateConnectChannelInput
> {
  constructor() {
    super('connectChannel');
  }

  async create(data: CreateConnectChannelInput): Promise<ConnectChannel> {
    const now = new Date();
    return this.db.connectChannel.create({
      data: {
        hostChannelId: data.hostChannelId,
        hostWorkspaceId: data.hostWorkspaceId,
        guestWorkspaceId: data.guestWorkspaceId,
        guestChannelId: data.guestChannelId ?? null,
        status: data.status ?? 'ACTIVE',
        createdBy: data.createdBy,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async findById(id: string): Promise<ConnectChannel | null> {
    return this.db.connectChannel.findUnique({ where: { id } });
  }

  async findMany(_options?: QueryOptions): Promise<ConnectChannel[]> {
    return this.db.connectChannel.findMany();
  }

  async update(id: string, data: UpdateConnectChannelInput): Promise<ConnectChannel> {
    // No @updatedAt on the model — bump it explicitly on every update.
    return this.db.connectChannel.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
  }

  async delete(id: string): Promise<ConnectChannel> {
    return this.db.connectChannel.delete({ where: { id } });
  }

  // ── domain-specific reads ────────────────────────────────────────────────

  /** The single link for a (host channel, guest org) pair, or null. Uses the unique index. */
  async findByHostAndGuest(
    hostChannelId: string,
    guestWorkspaceId: string,
  ): Promise<ConnectChannel | null> {
    return this.db.connectChannel.findUnique({
      where: { hostChannelId_guestWorkspaceId: { hostChannelId, guestWorkspaceId } },
    });
  }

  /** All guest orgs this channel is shared with (served by the unique index's leading column). */
  async findByHostChannel(hostChannelId: string): Promise<ConnectChannel[]> {
    return this.db.connectChannel.findMany({ where: { hostChannelId } });
  }

  /** Connect channels shared *with* a given guest org (default: active only). */
  async findByGuestWorkspace(
    guestWorkspaceId: string,
    status: string = 'ACTIVE',
  ): Promise<ConnectChannel[]> {
    return this.db.connectChannel.findMany({ where: { guestWorkspaceId, status } });
  }
}
