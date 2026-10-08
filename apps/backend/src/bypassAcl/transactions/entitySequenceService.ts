import { logger } from '@/utils/logger';
import { SequenceEntityType, EntitySequenceService, type MainPrismaTransaction } from '@/services/entitySequenceService';

export async function getNextProjectTicketSequence(tx: MainPrismaTransaction, projectId: string): Promise<number> {
    if (EntitySequenceService.isCommonProjectTicketSequenceEnabled()) {
      try {
        return await EntitySequenceService.getNextSequence(SequenceEntityType.PROJECT_TICKET, projectId);
      } catch (error) {
        logger.error(
          `[EntitySequenceService] Common DB ticket allocation failed for project ${projectId}; falling back to main DB:`,
          error
        );
      }
    }

    const project = await tx.project.update({
      where: { id: projectId },
      data: { ticketSequence: { increment: 1 } },
      select: { ticketSequence: true },
    });

    return project.ticketSequence;
  }

export async function getNextNamespaceTicketSequence(tx: MainPrismaTransaction, namespaceId: string): Promise<number> {
    if (EntitySequenceService.isCommonEntitySequenceEnabled()) {
      try {
        return await EntitySequenceService.getNextSequence(SequenceEntityType.NAMESPACE_TICKET, namespaceId);
      } catch (error) {
        logger.error(
          `[EntitySequenceService] Common DB namespace ticket allocation failed for namespace ${namespaceId}; falling back to main DB:`,
          error
        );
      }
    }

    const namespace = await tx.ticketNamespace.update({
      where: { id: namespaceId },
      data: { ticketSequence: { increment: 1 }, updatedAt: new Date() },
      select: { ticketSequence: true },
    });

    return namespace.ticketSequence;
  }
