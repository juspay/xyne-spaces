import { ConnectChannel, ConnectChannelMember } from '@prisma/client';
import { DatabaseClient } from '../database/client';
import { ConnectChannelRepository } from '../database/repositories/connectChannelRepository';
import { ConnectChannelMemberRepository } from '../database/repositories/connectChannelMemberRepository';
import { connectMemberSyncService } from './connectMemberSyncService';
import { logger } from '../utils/logger';

/**
 * Slack-Connect core service (Phase 1). Owns the two Zero-synced connect tables:
 * `connect_channel` (host↔guest links) and `connect_channel_member` (flat roster).
 *
 * This layer is called SERVER-SIDE only. In Phase 9 the invitation flow calls
 * `createConnectLink` + `addMember` on ACTIVE; until then you exercise it directly
 * (or seed rows by hand) to test the internals. See slack-connect-implementation-plan.md.
 */
export class ConnectChannelService {
  private db = DatabaseClient.getInstance();
  private links = new ConnectChannelRepository();
  private members = new ConnectChannelMemberRepository();

  /**
   * Mark a channel connect-capable (shows the invite UI). Orthogonal to scopeType.
   *
   * Pure, cheap, REVERSIBLE flag flip — no member backfill here. The `connect_channel_member`
   * shadow is only meaningful once another org actually connects, so it's backfilled in
   * `createConnectLink` (first connect), not on enable. See disableConnect for the reverse.
   */
  async enableConnect(channelId: string): Promise<void> {
    const channel = await this.db.channel.findUnique({
      where: { id: channelId },
      select: { scopeType: true },
    });
    
    if (!channel) throw new Error('Channel not found');
    if (channel.scopeType !== 'DEFAULT') {
      throw new Error('Only DEFAULT channels can be connect-enabled');
    }
    const pointerLink = await this.db.connectChannel.findFirst({
      where: { guestChannelId: channelId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (pointerLink) {
      throw new Error('A connect guest (pointer) channel cannot itself be connect-enabled');
    }
    await this.db.channel.update({
      where: { id: channelId },
      data: { isConnectEnabled: true },
    });
    logger.info(`[ConnectChannel] enabled connect on channel ${channelId}`);
  }

  /**
   * Turn connect back off. Allowed ONLY while no org is connected — there is no
   * disconnect/revoke flow yet (solution doc: `connect_channel.status = REVOKED` is
   * reserved for the future). Once any `connect_channel` exists, this throws and the UI
   * must grey the toggle out. Cleans up any speculative shadow rows (there shouldn't be
   * any pre-connect, but be safe).
   */
  async disableConnect(channelId: string): Promise<void> {
    const links = await this.links.findByHostChannel(channelId);
    const connected = links.filter((l) => l.status === 'ACTIVE');
    if (connected.length > 0) {
      throw new Error(
        `Cannot disable connect on ${channelId}: ${connected.length} org(s) are connected. Disconnect is not supported yet.`,
      );
    }
    await this.db.channel.update({
      where: { id: channelId },
      data: { isConnectEnabled: false },
    });
    await this.db.connectChannelMember.deleteMany({ where: { channelId } });
    logger.info(`[ConnectChannel] disabled connect on channel ${channelId}`);
  }

  /** Whether the UI should allow disabling connect (false once any org is connected). */
  async canDisableConnect(channelId: string): Promise<boolean> {
    const links = await this.links.findByHostChannel(channelId);
    return links.every((l) => l.status !== 'ACTIVE');
  }

  /**
   * Establish a link between a host channel and a guest workspace (born ACTIVE).
   * `hostWorkspaceId` is derived from the channel so callers can't mis-stamp it.
   * Idempotent-ish: the DB unique (hostChannelId, guestWorkspaceId) rejects duplicates —
   * callers that expect re-entry should check `findLink` first.
   */
  async createConnectLink(params: {
    hostChannelId: string;
    guestWorkspaceId: string;
    createdBy: string;
    guestChannelId?: string | null;
    /**
     * Skip the post-link `reconcile()` backfill. Reconcile tombstones any `connect_channel_member`
     * whose user is not a HOST `channel_participant` — correct for CHANNELS (guests are host
     * participants), but WRONG for cross-org DMs, whose foreign members are pointer participants only
     * and are seeded explicitly via the pointer mirror. Linking a 2nd guest org to a GroupDM would
     * otherwise tombstone the 1st org's members. DMs pass `true`.
     */
    skipReconcile?: boolean;
  }): Promise<ConnectChannel> {
    const channel = await this.db.channel.findUnique({
      where: { id: params.hostChannelId },
      select: { workspaceId: true, isConnectEnabled: true },
    });
    if (!channel) {
      throw new Error(`ConnectChannel: host channel ${params.hostChannelId} not found`);
    }
    if (channel.workspaceId === params.guestWorkspaceId) {
      throw new Error('ConnectChannel: guest workspace must differ from the host workspace');
    }
    if (!channel.isConnectEnabled) {
      // Enabling is a deliberate host action; surface the misuse rather than silently flipping it.
      throw new Error(
        `ConnectChannel: channel ${params.hostChannelId} is not connect-enabled (call enableConnect first)`,
      );
    }

    const link = await this.links.create({
      hostChannelId: params.hostChannelId,
      hostWorkspaceId: channel.workspaceId,
      guestWorkspaceId: params.guestWorkspaceId,
      guestChannelId: params.guestChannelId ?? null,
      createdBy: params.createdBy,
    });
    logger.info(
      `[ConnectChannel] linked host channel ${params.hostChannelId} ↔ guest ws ${params.guestWorkspaceId} (${link.id})`,
    );

    // First/every connect: backfill the host channel's existing participants into the
    // member shadow so the newly-connected org can reach them. Batched + idempotent, so
    // re-running for a 2nd/3rd guest org is cheap. Skipped for DMs (see `skipReconcile`).
    if (!params.skipReconcile) {
      await connectMemberSyncService.reconcile(params.hostChannelId);
    }

    return link;
  }

  findLink(hostChannelId: string, guestWorkspaceId: string): Promise<ConnectChannel | null> {
    return this.links.findByHostAndGuest(hostChannelId, guestWorkspaceId);
  }

  /** Orgs a channel is shared with. */
  listGuestWorkspaces(hostChannelId: string): Promise<ConnectChannel[]> {
    return this.links.findByHostChannel(hostChannelId);
  }

  /**
   * Add (or reactivate) a member of a connect channel. `userWorkspaceId` is resolved
   * from the user so the member's home org is recorded correctly (works cross-org
   * because user ids are globally unique).
   *
   * NOTE (Phase 1): resolves the user through the tenant-scoped client, so foreign-org
   * users only resolve once the ACL boundary is relaxed (Phase 4). Same-org adds work now.
   */
  async addMember(hostChannelId: string, userId: string): Promise<ConnectChannelMember> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { workspaceId: true },
    });
    if (!user) {
      throw new Error(`ConnectChannel: user ${userId} not found (or not resolvable in this scope)`);
    }
    return this.members.upsertActive(hostChannelId, userId, user.workspaceId);
  }

