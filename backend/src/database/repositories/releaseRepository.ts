import { DatabaseClient } from '@/database/client';
import { ReleaseChangeType, ReleaseEvent, Prisma, RCA, Impact, COE } from '@prisma/client';

const prisma = DatabaseClient.getInstance();

export type RCAWithRelations = RCA & {
	impacts: Impact[];
	coes: COE[];
	ticketTitle?: string;
};

type FetchRCAOptions = {
	includeImpacts?: boolean;
	includeCOEs?: boolean;
};

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

	async getRCAById(
		rcaId: string,
		options: FetchRCAOptions = {}
	): Promise<RCA | RCAWithRelations | null> {
		const { includeImpacts = false, includeCOEs = false } = options;

		const rca = await prisma.rCA.findUnique({
			where: { id: rcaId },
		});

		if (!rca) {
			return null;
		}

		const ticket = await prisma.ticket.findUnique({
			where: { id: rca.ticketId },
			select: { title: true },
		});

		if (!includeImpacts && !includeCOEs) {
			return { ...rca, ticketTitle: ticket?.title };
		}

		const result: RCAWithRelations = { ...rca, impacts: [], coes: [], ticketTitle: ticket?.title };

		if (includeImpacts) {
			result.impacts = await prisma.impact.findMany({
				where: { rcaId },
			});
		}

		if (includeCOEs) {
			result.coes = await prisma.cOE.findMany({
				where: { rcaId },
			});
		}

		return result;
	}
}