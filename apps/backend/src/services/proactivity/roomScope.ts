import { DatabaseClient } from '@/database/client';

const prisma = DatabaseClient.getInstance();

/**
 * What a proactive agent run may read, for claw-auth's MCP boundary and its routing
 * cards. Asked as the agent's bot, with its own channel access.
 */

/** Something a proactive agent run wants to read, by the id it named. */
export type RoomRef =
  | { kind: 'channel'; id: string }
  | { kind: 'conversation'; id: string }
  | { kind: 'message'; id: string }
  | { kind: 'ticket'; id: string };

type ChannelRow = {
  id: string;
  workspaceId: string;
  visibility: string;
  scopeType: string;
  type: string;
};

const CHANNEL = {
  id: true,
  workspaceId: true,
  visibility: true,
  scopeType: true,
  type: true,
} as const;

const isPublic = (c: ChannelRow) =>
  c.visibility === 'PUBLIC' && c.scopeType === 'DEFAULT' && c.type === 'DEFAULT';

/** The channel a reference lives in. An ephemeral message is one person's, wherever it sits. */
async function channelOf(ref: RoomRef, workspaceId: string): Promise<ChannelRow | null> {
  switch (ref.kind) {
    case 'channel':
      return prisma.channel.findUnique({ where: { id: ref.id }, select: CHANNEL });
    case 'conversation':
      return (
        (
          await prisma.conversation.findUnique({
            where: { conversationId: ref.id },
            select: { channel: { select: CHANNEL } },
          })
        )?.channel ?? null
      );
    case 'message': {
      const message = await prisma.message.findUnique({
        where: { messageId: ref.id },
        select: { visibleTo: true, conversation: { select: { channel: { select: CHANNEL } } } },
      });
      return message && message.visibleTo === null ? (message.conversation?.channel ?? null) : null;
    }
    case 'ticket': {
      // A ticket key is only unique within a workspace.
      const tickets = await prisma.ticket.findMany({
        where: { workspaceId, OR: [{ id: ref.id }, { xyneId: ref.id }] },
        select: { channel: { select: CHANNEL } },
        take: 2,
      });
      return tickets.length === 1 ? (tickets[0].channel ?? null) : null;
    }
  }
}

/** Whether a guest can read the channel, as a member or through a guest grant. */
async function hasGuests(channelId: string): Promise<boolean> {
  const [member, grant] = await Promise.all([
    prisma.channelParticipant.findFirst({
      where: { channelId, user: { role: 'GUEST' } },
      select: { id: true },
    }),
    prisma.guestAccess.findFirst({
      where: { accessibleEntityType: 'CHANNEL', accessibleEntityId: channelId },
      select: { id: true },
    }),
  ]);
  return member !== null || grant !== null;
}

/**
 * Whether a proactive agent run answering in `roomChannelId` may read everything `refs`
 * names: each must be in the room, or in a public channel of the room's workspace, and
 * only the room itself when a guest is in it, since guests don't see public channels.
 * Asked as the run's bot, so a channel it can't see is simply not found: a no.
 */
export async function roomAllows(roomChannelId: string, refs: RoomRef[]): Promise<boolean> {
  if (refs.length === 0) return false;
  const room = await prisma.channel.findUnique({ where: { id: roomChannelId }, select: CHANNEL });
  if (!room) return false;
  const others = refs.filter((ref) => !(ref.kind === 'channel' && ref.id === roomChannelId));
  if (others.length === 0) return true;
  const publicAllowed = !(await hasGuests(roomChannelId));
  for (const ref of others) {
    const channel = await channelOf(ref, room.workspaceId);
    if (!channel || channel.workspaceId !== room.workspaceId) return false;
    if (channel.id !== roomChannelId && !(publicAllowed && isPublic(channel))) return false;
  }
  return true;
}

/** Which of these channels are public: what a routing card may learn from. */
export async function publicChannels(channelIds: string[]): Promise<string[]> {
  if (channelIds.length === 0) return [];
  const channels = await prisma.channel.findMany({
    where: { id: { in: channelIds } },
    select: CHANNEL,
  });
  return channels.filter(isPublic).map((c) => c.id);
}
