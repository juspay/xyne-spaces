import { db } from '../database/client';
import { ConnectChannelMemberRepository } from '../database/repositories/connectChannelMemberRepository';
import { runAsSystem } from '../database/tenant/context';
import { logger } from '../utils/logger';

/**
 * Slack-Connect — keeps `connect_channel_member` a faithful shadow of a connect host
 * channel's `channel_participants` (solution doc §6, plan Phase 2).
 *
 * All three entry points are IDEMPOTENT and NO-OP for non-connect channels, so it is
 * safe to call them from every participant write path without coordination:
 *   - Zero mutator path → the `channel-participants` side-effect handler (post-commit)
 *   - REST/Prisma path  → `ChannelParticipantRepository` add/remove/batch/create/delete
 *
 * `leftAt` is a tombstone: removal sets it, re-add clears it, the row is never deleted
 * (departed authors must still resolve — §3). Reachability reads filter `leftAt IS NULL`.
 */
export class ConnectMemberSyncService {
  private members = new ConnectChannelMemberRepository();

  /** Cheap gate: only connect host channels maintain a member shadow. */
  private async isConnectHost(channelId: string): Promise<boolean> {
    // runAsSystem: this sync runs in whatever tenant context triggered the write (often the
    // GUEST's), but it must resolve HOST-workspace channels/users too. Without it, a cross-org
    // add can't resolve the foreign member and the shadow silently never updates.
    const channel = await runAsSystem(async () => {
      return await db.channel.findUnique({
        where: { id: channelId },
        select: { isConnectEnabled: true },
      });
    });
    return channel?.isConnectEnabled === true;
  }

  /**
   * Resolve the connect HOST channel a participant write on `channelId` should mirror to:
   *   - the channel itself if it is the connect host (isConnectEnabled), OR
   *   - the linked host if `channelId` is an ACTIVE guest POINTER channel.
   *
   * This lets a GUEST add/remove members on their own local pointer channel (a same-org
   * write with no cross-org friction) and still have it reflected in the host's shadow
   * `connect_channel_member`. Returns null for ordinary channels → mirror is a no-op.
   */
  private async resolveHostChannelId(channelId: string): Promise<string | null> {
    if (await this.isConnectHost(channelId)) return channelId;
    const link = await runAsSystem(async () => {
      return await db.connectChannel.findFirst({
        where: { guestChannelId: channelId, status: 'ACTIVE' },
        select: { hostChannelId: true },
      });
    });
    return link?.hostChannelId ?? null;
  }

  /**
   * Resolve a member's HOME workspace. `channel_participants.workspaceId` is the
   * channel's workspace (denormalized), NOT the user's home org, so we read it off the
   * user. runAsSystem so a FOREIGN-org member (e.g. a cross-org add / re-add via mention)
   * resolves regardless of the caller's tenant — without it the shadow never reactivates
   * for a departed cross-org user and they stay tombstoned though re-added as a participant.
   */
  private async resolveUserWorkspace(userId: string): Promise<string | null> {
    const user = await runAsSystem(async () => {
      return await db.user.findUnique({
        where: { id: userId },
        select: { workspaceId: true },
      });
    });
    return user?.workspaceId ?? null;
  }

  /** Participant added (on the host OR a guest pointer) → (re)activate the shadow row. */
  async mirrorParticipantAdded(channelId: string, userId: string): Promise<void> {
    const hostChannelId = await this.resolveHostChannelId(channelId);
    if (!hostChannelId) return;
    const userWorkspaceId = await this.resolveUserWorkspace(userId);
    if (!userWorkspaceId) {
      logger.warn(
        `[ConnectMemberSync] could not resolve home workspace for user ${userId} on connect channel ${hostChannelId} (via ${channelId}); shadow not updated`,
      );
      return;
    }
    // runAsSystem: this fires from the participant side-effect, which runs under WHOEVER triggered the
    // add (often the GUEST). The connect_channel_member write must not be scoped to that caller's
    // workspace — a foreign-org member's row would otherwise be silently dropped by the tenant ACL,
    // leaving a host participant with NO member row (the "count not increasing" bug). The `await` is
    // inside the callback so it executes in system scope (not a lazy scoped promise, §16).
    await runAsSystem(async () => {
      await this.members.upsertActive(hostChannelId, userId, userWorkspaceId);
    });
    // Enforce the canonical member SHAPE at this single choke point, so EVERY add path (tag/assign,
    // add-people dialog, host-side, invite/DM flows) produces the correct rows — no matter which
    // channelId or context it used (rulebook R1.2/R1.3):
    //   • host-workspace member → a normal VISIBLE host channel_participant.
    //   • guest-workspace member → a HIDDEN host channel_participant (so host-side mention/roster/ACL
    //     see them, no host sidebar dupe) AND a VISIBLE pointer participant (their own sidebar entry).
    await this.ensureMemberShape(hostChannelId, userId, userWorkspaceId);
    logger.info(`[ConnectMemberSync] +member ${userId} on connect channel ${hostChannelId} (via ${channelId})`);
  }

