import { DatabaseClient } from '@/database/client';
import { logger } from '@framework';
import { TicketIdService } from '@/services/ticketIdService';

const prisma = DatabaseClient.getInstance();
import { Application } from '@prisma/client';
import { ActivityType, TicketPriority } from '@xyne/shared';
import { dualWriteTicketTag } from '@/services/ticketTagDualWriteService';
import { runAsServiceActor } from '@/database/tenant/context';

export class ApplicationRepository {

  async findByMainReleaseBoardId(mainReleaseBoardId: string): Promise<Application[]> {
    return await prisma.application.findMany({
      where: { mainReleaseBoardId },
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
   * Create ART rows — one per (app SubTicket × dev ticket). `ticketId` stores
   * the dev ticket UUID; the Testing tab joins tickets via the `devTicket` Zero
   * relation (ticketId → tickets.id) for label/type/assignee, so we don't
   * snapshot those here. Dedup is handled by the @@unique([applicationReleaseId,
   * ticketId]) constraint via skipDuplicates.
   */
  async createApplicationReleaseTicketMappings(
    records: Array<{
      applicationReleaseId: string;
      releaseId: string;
      devTicketId: string;
    }>,
    initiatorWorkspaceId: string,
  ): Promise<{ count: number }> {
    if (records.length === 0) return { count: 0 };

    const devTicketIds = [...new Set(records.map(record => record.devTicketId))];
    const releaseIds = [...new Set(records.map(record => record.releaseId))];
    const subTicketIds = [...new Set(records.map(record => record.applicationReleaseId))];
    const [devTicketCount, releaseCount, subTicketCount] = await Promise.all([
      prisma.ticket.count({ where: { id: { in: devTicketIds }, workspaceId: initiatorWorkspaceId } }),
      prisma.ticket.count({ where: { id: { in: releaseIds }, workspaceId: initiatorWorkspaceId } }),
      prisma.subTicket.count({ where: { id: { in: subTicketIds }, workspaceId: initiatorWorkspaceId } }),
    ]);
    if (
      devTicketCount !== devTicketIds.length
      || releaseCount !== releaseIds.length
      || subTicketCount !== subTicketIds.length
    ) {
      throw new Error('Application release mappings contain targets outside the initiator workspace');
    }

    const data = records.map(r => ({
      applicationReleaseId: r.applicationReleaseId,
      releaseId: r.releaseId,
      ticketId: r.devTicketId,
      workspaceId: initiatorWorkspaceId,
    }));

    const result = await prisma.applicationReleaseTicket.createMany({
      data,
      skipDuplicates: true,
    });
    logger.info(
      `Inserted ${result.count}/${data.length} ART row(s) for releaseId=${data[0]?.releaseId ?? 'unknown'}`,
    );
    return result;
  }


  /** Latest deployed commit within one main release board group. */
  async getLatestDeployedCommitId(mainReleaseBoardId: string): Promise<string | null> {
    const application = await prisma.application.findFirst({
      where: {
        mainReleaseBoardId,
        deployedCommit: { not: null },
        lastDeployedAt: { not: null },
      },
      select: { deployedCommit: true },
      orderBy: { lastDeployedAt: 'desc' },
    });

    return application?.deployedCommit ?? null;
  }

  /**
   * Create per-app SubTickets + Tickets + TicketSubTicketMappings for a release.
   *
   * Returns a Map keyed by applicationId so callers don't have to maintain index alignment
   * with the input list (apps may be skipped if they have no boardId or transaction fails).
   *
   * On retry, this is called again with the same parentTicketId; new SubTickets/Tickets
   * are created for the retry's deploy event. Old ones remain as deploy-event history.
   * ART rows for the new deploy event will be written under the new SubTicket id.
   */
  async createApplicationSubTickets(opts: {
    parentTicketId: string;
    parentTitle: string;
    projectId: string;
    channelId: string;
    conversationId: string;
    createdBy: string;
    initiatorWorkspaceId: string;
    affectedApplications: (Application & { matchedFiles: string[] })[];
    prLinksByApplication: Map<string, string[]>;
    isHotFix?: boolean;
  }): Promise<Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>> {
    const {
      parentTicketId,
      parentTitle,
      projectId,
      channelId,
      conversationId,
      createdBy,
      initiatorWorkspaceId,
      affectedApplications,
      prLinksByApplication,
      isHotFix,
    } = opts;
    logger.info(`Creating sub-tickets for ${affectedApplications.length} affected applications`);

    // Authorize every parent supplied to the transaction against the initiator. Resolving the
    // workspace from a target id would only describe the target and would permit IDOR.
    const [project, parentTicket, channel, conversation] = await Promise.all([
      prisma.project.findFirst({ where: { id: projectId, workspaceId: initiatorWorkspaceId }, select: { id: true } }),
      prisma.ticket.findFirst({ where: { id: parentTicketId, workspaceId: initiatorWorkspaceId }, select: { id: true } }),
      prisma.channel.findFirst({ where: { id: channelId, workspaceId: initiatorWorkspaceId }, select: { id: true } }),
      prisma.conversation.findFirst({
        where: { conversationId, workspaceId: initiatorWorkspaceId },
        select: { conversationId: true },
      }),
    ]);
    if (!project || !parentTicket || !channel || !conversation) {
      throw new Error('Release targets are not accessible in the initiator workspace');
    }

    const result = new Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>();

    for (const application of affectedApplications) {
      if (application.workspaceId !== initiatorWorkspaceId) {
        throw new Error(`Application ${application.id} is not accessible in the initiator workspace`);
      }
      if (!application.boardId) {
        logger.warn(`Application ${application.name} has no boardId, skipping ticket creation`);
        continue;
      }

      try {
        const txResult = await runAsServiceActor(createdBy, initiatorWorkspaceId, () => prisma.$transaction(async (tx) => {
          const xyneId = await TicketIdService.generateTicketId(
            tx,
            projectId,
            initiatorWorkspaceId,
          );

          const prLinks = prLinksByApplication.get(application.id) || [];
          const prLinksSection = prLinks.length > 0
            ? `\n\nPull Requests:\n${prLinks.map(link => `- ${link}`).join('\n')}`
            : '';

          // Pick the application's release board's first stage (lowest
          // sequenceNumber) so the per-app ticket lands on the board's
          // configured first column instead of a hardcoded 'Release' label
          // that may not exist on the board.
          const firstStage = await tx.stage.findFirst({
            where: { boardId: application.boardId!, workspaceId: initiatorWorkspaceId },
            orderBy: { sequenceNumber: 'asc' },
            select: { name: true, defaultTicketStatusV2: true },
          });

          const ticket = await tx.ticket.create({
            data: {
              title: `${parentTitle} - ${application.name}`,
              description: `Release ticket for ${application.name} application.${prLinksSection}`,
              createdBy,
              updatedBy: createdBy,
              conversationId,
              channelId,
              xyneId,
              projectId,
              workspaceId: initiatorWorkspaceId,
              boardId: application.boardId,
              statusV2: firstStage?.defaultTicketStatusV2 ?? 'TODO',
              priority: TicketPriority.LOW,
              stageName: firstStage?.name ?? 'Backlog',
              lastEmailAt: new Date(),
            },
          });

          if (isHotFix) {
            await tx.ticketTag.create({
              data: {
                ticketId: ticket.id,
                name: 'HotFix',
                workspaceId: initiatorWorkspaceId,
              }
            })
            await dualWriteTicketTag(ticket.id, 'HotFix', tx);
          }

          const subTicket = await tx.subTicket.create({
            data: {
              title: `${parentTitle} - ${application.name}`,
              description: `Release sub-ticket for ${application.name} application.${prLinksSection}`,
              createdBy,
              updatedBy: createdBy,
              conversationId,
              mappedTicketId: ticket.id,
              assignedTo: null,
              workspaceId: initiatorWorkspaceId,
            },
          });

          await tx.ticketSubTicketMapping.create({
            data: { ticketId: parentTicketId, subTicketId: subTicket.id, workspaceId: initiatorWorkspaceId },
          });

          await tx.ticketActivity.create({
            data: {
              ticketId: parentTicketId,
              workspaceId: initiatorWorkspaceId,
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
        }));

        result.set(application.id, txResult);
        logger.info(`Created sub-ticket ${txResult.subTicketId}, ticket ${txResult.xyneId} (${txResult.mappedTicketId}) for application ${application.name}`);
      } catch (error) {
        logger.error(`Failed to create sub-ticket / application release for application ${application.name}:`, error as Error);
      }
    }

    return result;
  }
}
