import { DatabaseClient } from '@/database/client';
import { ReleaseChangeType, ReleaseEvent, Prisma } from '@prisma/client';

const prisma = DatabaseClient.getInstance();


export class ReleaseRepository {
    async findReleaseChangeType(changeType: string, applicationId: string): Promise<ReleaseChangeType | null> {
        return await prisma.releaseChangeType.findFirst({
            where: { changeType, applicationId },
        });
    }

    async createReleaseEvent(input: Omit<Prisma.ReleaseEventCreateInput, 'id' | 'createdAt'>): Promise<ReleaseEvent> {
        return await prisma.releaseEvent.create({
            data: {
                releaseId: input.releaseId,
                applicationReleaseId: input.applicationReleaseId,
                eventType: input.eventType,
                eventName: input.eventName,
                message: input.message,
                userId: input.userId,
                userName: input.userName,
                channelId: input.channelId,
                conversationId: input.conversationId,
                payload: input.payload,
            },
        });
    }
}