  /**
   * Idempotently bring `userId`'s participant rows to the canonical shape for a member of connect
   * host channel `hostChannelId`. Runs entirely under `runAsSystem` (cross-org reads/writes bypass
   * the tenant fence). Safe to call on every add regardless of how the member was added.
   */
  private async ensureMemberShape(
    hostChannelId: string,
    userId: string,
    userWorkspaceId: string,
  ): Promise<void> {
    await runAsSystem(async () => {
      const hostChannel = await db.channel.findUnique({
        where: { id: hostChannelId },
        select: { workspaceId: true },
      });
      if (!hostChannel) return;
      const hostWs = hostChannel.workspaceId;
      const isGuestMember = userWorkspaceId !== hostWs;
      const now = new Date();

      // ── HOST participant ──────────────────────────────────────────────────────────────────
      const hostParticipant = await db.channelParticipant.findUnique({
        where: { channelId_userId: { channelId: hostChannelId, userId } },
        select: { id: true },
      });
      if (!hostParticipant) {
        // Create it. Guest members are HIDDEN (isClosed) so the host workspace gets no sidebar dupe;
        // host members are visible like any normal participant.
        await db.channelParticipant.create({
          data: { channelId: hostChannelId, workspaceId: hostWs, userId, role: 'MEMBER' },
        });
        await db.channelUserStatus.upsert({
          where: { channelId_userId: { channelId: hostChannelId, userId } },
          update: isGuestMember ? { isClosed: true } : {},
          create: {
            channelId: hostChannelId,
            workspaceId: hostWs,
            userId,
            isClosed: isGuestMember,
            isStarred: false,
            lastViewedAt: now,
          },
        });
        await db.channelStats.upsert({
          where: { channelId: hostChannelId },
          update: { participantCount: { increment: 1 } },
          create: { channelId: hostChannelId, workspaceId: hostWs, participantCount: 1, lastActivityAt: now },
        });
        logger.info(`[ConnectMemberSync] +host participant ${userId} on ${hostChannelId} (hidden=${isGuestMember})`);
      } else if (isGuestMember) {
        // Participant already exists but may be VISIBLE (e.g. tag/assign add used the host id) — a
        // guest member MUST be hidden on the host. Force it (no-op if already hidden).
        await db.channelUserStatus.updateMany({
          where: { channelId: hostChannelId, userId, isClosed: false },
          data: { isClosed: true },
        });
      }

      // ── POINTER participant (guest members only) ──────────────────────────────────────────
      if (!isGuestMember) return;
      const link = await db.connectChannel.findFirst({
        where: { hostChannelId, guestWorkspaceId: userWorkspaceId, status: 'ACTIVE' },
        select: { guestChannelId: true },
      });
      const pointerId = link?.guestChannelId;
      if (!pointerId) return; // no pointer channel yet (e.g. pre-materialisation) — nothing to do
      const pointerParticipant = await db.channelParticipant.findUnique({
        where: { channelId_userId: { channelId: pointerId, userId } },
        select: { id: true },
      });
      if (pointerParticipant) return;
      await db.channelParticipant.create({
        data: { channelId: pointerId, workspaceId: userWorkspaceId, userId, role: 'MEMBER' },
      });
      // VISIBLE pointer status → the channel shows in the guest member's own sidebar.
      await db.channelUserStatus.upsert({
        where: { channelId_userId: { channelId: pointerId, userId } },
        update: {},
        create: {
          channelId: pointerId,
          workspaceId: userWorkspaceId,
          userId,
          isClosed: false,
          isStarred: false,
          lastViewedAt: now,
        },
      });
      await db.channelStats.upsert({
        where: { channelId: pointerId },
        update: { participantCount: { increment: 1 } },
        create: { channelId: pointerId, workspaceId: userWorkspaceId, participantCount: 1, lastActivityAt: now },
      });
      logger.info(`[ConnectMemberSync] +pointer participant ${userId} on ${pointerId}`);
    });
  }

