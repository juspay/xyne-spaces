import { BaseRepository } from './base';
import { ConnectRequest, Prisma } from '@prisma/client';
import { QueryOptions } from '@/types/database';
import { runAsSystem } from '@/database/tenant/context';

/**
 * Slack-Connect — the invite/approval handshake (`connect_request`, §11).
 *
 * Lives in the `non_zero` schema (REST-only, not Zero-synced) and intentionally spans workspaces
 * (host outbox + guest inbox + invitee-by-email), so reads run under `runAsSystem`. All non-cuid
 * columns (status, timestamps, gate stamps) are set in code — the DB has no defaults (house convention).
 */
export const CONNECT_REQUEST_STATUS = {
  AWAITING_HOST_ADMIN: 'AWAITING_HOST_ADMIN',
  AWAITING_GUEST: 'AWAITING_GUEST',
  AWAITING_GUEST_ADMIN: 'AWAITING_GUEST_ADMIN',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
} as const;
export type ConnectRequestStatus =
  (typeof CONNECT_REQUEST_STATUS)[keyof typeof CONNECT_REQUEST_STATUS];

/** Statuses where a request is still "live" (blocks a duplicate invite for the same (entity, email)). */
export const LIVE_CONNECT_REQUEST_STATUSES: ConnectRequestStatus[] = [
  CONNECT_REQUEST_STATUS.AWAITING_HOST_ADMIN,
  CONNECT_REQUEST_STATUS.AWAITING_GUEST,
  CONNECT_REQUEST_STATUS.AWAITING_GUEST_ADMIN,
];

export interface CreateConnectRequestInput {
  entityId: string;
  entityType?: string; // defaults to 'CHANNEL'
  hostWorkspaceId: string;
  invitedBy: string;
  inviteEmail: string;
  inviteToken: string;
}

export interface UpdateConnectRequestInput {
  status?: string;
  guestUserId?: string | null;
  guestWorkspaceId?: string | null;
  guestEntityConfig?: unknown;
  hostAdminApprovedBy?: string | null;
  hostAdminApprovedAt?: Date | null;
  guestAcceptedAt?: Date | null;
  guestAdminApprovedBy?: string | null;
  guestAdminApprovedAt?: Date | null;
  rejectedBy?: string | null;
  rejectedAt?: Date | null;
  expiresAt?: Date | null;
}

export class ConnectRequestRepository extends BaseRepository<
  ConnectRequest,
  CreateConnectRequestInput,
  UpdateConnectRequestInput
> {
  constructor() {
    super('connectRequest');
  }

  async create(data: CreateConnectRequestInput): Promise<ConnectRequest> {
    const now = new Date();
    return runAsSystem(() =>
      this.db.connectRequest.create({
        data: {
          entityId: data.entityId,
          entityType: data.entityType ?? 'CHANNEL',
          hostWorkspaceId: data.hostWorkspaceId,
          invitedBy: data.invitedBy,
          inviteEmail: data.inviteEmail,
          inviteToken: data.inviteToken,
          status: CONNECT_REQUEST_STATUS.AWAITING_HOST_ADMIN,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
  }

  async findById(id: string): Promise<ConnectRequest | null> {
    return runAsSystem(() => this.db.connectRequest.findUnique({ where: { id } }));
  }

  async findByInviteToken(inviteToken: string): Promise<ConnectRequest | null> {
    return runAsSystem(() => this.db.connectRequest.findUnique({ where: { inviteToken } }));
  }

  async findMany(_options?: QueryOptions): Promise<ConnectRequest[]> {
    return runAsSystem(() => this.db.connectRequest.findMany());
  }

  async update(id: string, data: UpdateConnectRequestInput): Promise<ConnectRequest> {
    const { guestEntityConfig, ...rest } = data;
    return runAsSystem(() =>
      this.db.connectRequest.update({
        where: { id },
        // No @updatedAt on the model — bump it explicitly on every update.
        data: {
          ...rest,
          ...(guestEntityConfig !== undefined
            ? { guestEntityConfig: guestEntityConfig as Prisma.InputJsonValue }
            : {}),
          updatedAt: new Date(),
        },
      }),
    );
  }

  async delete(id: string): Promise<ConnectRequest> {
    return runAsSystem(() => this.db.connectRequest.delete({ where: { id } }));
  }

  // ── inbox / outbox reads (all cross-org → runAsSystem) ───────────────────────

  /** Host-admin outbox: pending outbound intents for a host workspace. */
  async listHostOutbox(
    hostWorkspaceId: string,
    status: string = CONNECT_REQUEST_STATUS.AWAITING_HOST_ADMIN,
  ): Promise<ConnectRequest[]> {
    return runAsSystem(() =>
      this.db.connectRequest.findMany({
        where: { hostWorkspaceId, status },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /** Guest-admin inbox: requests awaiting a guest workspace's admin approval. */
  async listGuestAdminInbox(
    guestWorkspaceId: string,
    status: string = CONNECT_REQUEST_STATUS.AWAITING_GUEST_ADMIN,
  ): Promise<ConnectRequest[]> {
    return runAsSystem(() =>
      this.db.connectRequest.findMany({
        where: { guestWorkspaceId, status },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /** All requests for a channel/entity (any status) — for the channel's "pending invites" panel. */
  async listByEntity(entityId: string): Promise<ConnectRequest[]> {
    return runAsSystem(() =>
      this.db.connectRequest.findMany({
        where: { entityId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /** Is there already a live (in-flight) request for this (entity, email)? Used to block duplicates. */
  async findLiveByEntityAndEmail(
    entityId: string,
    inviteEmail: string,
  ): Promise<ConnectRequest | null> {
    return runAsSystem(() =>
      this.db.connectRequest.findFirst({
        where: { entityId, inviteEmail, status: { in: LIVE_CONNECT_REQUEST_STATUSES } },
      }),
    );
  }
}

export const connectRequestRepository = new ConnectRequestRepository();
