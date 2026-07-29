import { Prisma } from '@prisma/client';

export async function syncTicketEmailCount(
  db: Prisma.TransactionClient,
  conversationId: string,
): Promise<void> {
  const count = await db.email.count({ where: { conversationId } });
  await db.ticket.updateMany({
    where: { conversationId },
    data: { emailCount: count },
  });
}
