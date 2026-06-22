import { personalizationSignalService } from './PersonalizationSignalService';
import { SignalType } from './types';
import { ChannelScopeType } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';

export interface MessageSignalContext {
    messageId: string;
    senderId: string;
    conversationId: string;
    channelId: string;
    mentionUserIds?: string[];
    channelScopeType?: ChannelScopeType;
    isReply?: boolean;
    replyCount?: number;
}

export class MessageSignalService {
    /**
     * Capture signals for a newly created message.
     
     */
    async captureCreateMessage(context: MessageSignalContext): Promise<void> {
        try {
            const redis = redisService.getClient();
            const key = `signal:msg:${context.messageId}`;
            // Atomic claim: returns null if key already exists (another pod already processed this message)
            const acquired = await redis.set(key, '1', 'EX', 3600, 'NX');
            if (!acquired) return;
            await this.processMessageSignals(context);
        } catch (error) {
            logger.error('[PERSONALIZATION] Failed to capture create message signals', {
                messageId: context.messageId,
                error: error instanceof Error ? error.message : error
            });
        }
    }


    private async processMessageSignals(context: MessageSignalContext): Promise<void> {
        const {
            messageId,
            senderId,
            conversationId,
            channelId,
            mentionUserIds,
            channelScopeType,
            replyCount = 0
        } = context;

        // Derive flags
        const isThreadReply = replyCount > 0;
        const isDM = channelScopeType === ChannelScopeType.DM;
        const isGroupDM = channelScopeType === ChannelScopeType.GROUP_DM;

        // 1. Capture channel interaction signal
        const channelSignalType = (isDM || isGroupDM)
            ? (isThreadReply ? SignalType.CHANNEL_DM_THREAD_REPLY : SignalType.CHANNEL_DM_MESSAGE_SENT)
            : (isThreadReply ? SignalType.CHANNEL_THREAD_REPLY : SignalType.CHANNEL_MESSAGE_SENT);

        personalizationSignalService.captureChannelSignalInBackground({
            userId: senderId,
            channelId: channelId,
            signalType: channelSignalType,
            metadata: {
                messageId,
                conversationId,
                isDM,
                isThreadReply
            }
        });

        // 2. If thread reply, capture USER_REPLIED_TO signal
        //    Currently we consider the first message users as the one to whom he is replying
        if (isThreadReply) {
            const parentMessage = await db.message.findFirst({
                where: { conversationId: conversationId },
                orderBy: { createdAt: 'asc' }
            });

            if (parentMessage && parentMessage.senderId !== senderId) {
                personalizationSignalService.captureUserSignalInBackground({
                    fromUserId: senderId,
                    toUserId: parentMessage.senderId,
                    signalType: SignalType.USER_REPLIED_TO,
                    metadata: {
                        messageId,
                        conversationId,
                        parentMessageId: parentMessage.messageId
                    }
                });
            }
        }

        // 3. If DM or Group DM, capture USER_DM_SENT signals (BIDIRECTIONAL)
        if (isDM || isGroupDM) {
            const participants = await db.channelParticipant.findMany({
                where: {
                    channelId: channelId,
                    userId: { not: senderId }
                }
            });

            if (participants.length > 0) {
                const dmSignals: any[] = [];

                for (const participant of participants) {
                    // Outbound: Sender -> Recipient
                    dmSignals.push({
                        fromUserId: senderId,
                        toUserId: participant.userId,
                        signalType: SignalType.USER_DM_SENT,
                        metadata: {
                            messageId,
                            conversationId,
                            channelId,
                            isGroupDM,
                            direction: 'outbound'
                        }
                    });

                    // Inbound: Recipient -> Sender
                    dmSignals.push({
                        fromUserId: participant.userId,
                        toUserId: senderId,
                        signalType: SignalType.USER_DM_RECEIVED,
                        metadata: {
                            messageId,
                            conversationId,
                            channelId,
                            isGroupDM,
                            direction: 'inbound'
                        }
                    });
                }

                personalizationSignalService.captureBatchInBackground(dmSignals);
            }
        }

        // 4. Capture user mention signals
        if (mentionUserIds && mentionUserIds.length > 0) {
            const mentionedSignals: any[] = [];
            for (const userId of mentionUserIds) {
                mentionedSignals.push(
                    // Sender mentions User
                    {
                        fromUserId: senderId,
                        toUserId: userId,
                        signalType: SignalType.USER_MENTIONED,
                        metadata: {
                            messageId,
                            conversationId,
                            channelId
                        }
                    },
                    // Mentioned User relevance to Channel
                    {
                        userId: userId,
                        channelId: channelId,
                        signalType: SignalType.CHANNEL_MENTIONED_IN,
                        metadata: {
                            messageId,
                            conversationId,
                            mentionedBy: senderId
                        }
                    }
                );
            }
            personalizationSignalService.captureBatchInBackground(mentionedSignals);
        }
    }
}

export const messageSignalService = new MessageSignalService();
