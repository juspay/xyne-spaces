import { PrismaClient } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

const TAG = '[TicketTagDualWrite]';

type PrismaLike = PrismaClient | Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Dual-write helper: writes to both ticket_tags (old) and
 * project_tags + ticket_tag_mappings (new) tables.
 *
 * Use this for all Prisma-direct tag writes (not Zero mutators —
 * those have their own dual-write in mutators.ts).
 */
export async function dualWriteTicketTag(
  ticketId: string,
  tagName: string,
  prisma: PrismaLike = db,
): Promise<void> {
  const ticket = await (prisma as PrismaClient).ticket.findUnique({
    where: { id: ticketId },
    select: { projectId: true, workspaceId: true },
  });

  if (!ticket?.projectId) {
    logger.warn(`${TAG} Ticket ${ticketId} has no projectId, skipping new table write`);
    return;
  }

  try {
    // Upsert project_tags (idempotent by unique projectId+name)
    const projectTag = await (prisma as PrismaClient).projectTag.upsert({
      where: { projectId_name: { projectId: ticket.projectId, name: tagName } },
      create: { name: tagName, projectId: ticket.projectId, workspaceId: ticket.workspaceId },
      update: {},
      select: { id: true },
    });

    // Insert ticket_tag_mapping (skip if already exists)
    await (prisma as PrismaClient).ticketTagMapping.createMany({
      data: [{ ticketId, tagId: projectTag.id, tagName, workspaceId: ticket.workspaceId }],
      skipDuplicates: true,
    });
  } catch (error) {
    logger.error(`${TAG} Failed to dual-write for ticket ${ticketId}, tag "${tagName}"`, {
      error: error,
    });
  }
}

/**
 * Batch dual-write: writes multiple tags for a ticket.
 */
export async function dualWriteTicketTags(
  ticketId: string,
  tagNames: string[],
  prisma: PrismaLike = db,
): Promise<void> {
  const ticket = await (prisma as PrismaClient).ticket.findUnique({
    where: { id: ticketId },
    select: { projectId: true, workspaceId: true },
  });

  if (!ticket?.projectId) {
    logger.warn(`${TAG} Ticket ${ticketId} has no projectId, skipping new table write`);
    return;
  }

  try {
    // Batch create project_tags
    await (prisma as PrismaClient).projectTag.createMany({
      data: tagNames.map(name => ({ name, projectId: ticket.projectId, workspaceId: ticket.workspaceId })),
      skipDuplicates: true,
    });

    // Fetch IDs
    const projectTags = await (prisma as PrismaClient).projectTag.findMany({
      where: { projectId: ticket.projectId, name: { in: tagNames } },
      select: { id: true, name: true },
    });
    const tagIdMap = new Map(projectTags.map(pt => [pt.name, pt.id]));

    // Batch create mappings
    const mappings = tagNames
      .map(name => {
        const tagId = tagIdMap.get(name);
        if (!tagId) return null;
        return { ticketId, tagId, tagName: name, workspaceId: ticket.workspaceId };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    if (mappings.length > 0) {
      await (prisma as PrismaClient).ticketTagMapping.createMany({
        data: mappings,
        skipDuplicates: true,
      });
    }
  } catch (error) {
    logger.error(`${TAG} Failed to batch dual-write for ticket ${ticketId}`, {
      error: error,
    });
  }
}

/**
 * Dual-delete: removes from ticket_tag_mappings when a ticket_tag is deleted.
 */
export async function dualDeleteTicketTag(
  ticketId: string,
  tagName: string,
  prisma: PrismaLike = db,
): Promise<void> {
  try {
    await (prisma as PrismaClient).ticketTagMapping.deleteMany({
      where: { ticketId, tagName },
    });
  } catch (error) {
    logger.error(`${TAG} Failed to dual-delete for ticket ${ticketId}, tag "${tagName}"`, {
      error: error,
    });
  }
}
