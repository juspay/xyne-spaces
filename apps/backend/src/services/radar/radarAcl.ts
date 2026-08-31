import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';

const prisma = DatabaseClient.getInstance();

interface AclAuth {
  userId: string;
  workspaceId: string;
}

export interface ChannelAccess {
  allowed: boolean;
  visibility: string;
}

/**
 * Radar is gated by the app's own conversation-access rule (see
 * websocketService.canAccessConversation): workspace match fail-closed, then
 * the parent channel's ACL. Being named on an item never widens access.
 *
 * Stricter in one respect: visibility is an ALLOW-list. `Channel.visibility`
 * is an unconstrained String, so a future value must fail CLOSED — Radar puts
 * many channels on one page, where fail-open costs far more than it does for a
 * single-thread subscription.
 */
const PUBLIC_VISIBILITY = 'PUBLIC';

export async function canAccessConversation(
  auth: AclAuth,
  conversationId: string,
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
  if (channel.workspaceId && channel.workspaceId !== auth.workspaceId) return false;
  if (channel.visibility === PUBLIC_VISIBILITY) return true;
  return repositories.channelParticipants.isParticipant(channelId, auth.userId);
}

/** Batch form for feed filtering: same rule, two queries instead of N. */
export async function viewerChannelAccess(
  auth: AclAuth,
  channelIds: string[],
): Promise<Map<string, ChannelAccess>> {
  const unique = [...new Set(channelIds)];
  if (unique.length === 0) return new Map();
  const channels = await prisma.channel.findMany({
    where: { id: { in: unique } },
    select: { id: true, workspaceId: true, visibility: true },
  });
  // Membership unlocks everything that is not PUBLIC, not just 'PRIVATE'.
  const gatedIds = channels.filter(c => c.visibility !== PUBLIC_VISIBILITY).map(c => c.id);
  const memberships = gatedIds.length
    ? await prisma.channelParticipant.findMany({
        where: { channelId: { in: gatedIds }, userId: auth.userId },
        select: { channelId: true },
      })
    : [];
  const memberOf = new Set(memberships.map(m => m.channelId));
  return new Map(
    channels.map(c => {
      const inWorkspace = !c.workspaceId || c.workspaceId === auth.workspaceId;
      const allowed =
        inWorkspace && (c.visibility === PUBLIC_VISIBILITY || memberOf.has(c.id));
      return [c.id, { allowed, visibility: c.visibility }];
    }),
  );
}
