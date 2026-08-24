import { Channel } from '@prisma/client';
import { ChannelScopeType, ChannelVisibility, ChannelRole } from '@xyne/shared';
import { db } from '../database/client';
import { ChannelRepository } from '../database/repositories/channelRepository';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { ProjectRepository } from '../database/repositories/projectRepository';
import { ConnectChannelRepository } from '../database/repositories/connectChannelRepository';
import { connectChannelService } from './connectChannelService';
import { runAsSystem } from '../database/tenant/context';
import { logger } from '../utils/logger';

/** A DM/GroupDM participant other than the initiator. */
export interface ConnectDmParticipant {
  userId: string;
  workspaceId: string;
}

/**
 * Slack-Connect — cross-org DM / GroupDM creation (§13).
 *
 * A cross-org DM/GroupDM is ITSELF a connect channel (`scopeType = DM | GROUP_DM`): the initiator's
 * workspace HOSTS the data, and each OTHER participant's org gets a GUEST POINTER channel + a
 * `connect_channel` link so the DM shows in their sidebar and their content reads flip pointer→host.
 * Reachability (a shared connect channel) already authorises it — no approval handshake.
 *
 * DM identity is the channel `name` (sorted participant userIds); cross-org peer names resolve because
 * the DM makes everyone `connect_channel_member`s, which the Zero users ACL (`connectCoMemberUserWhere`)
 * then loads into each other's directory.
 *
 * DEFERRED MATERIALISATION: the "New message" composer silently auto-creates a DM on every selection
 * change (debounced). To avoid littering guest orgs with a pointer per intermediate selection, a SILENT
 * create only makes the (hidden) host channel; the guest pointers/links/members are materialised lazily
 * on the DM's FIRST conversation (see `materializeForHostDmChannel`, called from the conversations
 * side-effect). A NON-silent create (explicit send) materialises immediately.
 */
export class ConnectDmService {
  private channels = new ChannelRepository();
  private participants = new ChannelParticipantRepository();
  private projects = new ProjectRepository();
  private links = new ConnectChannelRepository();

  private dmName(memberIds: string[]): string {
    return [...memberIds].sort().join(',');
  }

  /** Cross-org 1:1 DM (initiator hosts, one foreign partner). Idempotent. */
  async createCrossOrgOneToOneDm(params: {
    initiatorUserId: string;
    initiatorWorkspaceId: string;
    targetUserId: string;
    targetWorkspaceId: string;
    hideCreator?: boolean;
  }): Promise<{ channel: Channel; isExisting: boolean }> {
    return this.createCrossOrgConnectDm({
      initiatorUserId: params.initiatorUserId,
      initiatorWorkspaceId: params.initiatorWorkspaceId,
      scopeType: ChannelScopeType.DM,
      others: [{ userId: params.targetUserId, workspaceId: params.targetWorkspaceId }],
      hideCreator: params.hideCreator ?? false,
    });
  }

  /**
   * Cross-org GroupDM (initiator hosts). `others` may mix same-workspace participants (added as host
   * participants) and foreign participants (grouped by workspace → one guest pointer + link per org).
   */
  async createCrossOrgGroupDm(params: {
    initiatorUserId: string;
    initiatorWorkspaceId: string;
    others: ConnectDmParticipant[];
    hideCreator?: boolean;
  }): Promise<{ channel: Channel; isExisting: boolean }> {
    return this.createCrossOrgConnectDm({
      initiatorUserId: params.initiatorUserId,
      initiatorWorkspaceId: params.initiatorWorkspaceId,
      scopeType: ChannelScopeType.GROUP_DM,
      others: params.others,
      hideCreator: params.hideCreator ?? false,
    });
  }

