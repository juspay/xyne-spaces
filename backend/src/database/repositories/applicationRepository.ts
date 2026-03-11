import { DatabaseClient } from '@/database/client';
import { logger } from '@framework';
import { TicketIdService } from '@/services/ticketIdService';

const prisma = DatabaseClient.getInstance();
import { Application } from '@prisma/client';
import { ActivityType, TicketPriority, TicketStatusV2 } from '@xyne/shared';

export class ApplicationRepository {

  /**
   * Find applications by project ID
   */
  async findByProjectId(projectId: string): Promise<Application[]> {
    return await prisma.application.findMany({
      where: { projectId },
    });
  }

  /**
   * Update deployed commit for multiple applications
   */
  async updateDeployedCommit(applicationIds: string[], commitId: string): Promise<{ count: number }> {
    const result = await prisma.application.updateMany({
      where: {
        id: { in: applicationIds },
      },
      data: {
        deployedCommit: commitId,
        lastDeployedAt: new Date(),
      },
    });
    return result;
  }

  /**
   * Find application by ID
   */
  async findById(id: string): Promise<Application | null> {
    return await prisma.application.findUnique({
      where: { id },
    });
  }

  /**
   * Create application release ticket mappings
   */
  async createApplicationReleaseTicketMappings(records: Array<{
    applicationReleaseId: string;
    ticketId: string;
    title: string;
    ticketUrl: string;
  }>): Promise<{ count: number }> {
    const result = await prisma.applicationReleaseTicket.createMany({
      data: records,
      skipDuplicates: true,
    });
    return result;
  }


  async getLatestDeployedCommitId(): Promise<string | null> {
    const application = await prisma.application.findFirst({
      where: {
        deployedCommit: { not: null },
        lastDeployedAt: { not: null },
      },
      select: {
        deployedCommit: true,
      },
      orderBy: {
        lastDeployedAt: 'desc',
      },
    });

    return application?.deployedCommit ?? null;
  }

  async createApplicationSubTickets(
    parentTicketId: string,
    parentXyneId: string,
    projectId: string,
    channelId: string,
    conversationId: string,
    createdBy: string,
    affectedApplications: (Application & { matchedFiles: string[] })[],
    prLinksByApplication: Map<string, string[]>,
    isHotFix?: boolean
  ): Promise<{ subTicketId: string, mappedTicketId: string, xyneId: string }[]> {
    logger.info(`Creating sub-tickets for ${affectedApplications.length} affected applications`);

    const subTicketIds: { subTicketId: string, mappedTicketId: string, xyneId: string }[] = [];

    for (const application of affectedApplications) {
      try {
        if (!application.boardId) {
          logger.warn(`Application ${application.name} has no boardId, skipping ticket creation`);
          continue;
        }

        const result = await prisma.$transaction(async (tx) => {
          const xyneId = await TicketIdService.generateTicketId(tx, projectId);

          const prLinks = prLinksByApplication.get(application.id) || [];
          const prLinksSection = prLinks.length > 0
            ? `\n\nPull Requests:\n${prLinks.map(link => `- ${link}`).join('\n')}`
            : '';

          // Create ticket in the application's board
          const ticket = await tx.ticket.create({
            data: {
              title: `${parentXyneId}: ${application.name}`,
              description: `Release ticket for ${application.name} application.${prLinksSection}`,
              createdBy,
              updatedBy: createdBy,
              conversationId,
              channelId,
              xyneId,
              projectId,
              boardId: application.boardId,
              statusV2: TicketStatusV2.TODO,
              priority: TicketPriority.LOW,
              stageName: 'Release',
            },
          });

          if (isHotFix) {
            await tx.ticketTag.create({
              data: {
                ticketId: ticket.id,
                name: 'HotFix',
              }
            })
          }

          // Create sub-ticket with mappedTicketId
          const subTicket = await tx.subTicket.create({
            data: {
              title: `${parentXyneId}: ${application.name}`,
              description: `Release sub-ticket for ${application.name} application.${prLinksSection}`,
              createdBy,
              updatedBy: createdBy,
              conversationId,
              mappedTicketId: ticket.id,
              assignedTo: null,
            },
          });

          await tx.ticketSubTicketMapping.create({
            data: {
              ticketId: parentTicketId,
              subTicketId: subTicket.id,
            },
          });

          await tx.ticketActivity.create({
            data: {
              ticketId: parentTicketId,
              updatedBy: createdBy,
              activityType: ActivityType.SUBTICKET_CREATED,
              value: {
                subTicketId: subTicket.id,
                subTicketTitle: subTicket.title,
                applicationName: application.name,
                applicationId: application.id,
                ticketId: ticket.id,
                ticketXyneId: xyneId,
              },
            },
          });

          return { subTicketId: subTicket.id, mappedTicketId: ticket.id, xyneId };
        });

        subTicketIds.push({ subTicketId: result.subTicketId, mappedTicketId: result.mappedTicketId, xyneId: result.xyneId });

        logger.info(`Created sub-ticket ${result.subTicketId} and ticket ${result.xyneId} (${result.mappedTicketId}) for application ${application.name}`);
      } catch (error) {
        logger.error(`Failed to create sub-ticket for application ${application.name}:`, error as Error);
      }
    }

    return subTicketIds;
  }
}