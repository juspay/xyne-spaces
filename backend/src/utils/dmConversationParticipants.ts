import {
  ChannelScopeType,
  ConversationParticipation,
  type Prisma,
} from '@prisma/client';
import { db } from '@/database/client';

export async function ensureDmConversationAuthorParticipant({
  channelId,
  conversationId,
  senderId,
  scopeType,
  tx,
}: {
  channelId: string;
  conversationId: string;
  senderId: string;
  scopeType: ChannelScopeType;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  if (scopeType !== ChannelScopeType.DM && scopeType !== ChannelScopeType.GROUP_DM) {
    return;
  }

  const client = tx ?? db;

  const channel = await client.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: { workspaceId: true },
  });

  await client.conversationParticipant.upsert({
    where: {
      conversationId_userId: {
        conversationId,
        userId: senderId,
      },
    },
    create: {
      conversationId,
      userId: senderId,
      channelId,
      workspaceId: channel.workspaceId,
      participationType: ConversationParticipation.AUTHOR,
      isSubscribed: true,
    },
    update: {
      channelId,
      participationType: ConversationParticipation.AUTHOR,
      isSubscribed: true,
    },
  });
}
