import { Prisma, PrismaClient } from '@prisma/client';
import { OPEN_STATUSES } from '@/utils/etaNotificationUtils';

type StageOverdueDbClient = PrismaClient | Prisma.TransactionClient;
const OPEN_STATUS_SET = new Set<string>(OPEN_STATUSES);

export async function syncStageOverdueFlag(
  db: StageOverdueDbClient,
  ticketId: string,
  now: Date = new Date(),
): Promise<void> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      statusV2: true,
      isArchived: true,
      stageName: true,
      isStageOverdue: true,
    },
  });

  if (!ticket) return;

  let shouldBeOverdue = false;

  if (!ticket.isArchived && OPEN_STATUS_SET.has(ticket.statusV2)) {
    const activeStageEntry = await db.ticketStageEta.findFirst({
      where: {
        ticketId,
        stageLeftAt: null,
      },
      select: {
        stageEta: true,
        stage: {
          select: {
            name: true,
          },
        },
      },
    });

    shouldBeOverdue =
      activeStageEntry !== null &&
      activeStageEntry.stage.name === ticket.stageName &&
      activeStageEntry.stageEta <= now;
  }

  if (ticket.isStageOverdue === shouldBeOverdue) return;

  await db.ticket.update({
    where: { id: ticketId },
    data: {
      isStageOverdue: shouldBeOverdue,
    },
  });
}
