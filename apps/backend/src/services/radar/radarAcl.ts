import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { ChannelsACL } from '@/database/acl/tables/channels-acl';
import {
  getGuestAccessibleChannelIds,
  isGuestContext,
} from '@/database/acl/tables/channel-access-helper';

const prisma = DatabaseClient.getInstance();

/** Structurally an ACLContext, so radar can hand it straight to ChannelsACL. */
export interface AclAuth {
  userId: string;
  workspaceId: string;
  /** Workspace role. A GUEST sees only channels explicitly granted to them, so
   *  this is required: a caller that omits it would silently evaluate a guest
   *  under the member rule. */
  role: string;
}

export interface ChannelAccess {
  allowed: boolean;
  visibility: string;
}

/**
 * Radar is gated by the app's own channel rule (ChannelsACL): workspace match
 * fail-closed, then PUBLIC or participant for a member, explicit grants for a
 * guest. Being named on an item never widens access.
 *
 * Stricter in one respect: visibility is an ALLOW-list. `Channel.visibility`
 * is an unconstrained String, so a future value must fail CLOSED — Radar puts
 * many channels on one page, where fail-open costs far more than it does for a
 * single-thread subscription.
 */
const PUBLIC_VISIBILITY = 'PUBLIC';

/**
 * The channel read rule as a list of ids, for scoping a feed query up front —
 * a leading, indexable predicate where a relation filter through each item's
 * conversation would be probed per row.
 *
 * The rule itself is ChannelsACL's, not a second copy: radar must not drift
 * from what the sync layer says a viewer may open.
 */
export async function viewerAccessibleChannelIds(auth: AclAuth): Promise<string[]> {
  const channels = await prisma.channel.findMany({
    where: await new ChannelsACL(auth, prisma).getWhereClause(),
    select: { id: true },
  });
  return channels.map((c) => c.id);
}

export async function canAccessConversation(
  auth: AclAuth,
  conversationId: string
): Promise<boolean> {
  if (!conversationId) return false;
  const conversation = await repositories.conversations.findById(conversationId);
  if (!conversation) return false;
  if (conversation.workspaceId && conversation.workspaceId !== auth.workspaceId) return false;
  return canAccessChannel(auth, conversation.channelId);
}

/**
 * Prefer canAccessConversation where a conversationId exists: the conversation
 * row is authoritative, while an item's channelId is a creation-time stamp.
 */
export async function canAccessChannel(auth: AclAuth, channelId: string): Promise<boolean> {
  if (!channelId) return false;
  const channel = await repositories.channels.findById(channelId);
  if (!channel) return false;
  if (channel.workspaceId !== auth.workspaceId) return false;
  if (isGuestContext(auth)) {
    const ids = await getGuestAccessibleChannelIds(prisma, auth.workspaceId, auth.userId);
    return ids.includes(channelId);
  }
  if (channel.visibility === PUBLIC_VISIBILITY) return true;
  return repositories.channelParticipants.isParticipant(channelId, auth.userId);
}

/** Batch form for feed filtering: same rule, two queries instead of N. */
export async function viewerChannelAccess(
  auth: AclAuth,
  channelIds: string[],
  /** Guest grants the caller has already resolved. Without this a guest feed
   *  runs the grant lookup twice per request, in series. */
  grantedChannelIds?: string[]
): Promise<Map<string, ChannelAccess>> {
  const unique = [...new Set(channelIds)];
  if (unique.length === 0) return new Map();
  const channels = await prisma.channel.findMany({
    where: { id: { in: unique } },
    select: { id: true, workspaceId: true, visibility: true },
  });
  if (isGuestContext(auth)) {
    const granted = new Set(
      grantedChannelIds ??
        (await getGuestAccessibleChannelIds(prisma, auth.workspaceId, auth.userId))
    );
    return new Map(
      channels.map((c) => [
        c.id,
        {
          allowed: c.workspaceId === auth.workspaceId && granted.has(c.id),
          visibility: c.visibility,
        },
      ])
    );
  }
  // Membership unlocks everything that is not PUBLIC, not just 'PRIVATE'.
  const gatedIds = channels.filter((c) => c.visibility !== PUBLIC_VISIBILITY).map((c) => c.id);
  const memberships = gatedIds.length
    ? await prisma.channelParticipant.findMany({
        where: { channelId: { in: gatedIds }, userId: auth.userId },
        select: { channelId: true },
      })
    : [];
  const memberOf = new Set(memberships.map((m) => m.channelId));
  return new Map(
    channels.map((c) => {
      const allowed =
        c.workspaceId === auth.workspaceId &&
        (c.visibility === PUBLIC_VISIBILITY || memberOf.has(c.id));
      return [c.id, { allowed, visibility: c.visibility }];
    })
  );
}