  /** Participant removed (on the host OR a guest pointer) → tombstone the shadow row + tear down shape. */
  async mirrorParticipantRemoved(channelId: string, userId: string): Promise<void> {
    const hostChannelId = await this.resolveHostChannelId(channelId);
    if (!hostChannelId) return;
    // runAsSystem: same reason as mirrorParticipantAdded — the tombstone write must not be scoped to
    // whoever triggered the leave, or a foreign-org member's row won't be marked left.
    await runAsSystem(async () => {
      await this.members.markLeft(hostChannelId, userId);
    });
    // Symmetric to ensureMemberShape: whichever side triggered this leave (pointer OR host), tear
    // down the OTHER half of a guest member's shape — the HIDDEN host shadow AND the VISIBLE pointer
    // participant. Idempotent: the row the trigger already deleted is skipped. Never touches a real
    // (visible) host member.
    await this.removeMemberShape(hostChannelId, userId);
    logger.info(`[ConnectMemberSync] -member ${userId} on connect channel ${hostChannelId} (via ${channelId}) (tombstoned)`);
  }

  /**
   * Tear down a GUEST member's shape on both channels (host shadow + pointer participant), idempotently
   * and under `runAsSystem`. No-op for a host-workspace member (their own-channel removal is the normal
   * host delete). Only ever removes a HIDDEN host shadow — never a real visible host member.
   */
  private async removeMemberShape(hostChannelId: string, userId: string): Promise<void> {
    await runAsSystem(async () => {
      const [user, hostChannel] = await Promise.all([
        db.user.findUnique({ where: { id: userId }, select: { workspaceId: true } }),
        db.channel.findUnique({ where: { id: hostChannelId }, select: { workspaceId: true } }),
      ]);
      if (!user || !hostChannel) return;
      if (user.workspaceId === hostChannel.workspaceId) return; // host member — nothing extra to tear down

      // ── HIDDEN host shadow (remove only if present AND hidden) ──────────────────────────────
      const hostStatus = await db.channelUserStatus.findUnique({
        where: { channelId_userId: { channelId: hostChannelId, userId } },
        select: { isClosed: true },
      });
      if (hostStatus?.isClosed === true) {
        const hostParticipant = await db.channelParticipant.findUnique({
          where: { channelId_userId: { channelId: hostChannelId, userId } },
          select: { id: true },
        });
        await db.channelUserStatus.deleteMany({ where: { channelId: hostChannelId, userId } });
        if (hostParticipant) {
          await db.channelParticipant.delete({
            where: { channelId_userId: { channelId: hostChannelId, userId } },
          });
          await db.channelStats.updateMany({
            where: { channelId: hostChannelId, participantCount: { gt: 0 } },
            data: { participantCount: { decrement: 1 } },
          });
        }
        logger.info(`[ConnectMemberSync] -hidden host participant ${userId} on ${hostChannelId}`);
      }

      // ── VISIBLE pointer participant (remove if present) ─────────────────────────────────────
      const link = await db.connectChannel.findFirst({
        where: { hostChannelId, guestWorkspaceId: user.workspaceId, status: 'ACTIVE' },
        select: { guestChannelId: true },
      });
      const pointerId = link?.guestChannelId;
      if (!pointerId) return;
      const pointerParticipant = await db.channelParticipant.findUnique({
        where: { channelId_userId: { channelId: pointerId, userId } },
        select: { id: true },
      });
      if (!pointerParticipant) return;
      await db.channelUserStatus.deleteMany({ where: { channelId: pointerId, userId } });
      await db.channelParticipant.delete({
        where: { channelId_userId: { channelId: pointerId, userId } },
      });
      await db.channelStats.updateMany({
        where: { channelId: pointerId, participantCount: { gt: 0 } },
        data: { participantCount: { decrement: 1 } },
      });
      logger.info(`[ConnectMemberSync] -pointer participant ${userId} on ${pointerId}`);
    });
  }

