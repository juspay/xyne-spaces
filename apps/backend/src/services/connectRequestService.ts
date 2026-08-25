import { createId } from '@paralleldrive/cuid2';
import { ConnectRequest } from '@prisma/client';
import { ChannelScopeType, ChannelVisibility, ChannelRole } from '@xyne/shared';
import { db } from '../database/client';
import {
  connectRequestRepository,
  CONNECT_REQUEST_STATUS,
} from '../database/repositories/connectRequestRepository';
import { ChannelRepository } from '../database/repositories/channelRepository';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { ProjectRepository } from '../database/repositories/projectRepository';
import { connectChannelService } from './connectChannelService';
import { runAsSystem } from '../database/tenant/context';
import { logger } from '../utils/logger';

/** Guest's captured channel config (survives rejection; used to materialize the pointer at ACTIVE). */
interface GuestEntityConfig {
  name?: string;
  visibility?: 'PUBLIC' | 'PRIVATE';
}

/**
 * Slack-Connect — the invite/approval state machine (§10/§11). Both admin gates are MANDATORY:
 *   AWAITING_HOST_ADMIN → AWAITING_GUEST → AWAITING_GUEST_ADMIN → ACTIVE   (REJECTED/EXPIRED off-ramps)
 *
 * The channel is already connect-enabled (host toggled it on) before an invite is created. On ACTIVE we
 * materialize the guest side (pointer channel + connect_channel link + connect_channel_member) — exactly
 * what was previously seeded by hand. All cross-workspace writes run under `runAsSystem`.
 */
export class ConnectRequestService {
  private repo = connectRequestRepository;
  private channels = new ChannelRepository();
  private participants = new ChannelParticipantRepository();
  private projects = new ProjectRepository();

  private readonly GUEST_ACCEPT_TTL_MS = 30 * 60 * 1000; // §11: only the email-acceptance step is timed

  // ── invite (host member/creator/admin who is a channel participant) ─────────
  async invite(params: {
    entityId: string;
    inviterUserId: string;
    inviterWorkspaceId: string;
    inviteEmail: string;
  }): Promise<ConnectRequest> {
    const email = params.inviteEmail.trim().toLowerCase();
    if (!email) throw new Error('inviteEmail is required');

    const channel = await runAsSystem(async () => {
      return await db.channel.findUnique({
        where: { id: params.entityId },
        select: { workspaceId: true, isConnectEnabled: true, name: true },
      });
    });
    if (!channel) throw new Error('Channel not found');
    if (channel.workspaceId !== params.inviterWorkspaceId) {
      throw new Error('You can only invite from your own workspace’s channel');
    }
    if (!channel.isConnectEnabled) {
      throw new Error('Turn on “Connect channel” for this channel before inviting external people');
    }
    const participant = await runAsSystem(async () => {
      return await db.channelParticipant.findUnique({
        where: { channelId_userId: { channelId: params.entityId, userId: params.inviterUserId } },
        select: { id: true },
      });
    });
    if (!participant) throw new Error('Only channel participants can invite external people');

    const live = await this.repo.findLiveByEntityAndEmail(params.entityId, email);
    if (live) {
      throw new Error('There is already a pending invitation for this email on this channel');
    }

    return this.repo.create({
      entityId: params.entityId,
      entityType: 'CHANNEL',
      hostWorkspaceId: params.inviterWorkspaceId,
      invitedBy: params.inviterUserId,
      inviteEmail: email,
      inviteToken: createId(),
    });
  }

  // ── host admin gate ─────────────────────────────────────────────────────────
  async hostAdminApprove(requestId: string, adminUserId: string): Promise<ConnectRequest> {
    const req = await this.requireStatus(requestId, CONNECT_REQUEST_STATUS.AWAITING_HOST_ADMIN);
    return this.repo.update(req.id, {
      status: CONNECT_REQUEST_STATUS.AWAITING_GUEST,
      hostAdminApprovedBy: adminUserId,
      hostAdminApprovedAt: new Date(),
      expiresAt: new Date(Date.now() + this.GUEST_ACCEPT_TTL_MS),
    });
  }