  /** Tombstone a member (leave). Row is kept so their past authorship still resolves. */
  async removeMember(hostChannelId: string, userId: string): Promise<void> {
    await this.members.markLeft(hostChannelId, userId);
    logger.info(`[ConnectChannel] member ${userId} left connect channel ${hostChannelId}`);
  }

  /** Rejoin — clears the tombstone (same path as add). */
  async rejoinMember(hostChannelId: string, userId: string): Promise<ConnectChannelMember> {
    return this.addMember(hostChannelId, userId);
  }

  /** Active roster of a connect channel. */
  listActiveMembers(hostChannelId: string): Promise<ConnectChannelMember[]> {
    return this.members.listActiveByChannel(hostChannelId);
  }

  /**
   * Slack-Connect DM reachability (§3C): can `userA` DM `userB`? True iff they share ≥1 ACTIVE
   * connect channel — an EXISTS over the `connect_channel_member` self-join (both sides
   * `leftAt IS NULL`). This is the eligibility gate for opening a cross-org DM. `connect_channel_member`
   * has no workspaceId column and is globally readable, so this resolves cross-org without extra scope.
   */
  async areReachable(userA: string, userB: string): Promise<boolean> {
    if (!userA || !userB || userA === userB) return false;
    const mine = await this.db.connectChannelMember.findMany({
      where: { userId: userA, leftAt: null },
      select: { channelId: true },
    });
    if (mine.length === 0) return false;
    const channelIds = mine.map((m) => m.channelId);
    const shared = await this.db.connectChannelMember.findFirst({
      where: { channelId: { in: channelIds }, userId: userB, leftAt: null },
      select: { id: true },
    });
    return Boolean(shared);
  }
}

export const connectChannelService = new ConnectChannelService();
