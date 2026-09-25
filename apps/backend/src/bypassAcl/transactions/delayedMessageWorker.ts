import { transaction } from '../base';
export function processJobTx(prisma: any, delayedMessageId: string, channelId: string, senderId: string) {
  return transaction(['Channel', 'ChannelParticipant', 'DelayedMessage'], 'processJob: delayed message claim plus channel and membership checks must commit atomically; tx is not ACL-wrapped', prisma, async (ptx: any) => {
    const msg = await ptx.delayedMessage.findUnique({ where: { id: delayedMessageId } });
    if (!msg) {
      return { kind: 'missing' as const };
    }
    if (msg.status === 'SENT' || msg.status === 'FAILED' || msg.status === 'CANCELLED') {
      return { kind: 'terminal' as const, status: msg.status };
    }

    await ptx.delayedMessage.update({
      where: { id: delayedMessageId },
      data: { status: 'SENDING' },
    });

    const channel = await ptx.channel.findUnique({ where: { id: channelId } });
    if (!channel || channel.isArchived) {
      const failureReason = 'Channel deleted';
      await ptx.delayedMessage.update({
        where: { id: delayedMessageId },
        data: { status: 'FAILED', failureReason },
      });
      return {
        kind: 'delivery_blocked' as const,
        failureReason,
        log: `[DelayedMessageWorker] Channel ${channelId} not found or archived – permanent failure for delayedMessageId=${delayedMessageId}`,
      };
    }

    const participant = await ptx.channelParticipant.findUnique({
      where: { channelId_userId: { channelId, userId: senderId } },
    });
    if (!participant) {
      const failureReason = 'Sender no longer has access';
      await ptx.delayedMessage.update({
        where: { id: delayedMessageId },
        data: { status: 'FAILED', failureReason },
      });
      return {
        kind: 'delivery_blocked' as const,
        failureReason,
        log: `[DelayedMessageWorker] Sender ${senderId} is no longer a member of channel ${channelId} – permanent failure for delayedMessageId=${delayedMessageId}`,
      };
    }

    return { kind: 'ready' as const };
  });
}