  // ── guest member accepts (via the emailed/dev link) ─────────────────────────
  async guestAccept(params: {
    token: string;
    guestUserId: string;
    guestEmail: string;
    guestWorkspaceId: string;
    guestEntityConfig: GuestEntityConfig;
  }): Promise<ConnectRequest> {
    const req = await this.repo.findByInviteToken(params.token);
    if (!req) throw new Error('Invitation not found');
    await this.assertNotExpired(req);
    if (req.status !== CONNECT_REQUEST_STATUS.AWAITING_GUEST) {
      throw new Error('This invitation is not awaiting acceptance');
    }
    if (req.inviteEmail.toLowerCase() !== params.guestEmail.toLowerCase()) {
      throw new Error(`This invitation is for ${req.inviteEmail}`);
    }
    if (params.guestWorkspaceId === req.hostWorkspaceId) {
      throw new Error('You cannot join a connect channel as its host workspace');
    }

    const guestMember = await runAsSystem(async () => {
      return await db.user.findFirst({
        where: {
          email: { equals: req.inviteEmail, mode: 'insensitive' },
          workspaceId: params.guestWorkspaceId,
          status: 'ACTIVE',
          leftAt: null,
        },
        select: { id: true },
      });
    });
    if (!guestMember) {
      logger.warn(
        `[guestAccept] membership miss: email=${req.inviteEmail} guestWorkspaceId=${params.guestWorkspaceId}`,
      );
      throw new Error('You are not an active member of the selected workspace');
    }
    const guestUserId = guestMember.id;

    // Already-linked org (§10): that org previously connected → org trust exists, skip the guest-admin
    // gate and just add this user as a member, straight to ACTIVE.
    const existingLink = await connectChannelService.findLink(req.entityId, params.guestWorkspaceId);
    if (existingLink) {
      await this.addGuestMemberToExistingConnect(
        existingLink.hostChannelId,
        existingLink.guestChannelId,
        guestUserId,
      );
      return this.repo.update(req.id, {
        status: CONNECT_REQUEST_STATUS.ACTIVE,
        guestUserId,
        guestWorkspaceId: params.guestWorkspaceId,
        guestEntityConfig: params.guestEntityConfig,
        guestAcceptedAt: new Date(),
        guestAdminApprovedAt: new Date(),
      });
    }

    return this.repo.update(req.id, {
      status: CONNECT_REQUEST_STATUS.AWAITING_GUEST_ADMIN,
      guestUserId,
      guestWorkspaceId: params.guestWorkspaceId,
      guestEntityConfig: params.guestEntityConfig,
      guestAcceptedAt: new Date(),
    });
  }

  // ── guest admin gate → ACTIVE + materialize ─────────────────────────────────
  async guestAdminApprove(requestId: string, adminUserId: string): Promise<ConnectRequest> {
    const req = await this.requireStatus(requestId, CONNECT_REQUEST_STATUS.AWAITING_GUEST_ADMIN);
    if (!req.guestUserId || !req.guestWorkspaceId) {
      throw new Error('Invitation has not been accepted by the guest yet');
    }
    await this.materializeConnectChannel(req);
    return this.repo.update(req.id, {
      status: CONNECT_REQUEST_STATUS.ACTIVE,
      guestAdminApprovedBy: adminUserId,
      guestAdminApprovedAt: new Date(),
    });
  }

  // ── reject (host admin / inviter while pending; or guest admin) ─────────────
  async reject(requestId: string, byUserId: string): Promise<ConnectRequest> {
    const req = await this.repo.findById(requestId);
    if (!req) throw new Error('Invitation not found');
    if (
      req.status === CONNECT_REQUEST_STATUS.ACTIVE ||
      req.status === CONNECT_REQUEST_STATUS.REJECTED ||
      req.status === CONNECT_REQUEST_STATUS.EXPIRED
    ) {
      throw new Error('This invitation can no longer be rejected');
    }
    return this.repo.update(req.id, {
      status: CONNECT_REQUEST_STATUS.REJECTED,
      rejectedBy: byUserId,
      rejectedAt: new Date(),
    });
  }

  // ── verify (public, for the accept page) ────────────────────────────────────
  async verify(token: string): Promise<{
    inviteEmail: string;
    status: string;
    channelName: string | null;
    channelVisibility: string | null;
    hostWorkspaceName: string | null;
  }> {
    const req = await this.repo.findByInviteToken(token);
    if (!req) throw new Error('Invitation not found');
    await this.assertNotExpired(req);

    const [channel, workspace] = await runAsSystem(async () => {
      return await Promise.all([
        db.channel.findUnique({
          where: { id: req.entityId },
          select: { name: true, visibility: true },
        }),
        db.workspace.findUnique({ where: { id: req.hostWorkspaceId }, select: { name: true } }),
      ]);
    });
    return {
      inviteEmail: req.inviteEmail,
      status: req.status,
      channelName: channel?.name ?? null,
      channelVisibility: channel?.visibility ?? null,
      hostWorkspaceName: workspace?.name ?? null,
    };
  }