  private async createCrossOrgConnectDm(params: {
    initiatorUserId: string;
    initiatorWorkspaceId: string;
    scopeType: ChannelScopeType.DM | ChannelScopeType.GROUP_DM;
    others: ConnectDmParticipant[];
    hideCreator: boolean;
  }): Promise<{ channel: Channel; isExisting: boolean }> {
    const { initiatorUserId, initiatorWorkspaceId, scopeType, others, hideCreator } = params;

    if (others.length === 0) {
      throw new Error('connectDm: at least one other participant is required');
    }
    if (!others.some((o) => o.workspaceId !== initiatorWorkspaceId)) {
      throw new Error('connectDm: no foreign participant — use the same-org DM flow');
    }

    const allMemberIds = [initiatorUserId, ...others.map((o) => o.userId)];
    const name = this.dmName(allMemberIds);

    // A SILENT create (composer auto-create, no message yet) defers guest materialisation to the DM's
    // first conversation; an explicit create materialises the guest side now.
    const materializeGuests = !hideCreator;

    // Dedup: existing DM by name (host in the initiator ws, or a pointer if the initiator is on the
    // guest side of a DM someone else hosted). Both probes resolve under workspace scope.
    const existing =
      scopeType === ChannelScopeType.DM
        ? await this.channels.getDMChannel(initiatorUserId, others[0].userId)
        : await this.channels.getGroupChannelByMembers(allMemberIds);
    if (existing) {
      if (materializeGuests) {
        await this.ensureConnectWiring(existing, initiatorWorkspaceId, name, scopeType, others).catch(
          (err) => logger.error(`[ConnectDm] ensureConnectWiring failed for ${existing.id}: ${err}`),
        );
      }
      return { channel: existing, isExisting: true };
    }

    // 1. Host channel in the initiator's workspace.
    const dmProjectId = await this.projects.getDMProjectId(initiatorWorkspaceId);
    if (!dmProjectId) {
      throw new Error('connectDm: DM project not found for initiator workspace');
    }
    const hostChannel = await this.channels.create({
      scopeType,
      name,
      visibility: ChannelVisibility.PRIVATE,
      createdBy: initiatorUserId,
      projectId: dmProjectId,
      workspaceId: initiatorWorkspaceId,
    });

    // 2. Mark connect-capable BEFORE adding members so the participant mirror writes their member rows.
    await connectChannelService.enableConnect(hostChannel.id);
    await this.participants.addParticipant(
      hostChannel.id,
      initiatorUserId,
      ChannelRole.ADMIN,
      hideCreator,
    );
    // Same-workspace participants (GroupDM only) join the host channel directly. Hidden alongside the
    // creator on a silent create; reopened for everyone by the first message.
    for (const o of others.filter((x) => x.workspaceId === initiatorWorkspaceId)) {
      await this.participants.addParticipant(hostChannel.id, o.userId, ChannelRole.MEMBER, hideCreator);
    }

    // 3. Guest pointers — now (explicit create) or deferred to the first conversation (silent create).
    if (materializeGuests) {
      await this.materializeForeignWorkspaces(hostChannel.id, name, scopeType, others, initiatorUserId);
    }

    logger.info(
      `[ConnectDm] created cross-org ${scopeType} ${hostChannel.id} (host ws ${initiatorWorkspaceId}, materializeGuests=${materializeGuests})`,
    );
    return { channel: hostChannel, isExisting: false };
  }

