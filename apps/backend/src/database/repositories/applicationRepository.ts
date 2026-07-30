import { DatabaseClient } from '@/database/client';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import { logger } from '@framework';
import { TicketIdService } from '@/services/ticketIdService';

const prisma = DatabaseClient.getInstance();
import { Application } from '@prisma/client';
import { ActivityType, TicketPriority } from '@xyne/shared';
import { dualWriteTicketTag } from '@/services/ticketTagDualWriteService';

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
  async createApplicationReleaseTicketMappings(records: Array<{
    applicationReleaseId: string;
    releaseId: string;
    devTicketId: string;
    isHotfix?: boolean;
  }>): Promise<{ count: number }> {
    if (records.length === 0) return { count: 0 };

    // All ART rows for a release share the release's workspace; the dev ticket
    // carries the denormalized tenant key, so resolve it once and stamp it.
    const artWorkspaceId = await resolveWorkspaceIdFromModel(prisma, 'ticket', { id: records[0].devTicketId });

    const data = records.map(r => ({
      applicationReleaseId: r.applicationReleaseId,
      releaseId: r.releaseId,
      ticketId: r.devTicketId,
      isHotfix: r.isHotfix ?? false,
      workspaceId: artWorkspaceId,
    }));

    const result = await prisma.applicationReleaseTicket.createMany({
      data,
      skipDuplicates: true,
    });

    // skipDuplicates leaves existing rows untouched, so a dev ticket that first
    // appeared in a MAIN run (isHotfix=false) and is now confirmed a hotfix needs
    // an explicit flip. Only ever set true — a later main re-run must not unflag.
    const hotfixPairs = records
      .filter(r => r.isHotfix)
      .map(r => ({ applicationReleaseId: r.applicationReleaseId, ticketId: r.devTicketId }));
    if (hotfixPairs.length > 0) {
      await prisma.applicationReleaseTicket.updateMany({
        where: { OR: hotfixPairs },
        data: { isHotfix: true },
      });
    }

    logger.info(
      `Inserted ${result.count}/${data.length} ART row(s) for releaseId=${data[0]?.releaseId ?? 'unknown'} (${hotfixPairs.length} hotfix)`,
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
   * Idempotent: looks up existing SubTickets for `parentTicketId` first and reuses them.
   * Re-running commit analysis on the same release thus reuses the original SubTickets and
   * keeps QA assignment / test state intact, instead of producing parallel duplicates.
   */
  async createApplicationSubTickets(opts: {
    parentTicketId: string;
    parentTitle: string;
    projectId: string;
    channelId: string;
    conversationId: string;
    createdBy: string;
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
      affectedApplications,
      prLinksByApplication,
      isHotFix,
    } = opts;

    // ── Idempotency guard ─────────────────────────────────────────────────────
    // Re-running commit analysis must NOT keep creating new SubTickets — each
    // new SubTicket spawned a fresh applicationReleaseId, which bypassed the
    // (applicationReleaseId, ticketId) unique constraint on ART rows and led
    // to 3× duplicated Dev Tickets / Envs / Migrations after 3 re-runs.
    // Look up existing per-app SubTickets for this release and reuse them.
    const result = await this.findExistingApplicationSubTickets(
      parentTicketId,
      affectedApplications,
    );
    const missingApplications = affectedApplications.filter(app => !result.has(app.id));

    if (missingApplications.length === 0) {
      logger.info(
        `[ApplicationRepository] SubTickets already exist for all ${affectedApplications.length} apps on release=${parentTicketId} — skipping create`,
      );
      return result;
    }

    logger.info(
      `[ApplicationRepository] Creating sub-tickets for ${missingApplications.length} of ${affectedApplications.length} apps (${affectedApplications.length - missingApplications.length} already existed)`,
    );

    // Project workspace doesn't change per-app; resolve once outside the loop.
    const ticketWorkspaceId = await resolveWorkspaceIdFromModel(prisma, 'project', { id: projectId });

    for (const application of missingApplications) {
      if (!application.boardId) {
        logger.warn(`Application ${application.name} has no boardId, skipping ticket creation`);
        continue;
      }

      try {
        const txResult = await prisma.$transaction(async (tx) => {
          const xyneId = await TicketIdService.generateTicketId(tx, projectId);

          const prLinks = prLinksByApplication.get(application.id) || [];
          const prLinksSection = prLinks.length > 0
            ? `\n\nPull Requests:\n${prLinks.map(link => `- ${link}`).join('\n')}`
            : '';

          // Pick the application's release board's first stage (lowest
          // sequenceNumber) so the per-app ticket lands on the board's
          // configured first column instead of a hardcoded 'Release' label
          // that may not exist on the board.
          const firstStage = await tx.stage.findFirst({
            where: { boardId: application.boardId! },
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
              workspaceId: ticketWorkspaceId,
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
                workspaceId: ticketWorkspaceId,
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
              workspaceId: ticketWorkspaceId,
            },
          });

          await tx.ticketSubTicketMapping.create({
            data: { ticketId: parentTicketId, subTicketId: subTicket.id, workspaceId: ticketWorkspaceId },
          });

          await tx.ticketActivity.create({
            data: {
              ticketId: parentTicketId,
              workspaceId: ticketWorkspaceId,
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

        result.set(application.id, txResult);
        logger.info(`Created sub-ticket ${txResult.subTicketId}, ticket ${txResult.xyneId} (${txResult.mappedTicketId}) for application ${application.name}`);
      } catch (error) {
        logger.error(`Failed to create sub-ticket / application release for application ${application.name}:`, error as Error);
      }
    }

    return result;
  }

  /**
   * Look up existing SubTickets for a release ticket, keyed by applicationId.
   * Each Application has a unique `boardId` — we match the SubTicket's mapped
   * dev ticket boardId back to that to identify which app a SubTicket belongs to.
   */
  private async findExistingApplicationSubTickets(
    releaseTicketId: string,
    affectedApplications: Array<{ id: string; boardId: string | null }>,
  ): Promise<Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>> {
    const appByBoardId = new Map(
      affectedApplications.filter(app => !!app.boardId).map(app => [app.boardId!, app]),
    );
    const result = new Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>();
    if (appByBoardId.size === 0) return result;

    const mappings = await prisma.ticketSubTicketMapping.findMany({
      where: { ticketId: releaseTicketId },
      include: { subTicket: { include: { mappedTicket: true } } },
    });

    for (const mapping of mappings) {
      const mapped = mapping.subTicket.mappedTicket;
      if (!mapped) continue;
      const app = appByBoardId.get(mapped.boardId);
      if (!app || result.has(app.id)) continue;
      result.set(app.id, {
        subTicketId: mapping.subTicket.id,
        mappedTicketId: mapped.id,
        xyneId: mapped.xyneId,
      });
    }
    return result;
  }
}