  /**
   * Reconcile the shadow against `channel_participants` for one channel (backfill/repair):
   *   - every current participant → active shadow row
   *   - tombstoned shadow rows whose user is a participant again → reactivated
   *   - active shadow rows whose user is no longer a participant → tombstoned
   *
   * BATCHED — a fixed handful of queries regardless of participant count (a 100- or
   * 1000-member channel is fine). Safe to run repeatedly; no-op for non-connect channels.
   * This is the backfill invoked when an org first connects (see connectChannelService).
   */
  async reconcile(channelId: string): Promise<{ activated: number; tombstoned: number }> {
    if (!(await this.isConnectHost(channelId))) return { activated: 0, tombstoned: 0 };

    // runAsSystem on all reads: a HOST channel's participants/users must resolve even when
    // reconcile runs in the guest's tenant context (else foreign members are silently skipped).
    // 1 query: current participants.
    const participants = await runAsSystem(async () => {
      return await db.channelParticipant.findMany({
        where: { channelId },
        select: { userId: true },
      });
    });
    const participantIds = participants.map((p) => p.userId);
    const participantSet = new Set(participantIds);

    // 1 query: batch-resolve home workspaces (foreign-org users included, via runAsSystem).
    const users = participantIds.length
      ? await runAsSystem(async () => {
          return await db.user.findMany({
            where: { id: { in: participantIds } },
            select: { id: true, workspaceId: true },
          });
        })
      : [];
    const wsByUser = new Map(users.map((u) => [u.id, u.workspaceId]));

    // 1 query: existing shadow rows for this channel.
    const existing = await runAsSystem(async () => {
      return await db.connectChannelMember.findMany({
        where: { channelId },
        select: { userId: true, leftAt: true },
      });
    });
    const existingIds = new Set(existing.map((m) => m.userId));

    const now = new Date();

    // Insert brand-new members (1 query).
    const toInsert = participantIds.filter((id) => !existingIds.has(id) && wsByUser.has(id));
    if (toInsert.length) {
      await db.connectChannelMember.createMany({
        data: toInsert.map((userId) => ({
          channelId,
          userId,
          userWorkspaceId: wsByUser.get(userId)!,
          leftAt: null,
          createdAt: now,
        })),
        skipDuplicates: true,
      });
    }

    // Reactivate tombstoned members who are participants again (1 query).
    const toReactivate = existing
      .filter((m) => m.leftAt !== null && participantSet.has(m.userId))
      .map((m) => m.userId);
    if (toReactivate.length) {
      await db.connectChannelMember.updateMany({
        where: { channelId, userId: { in: toReactivate } },
        data: { leftAt: null },
      });
    }

    // Tombstone active shadow rows whose user is no longer a participant (1 query).
    const toTombstone = existing
      .filter((m) => m.leftAt === null && !participantSet.has(m.userId))
      .map((m) => m.userId);
    if (toTombstone.length) {
      await db.connectChannelMember.updateMany({
        where: { channelId, userId: { in: toTombstone } },
        data: { leftAt: now },
      });
    }

    const unresolved = participantIds.filter((id) => !wsByUser.has(id));
    if (unresolved.length) {
      logger.warn(
        `[ConnectMemberSync] reconcile ${channelId}: ${unresolved.length} unresolved (foreign-org?) user(s) skipped`,
      );
    }

    const activated = toInsert.length + toReactivate.length;
    logger.info(`[ConnectMemberSync] reconcile ${channelId}: activated=${activated} tombstoned=${toTombstone.length}`);
    return { activated, tombstoned: toTombstone.length };
  }
}

export const connectMemberSyncService = new ConnectMemberSyncService();
