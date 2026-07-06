import { Request, Response } from 'express';
import { db } from '@/database/client';
import { vespaBackfillQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';

interface ProjectCodeMapping {
  [projectName: string]: string;
}

interface MigrationResult {
  projectName: string;
  projectCode: string;
  projectId: string;
  ticketsCount: number;
  firstNewId: string;
  lastNewId: string;
}

export class TicketMigrationController {
  /**
   * Migrate tickets for specific projects to their new project-scoped IDs.
   * This version EXCLUDES the actual XYNE project migration.
   */
  public static async migrateTickets(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const jobId = `migrate-${Date.now()}`;

    try {
      const {
        projectCodeMapping,
        dryRun = false
      }: {
        projectCodeMapping: ProjectCodeMapping;
        dryRun?: boolean;
      } = req.body;

      if (!projectCodeMapping || Object.keys(projectCodeMapping).length === 0) {
        res.status(400).json({ success: false, error: 'projectCodeMapping is required' });
        return;
      }

      const migrationResults: MigrationResult[] = [];
      const warnings: string[] = [];
      const vespaJobsQueued: string[] = [];
      let totalTicketsProcessed = 0;

      // Filter out 'XYNE' from the mapping to ensure we don't touch it
      const projectsToProcess = Object.entries(projectCodeMapping).filter(
        ([_, code]) => code !== 'XYNE'
      );

      for (const [projectName, projectCode] of projectsToProcess) {
        const project = await db.project.findFirst({ where: { name: projectName } });

        if (!project) {
          warnings.push(`Project not found: ${projectName}`);
          continue;
        }

        // Get all tickets for this project ordered by creation
        const tickets = await db.ticket.findMany({
          where: { projectId: project.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true, xyneId: true, workspaceId: true }
        });

        if (tickets.length === 0) {
          warnings.push(`No tickets found for project: ${projectName}`);
          continue;
        }

        if (!dryRun) {
          // 1. Update Project Metadata
          await db.project.update({
            where: { id: project.id },
            data: { code: projectCode, ticketSequence: tickets.length }
          });

          // 2. Update Individual Tickets
          for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            const newId = `${projectCode}-${String(i + 1).padStart(4, '0')}`;

            const updatedTicket = await db.ticket.update({
              where: { id: ticket.id },
              data: { xyneId: newId }
            });

            await syncConversationTicketMdFromPrismaTicket(db, updatedTicket);

            // 3. Queue for Search Indexing (Vespa)
            try {
              await vespaBackfillQueue.addJob({
                schema: ticketSchema,
                jobType: 'update',
                docId: ticket.id,
                userId: undefined,
                workspaceId: ticket.workspaceId,
              });
              vespaJobsQueued.push(ticket.id);
            } catch (err) {
              logger.error(`Vespa indexing failed for ${ticket.id}`, err);
            }
          }
        }

        totalTicketsProcessed += tickets.length;
        migrationResults.push({
          projectName,
          projectCode,
          projectId: project.id,
          ticketsCount: tickets.length,
          firstNewId: `${projectCode}-0001`,
          lastNewId: `${projectCode}-${String(tickets.length).padStart(4, '0')}`
        });
      }

      res.status(200).json({
        success: true,
        data: {
          jobId,
          durationMs: Date.now() - startTime,
          dryRun,
          totalProjectsMigrated: migrationResults.length,
          totalTicketsMigrated: totalTicketsProcessed,
          vespaJobsQueued: vespaJobsQueued.length,
          details: migrationResults,
          warnings: warnings.length > 0 ? warnings : undefined
        }
      });

    } catch (error) {
      logger.error(`[Migration] Job ${jobId} failed:`, error);
      res.status(500).json({ success: false, error: 'Migration failed', jobId });
    }
  }

  public static async previewMigration(req: Request, res: Response): Promise<void> {
    req.body.dryRun = true;
    return TicketMigrationController.migrateTickets(req, res);
  }
}
