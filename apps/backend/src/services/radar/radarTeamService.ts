import { DatabaseClient } from '@/database/client';
import { RadarActionError } from '@/services/radar/radarManualActions';
import { viewerChannelAccess } from '@/services/radar/radarAcl';
import {
  FEED_SCAN_LIMIT,
  MAX_FEED_ITEMS,
  type FeedItem,
} from '@/services/radar/radarFeedService';

const prisma = DatabaseClient.getInstance();

const MAX_TEAM_MEMBERS = 25;
/** Users.status — deactivated accounts must not be assignable. */
const ACTIVE_USER_STATUS = 'ACTIVE';

interface AuthContext {
  userId: string;
  workspaceId: string;
}

export interface TeamFeedItem extends FeedItem {
  channelVisibility: string;
}

/**
 * Viewer-defined team lenses. A team is a personal named set of users; its
 * feed is every open item involving a member — whether or not the viewer is a
 * participant — but strictly narrowed by the VIEWER's channel access:
 *
 * - DM / group-DM threads are visible only to their own participants,
 * - PRIVATE channels only when the viewer is a channel participant,
 * - PUBLIC channels always (any workspace member could open the thread).
 *
 * Message-level privacy needs no filter here: visibleTo-restricted messages
 * never enter a radar window, so no item ever cites one. The lens can narrow
 * what the members' items show; it can never widen what the viewer may see.
 */
class RadarTeamService {
  async listTeams(auth: AuthContext) {
    return prisma.radarTeam.findMany({
      where: { workspaceId: auth.workspaceId, ownerId: auth.userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createTeam(auth: AuthContext, name: string, memberIds: string[]) {
    const unique = [...new Set(memberIds)];
    if (!name.trim()) throw new RadarActionError('bad-request', 'Team name is required');
    if (unique.length === 0) throw new RadarActionError('bad-request', 'Pick at least one member');
    if (unique.length > MAX_TEAM_MEMBERS) {
      throw new RadarActionError('bad-request', `At most ${MAX_TEAM_MEMBERS} members`);
    }
    const known = await prisma.user.count({
      where: { id: { in: unique }, workspaceId: auth.workspaceId, status: ACTIVE_USER_STATUS },
    });
    if (known !== unique.length) {
      throw new RadarActionError('bad-request', 'memberIds contains unknown users');
    }
    return prisma.radarTeam.create({
      data: {
        workspaceId: auth.workspaceId,
        ownerId: auth.userId,
        name: name.trim(),
        memberIds: unique,
      },
    });
  }

  async updateTeam(auth: AuthContext, teamId: string, name: string, memberIds: string[]) {
    const team = await prisma.radarTeam.findUnique({ where: { id: teamId } });
    if (!team || team.workspaceId !== auth.workspaceId || team.ownerId !== auth.userId) {
      throw new RadarActionError('not-found', 'Team not found');
    }
    const unique = [...new Set(memberIds)];
    if (!name.trim()) throw new RadarActionError('bad-request', 'Team name is required');
    if (unique.length === 0) throw new RadarActionError('bad-request', 'Pick at least one member');
    if (unique.length > MAX_TEAM_MEMBERS) {
      throw new RadarActionError('bad-request', `At most ${MAX_TEAM_MEMBERS} members`);
    }
    const known = await prisma.user.count({
      where: { id: { in: unique }, workspaceId: auth.workspaceId, status: ACTIVE_USER_STATUS },
    });
    if (known !== unique.length) {
      throw new RadarActionError('bad-request', 'memberIds contains unknown users');
    }
    return prisma.radarTeam.update({
      where: { id: teamId },
      data: { name: name.trim(), memberIds: unique },
    });
  }

  async deleteTeam(auth: AuthContext, teamId: string) {
    const team = await prisma.radarTeam.findUnique({ where: { id: teamId } });
    if (!team || team.workspaceId !== auth.workspaceId || team.ownerId !== auth.userId) {
      throw new RadarActionError('not-found', 'Team not found');
    }
    await prisma.radarTeam.delete({ where: { id: teamId } });
  }

  async teamFeed(auth: AuthContext, teamId: string): Promise<TeamFeedItem[]> {
    const team = await prisma.radarTeam.findUnique({ where: { id: teamId } });
    if (!team || team.workspaceId !== auth.workspaceId || team.ownerId !== auth.userId) {
      throw new RadarActionError('not-found', 'Team not found');
    }

    // "Between members" semantics: the union of every within-team pair (and
    // larger combinations) — requester is a member AND the ball sits with a
    // member. A member's ownerless ask (pendingOn: []) stays visible: it is
    // the member's open ask with no counterpart yet. An item between a member
    // and an outsider is NOT the team's business and stays out.
    const items = await prisma.executionItem.findMany({
      where: {
        workspaceId: auth.workspaceId,
        status: 'OPEN',
        AND: [
          { requestedBy: { hasSome: team.memberIds } },
          {
            OR: [
              { pendingOn: { hasSome: team.memberIds } },
              { pendingOn: { isEmpty: true } },
            ],
          },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      // Over-fetch, then cap AFTER the ACL filter — capping first lets items
      // the viewer can't see eat the budget and silently shorten the feed.
      take: FEED_SCAN_LIMIT,
      select: {
        id: true,
        conversationId: true,
        channelId: true,
        sourceMessageId: true,
        title: true,
        contextSummary: true,
        requestedBy: true,
        pendingOn: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (items.length === 0) return [];

    // Viewer's channel ACL — resolved from each item's conversation, not its
    // denormalized channelId stamp. Anything not PUBLIC requires membership.
    const conversations = await prisma.conversation.findMany({
      where: { conversationId: { in: [...new Set(items.map(i => i.conversationId))] } },
      select: { conversationId: true, channelId: true },
    });
    const channelByConversation = new Map(
      conversations.map(c => [c.conversationId, c.channelId]),
    );
    const access = await viewerChannelAccess(auth, [...channelByConversation.values()]);
    return items
      .filter(item => {
        const channelId = channelByConversation.get(item.conversationId);
        return channelId ? access.get(channelId)?.allowed : false;
      })
      .map(item => ({
        ...item,
        channelVisibility:
          access.get(channelByConversation.get(item.conversationId) ?? '')?.visibility ?? 'PUBLIC',
      }))
      .slice(0, MAX_FEED_ITEMS);
  }
}

export const radarTeamService = new RadarTeamService();
