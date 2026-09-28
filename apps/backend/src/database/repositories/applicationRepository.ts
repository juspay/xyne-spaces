import { DatabaseClient } from '@/database/client';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import { logger } from '@framework';

export const prisma = DatabaseClient.getInstance();
import { Application } from '@prisma/client';
import { createApplicationSubTicketsTx } from '@/bypassAcl/transactions/applicationRepository';
import { createApplicationSubTicketsLockedTx } from '@/bypassAcl/transactions/applicationRepository';

export type CreateApplicationSubTicketsOpts = {
  parentTicketId: string;
  parentTitle: string;
  projectId: string;
  channelId: string;
  conversationId: string;
  createdBy: string;
  affectedApplications: (Application & { matchedFiles: string[] })[];
  prLinksByApplication: Map<string, string[]>;
  isHotFix?: boolean;
};

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
  async createApplicationSubTickets(
    opts: CreateApplicationSubTicketsOpts,
  ): Promise<Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>> {
    return createApplicationSubTicketsTx(opts, this);
  }

  async createApplicationSubTicketsLocked(
    opts: CreateApplicationSubTicketsOpts,
  ): Promise<Map<string, { subTicketId: string; mappedTicketId: string; xyneId: string }>> {
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

    // Idempotency guard: re-running commit analysis previously spawned new
    // SubTickets each with a fresh applicationReleaseId, bypassing the ART
    // (applicationReleaseId, ticketId) unique constraint and 3×-duplicating
    // Dev Tickets / Envs / Migrations. Reuse existing per-app SubTickets instead.
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
        const txResult = await createApplicationSubTicketsLockedTx(projectId, prLinksByApplication, application, parentTitle, createdBy, conversationId, channelId, ticketWorkspaceId, isHotFix, parentTicketId);

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