  /**
   * Lazily materialise the guest side of a connect DM once it becomes real (first conversation).
   * Idempotent + no-op unless the channel is a connect-enabled DM/GroupDM with foreign members that
   * don't yet have a `connect_channel` link. Derives members from the channel `name` (sorted userIds).
   * Called post-commit from the conversations side-effect, so it may create in foreign workspaces.
   */
  async materializeForHostDmChannel(hostChannelId: string): Promise<void> {
    // Reads run cross-org (host channel may live in another tenant than the side-effect's ambient
    // context; foreign members are hidden by the tenant users ACL) → resolve under system.
    const resolved = await runAsSystem(async () => {
      const channel = await db.channel.findUnique({
        where: { id: hostChannelId },
        select: { id: true, name: true, scopeType: true, isConnectEnabled: true, workspaceId: true, createdBy: true },
      });
      if (
        !channel ||
        !channel.isConnectEnabled ||
        (channel.scopeType !== ChannelScopeType.DM && channel.scopeType !== ChannelScopeType.GROUP_DM)
      ) {
        return null;
      }
      const memberIds = (channel.name ?? '').split(',').filter(Boolean);
      if (memberIds.length < 2) return null;

      const users = await db.user.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, workspaceId: true },
      });
      const others: ConnectDmParticipant[] = users
        .filter((u) => u.id !== channel.createdBy && u.workspaceId !== channel.workspaceId)
        .map((u) => ({ userId: u.id, workspaceId: u.workspaceId }));
      return { channel, others };
    });

    if (!resolved || resolved.others.length === 0) return;

    await this.materializeForeignWorkspaces(
      resolved.channel.id,
      resolved.channel.name ?? '',
      resolved.channel.scopeType as ChannelScopeType.DM | ChannelScopeType.GROUP_DM,
      resolved.others,
      resolved.channel.createdBy,
    );
  }

  /** Group foreign participants by workspace and materialise one guest pointer + link per org. */
  private async materializeForeignWorkspaces(
    hostChannelId: string,
    name: string,
    scopeType: ChannelScopeType.DM | ChannelScopeType.GROUP_DM,
    others: ConnectDmParticipant[],
    initiatorUserId: string,
  ): Promise<void> {
    const byWorkspace = new Map<string, string[]>();
    for (const o of others) {
      const list = byWorkspace.get(o.workspaceId) ?? [];
      list.push(o.userId);
      byWorkspace.set(o.workspaceId, list);
    }
    for (const [foreignWs, userIds] of byWorkspace) {
      const link = await this.links.findByHostAndGuest(hostChannelId, foreignWs);
      if (link) continue; // already materialised
      await this.materializeGuestPointer(hostChannelId, name, scopeType, foreignWs, userIds, initiatorUserId);
    }
  }

  /**
   * Materialise the guest side for ONE foreign workspace: a pointer `channels` row (same `name`), a
   * `connect_channel` link (guestChannelId = pointer), and each of that org's members as a pointer
   * participant (the mirror then writes their host member row). Runs under `runAsSystem` — writes into a
   * FOREIGN workspace with explicit workspaceId, ACL/stamp bypassed, and the post-commit participant
   * mirror can resolve the foreign users' home workspace.
   */
  private async materializeGuestPointer(
    hostChannelId: string,
    name: string,
    scopeType: ChannelScopeType.DM | ChannelScopeType.GROUP_DM,
    targetWorkspaceId: string,
    targetUserIds: string[],
    initiatorUserId: string,
  ): Promise<void> {
    await runAsSystem(async () => {
      const guestDmProjectId = await this.projects.getDMProjectId(targetWorkspaceId);
      if (!guestDmProjectId) {
        throw new Error('connectDm: DM project not found for target workspace');
      }
      const pointer = await this.channels.create({
        scopeType,
        name,
        visibility: ChannelVisibility.PRIVATE,
        createdBy: targetUserIds[0],
        projectId: guestDmProjectId,
        workspaceId: targetWorkspaceId,
      });

      await connectChannelService.createConnectLink({
        hostChannelId,
        guestWorkspaceId: targetWorkspaceId,
        createdBy: initiatorUserId,
        guestChannelId: pointer.id,
        // DM foreign members are pointer participants (not host participants) and are seeded via the
        // pointer mirror below; reconcile would tombstone a prior org's members when a 2nd org links.
        skipReconcile: true,
      });

      for (const uid of targetUserIds) {
        // HOST participant, HIDDEN status (isClosed) — gives the guest a host channel_user_status so
        // per-channel-state lookups (isMember for pins/links/files/tickets) resolve on the host, exactly
        // like a connect CHANNEL guest. It stays hidden from their sidebar (their visible entry is the
        // pointer below). skipReconcile keeps this from tombstoning a prior org's members.
        await this.participants.addParticipant(hostChannelId, uid, ChannelRole.MEMBER, true);
        // POINTER participant, VISIBLE — shows the DM in their sidebar.
        await this.participants.addParticipant(pointer.id, uid, ChannelRole.MEMBER, false);
      }
    });
  }

  /**
   * Idempotent repair for a DM that already exists: if the initiator hosts it but a foreign org has no
   * `connect_channel` link yet, materialise the missing pointer(s). If the initiator is on the guest
   * side, the DM is already fully wired by the original host.
   */
  private async ensureConnectWiring(
    channel: Channel,
    initiatorWorkspaceId: string,
    name: string,
    scopeType: ChannelScopeType.DM | ChannelScopeType.GROUP_DM,
    others: ConnectDmParticipant[],
  ): Promise<void> {
    if (channel.workspaceId !== initiatorWorkspaceId) return; // guest side already wired
    if (!channel.isConnectEnabled) {
      await connectChannelService.enableConnect(channel.id);
    }
    await this.materializeForeignWorkspaces(
      channel.id,
      name,
      scopeType,
      others.filter((o) => o.workspaceId !== initiatorWorkspaceId),
      channel.createdBy,
    );
  }
}

export const connectDmService = new ConnectDmService();