  // ── reads for the workspace-management inboxes ──────────────────────────────
  listHostOutbox(hostWorkspaceId: string): Promise<ConnectRequest[]> {
    return this.repo.listHostOutbox(hostWorkspaceId);
  }
  listGuestAdminInbox(guestWorkspaceId: string): Promise<ConnectRequest[]> {
    return this.repo.listGuestAdminInbox(guestWorkspaceId);
  }
  listByEntity(entityId: string): Promise<ConnectRequest[]> {
    return this.repo.listByEntity(entityId);
  }
  findById(id: string): Promise<ConnectRequest | null> {
    return this.repo.findById(id);
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private async requireStatus(requestId: string, expected: string): Promise<ConnectRequest> {
    const req = await this.repo.findById(requestId);
    if (!req) throw new Error('Invitation not found');
    if (req.status !== expected) {
      throw new Error(`Invitation is not in the expected state (${req.status})`);
    }
    return req;
  }

  /** Lazily mark a past-expiry AWAITING_GUEST request EXPIRED (no cron for MVP). */
  private async assertNotExpired(req: ConnectRequest): Promise<void> {
    if (req.status === CONNECT_REQUEST_STATUS.REJECTED) {
      throw new Error('This invitation was rejected');
    }
    if (req.status === CONNECT_REQUEST_STATUS.EXPIRED) {
      throw new Error('This invitation has expired');
    }
    if (
      req.status === CONNECT_REQUEST_STATUS.AWAITING_GUEST &&
      req.expiresAt &&
      req.expiresAt.getTime() < Date.now()
    ) {
      await this.repo.update(req.id, { status: CONNECT_REQUEST_STATUS.EXPIRED });
      throw new Error('This invitation has expired');
    }
  }

  /**
   * ACTIVE side effects — materialize the guest side of a connect CHANNEL. All under `runAsSystem`
   * (cross-workspace writes, explicit workspaceId, ACL/stamp bypassed).
   *
   * The guest is added as a HOST `channel_participant` (the Phase-2 invariant so `reconcile` keeps them
   * across multi-org connects), but with a HIDDEN host `channel_user_status` (isClosed) so the host
   * channel doesn't double up in their sidebar — their VISIBLE entry is the pointer channel.
   */
  private async materializeConnectChannel(req: ConnectRequest): Promise<void> {
    const hostChannelId = req.entityId;
    const guestUserId = req.guestUserId!;
    const guestWorkspaceId = req.guestWorkspaceId!;
    const config = (req.guestEntityConfig as GuestEntityConfig | null) ?? {};

    // Idempotency guard: guestAdminApprove runs materialize THEN flips status→ACTIVE. If the status write
    // fails after materialize succeeded, an admin retry would re-run this and create a SECOND orphan pointer
    // channel (the createConnectLink unique would then also throw). If the link already exists, we're done.
    const alreadyLinked = await connectChannelService.findLink(hostChannelId, guestWorkspaceId);
    if (alreadyLinked) {
      logger.info(
        `[ConnectRequest] connect channel ${hostChannelId} ↔ ws ${guestWorkspaceId} already materialized; skipping`,
      );
      return;
    }

    await runAsSystem(async () => {
      const hostChannel = await db.channel.findUnique({
        where: { id: hostChannelId },
        select: { name: true },
      });
      if (!hostChannel) throw new Error('Host channel not found');

      // 1. Guest becomes a HOST participant (reconcile-safe) — hidden host status (no sidebar dupe).
      await this.participants.addParticipant(
        hostChannelId,
        guestUserId,
        ChannelRole.MEMBER,
        true /* isClosed → hidden host channel_user_status */,
      );

      // 2. Guest pointer channel in the guest workspace (visible in their sidebar).
      const guestProjectId = await this.projects.getDMProjectId(guestWorkspaceId);
      if (!guestProjectId) throw new Error('No default project found for the guest workspace');
      const pointer = await this.channels.create({
        scopeType: ChannelScopeType.DEFAULT,
        name: config.name?.trim() || hostChannel.name || 'connect-channel',
        visibility:
          config.visibility === 'PUBLIC' ? ChannelVisibility.PUBLIC : ChannelVisibility.PRIVATE,
        createdBy: guestUserId,
        projectId: guestProjectId,
        workspaceId: guestWorkspaceId,
      });
      await this.participants.addParticipant(
        pointer.id,
        guestUserId,
        ChannelRole.ADMIN,
        false /* visible → shows in the guest's sidebar */,
      );

      // 3. Link host ↔ guest pointer; reconcile backfills connect_channel_member from host participants
      //    (host-org members + the guest just added), so both sides can reach each other.
      await connectChannelService.createConnectLink({
        hostChannelId,
        guestWorkspaceId,
        createdBy: req.invitedBy,
        guestChannelId: pointer.id,
      });
    });

    logger.info(
      `[ConnectRequest] materialized connect channel ${hostChannelId} for guest ws ${guestWorkspaceId} (user ${guestUserId})`,
    );
  }

  /**
   * Guest's org is ALREADY linked to this channel (§10 "already linked" branch): no new link/pointer —
   * just add this user as a HOST participant (mirror + reconcile-safe → connect_channel_member).
   */
  private async addGuestMemberToExistingConnect(
    hostChannelId: string,
    guestPointerChannelId: string | null,
    guestUserId: string,
  ): Promise<void> {
    await runAsSystem(async () => {
      // Host participant (hidden) → reconcile-safe + connect_channel_member via mirror.
      await this.participants.addParticipant(hostChannelId, guestUserId, ChannelRole.MEMBER, true);
      // Also join the org's existing pointer channel (visible) so it shows in their sidebar.
      if (guestPointerChannelId) {
        await this.participants.addParticipant(
          guestPointerChannelId,
          guestUserId,
          ChannelRole.MEMBER,
          false,
        );
      }
    });
    logger.info(
      `[ConnectRequest] added guest ${guestUserId} to already-linked connect channel ${hostChannelId}`,
    );
  }
}

export const connectRequestService = new ConnectRequestService();
