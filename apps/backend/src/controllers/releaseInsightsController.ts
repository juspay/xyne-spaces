import { Request, Response } from 'express';
import { BaseTicketType, isReleaseTicket } from '@xyne/shared';
import { ReleaseReportService } from '@/services/releaseReports/releaseReportService';
import { ReleaseNotesService } from '@/services/releaseNotes/releaseNotesService';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { ApplicationRepository } from '@/database/repositories/applicationRepository';
import { generateReleaseInsights } from '@/agents/release-insights/index.js';
import { logger } from '@/utils/logger';

const isAssigned = (value: string | null | undefined): boolean =>
  !!value && value.trim().length > 0 && value.trim().toLowerCase() !== 'unassigned';

export class ReleaseInsightsController {
  private ticketRepository = new TicketRepository();
  private releaseReportService = new ReleaseReportService();
  private releaseNotesService = new ReleaseNotesService();
  private applicationRepository = new ApplicationRepository();

  generate = async (req: Request, res: Response): Promise<void> => {
    const { ticketId } = req.params;
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    if (!ticketId) {
      res.status(400).json({ success: false, error: 'ticketId is required' });
      return;
    }

    try {
      const ticket = await this.ticketRepository.getTicketById(ticketId);
      if (!ticket || ticket.workspaceId !== workspaceId) {
        res.status(404).json({ success: false, error: 'Ticket not found' });
        return;
      }
      if (!isReleaseTicket(ticket.ticketType as BaseTicketType)) {
        res.status(400).json({ success: false, error: 'Not a release ticket' });
        return;
      }
      if (
        (ticket.metadata as { isGeneratingReleaseInsights?: boolean } | null)
          ?.isGeneratingReleaseInsights === true
      ) {
        res.status(409).json({
          success: false,
          error: 'Insights are already being generated for this release',
        });
        return;
      }

      await this.ticketRepository.updateTicketMetadata(ticketId, {
        isGeneratingReleaseInsights: true,
      });

      try {
        const report = await this.releaseReportService.gatherReleaseReport(ticketId);
        const notes = await this.releaseNotesService.gatherReleaseData(ticketId).catch(error => {
          logger.warn('[ReleaseInsights] gatherReleaseData failed, continuing without PR/POT data', {
            ticketId,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
        const apps = ticket.boardId
          ? await this.applicationRepository.findByMainReleaseBoardId(ticket.boardId)
          : [];

        const devTickets = report.devTickets;
        const contributorCounts = new Map<string, number>();
        for (const t of devTickets) {
          if (!isAssigned(t.devOwner)) continue;
          contributorCounts.set(t.devOwner, (contributorCounts.get(t.devOwner) ?? 0) + 1);
        }
        const contributors = [...contributorCounts.entries()]
          .map(([name, ticketCount]) => ({ name, ticketCount }))
          .sort((a, b) => b.ticketCount - a.ticketCount);

        const prs = notes?.prs ?? [];
        const stats = {
          devTicketCount: report.summary.devTicketCount,
          environmentVariableCount: report.summary.environmentVariableCount,
          migrationFileCount: report.summary.migrationFileCount,
          repositoryCount: new Set(apps.map(a => a.repoUrl)).size,
          serviceNames: apps.map(a => a.name),
          hotfixCount: notes?.hotfixPRs.length ?? 0,
          qaAssigned: devTickets.filter(t => isAssigned(t.qaOwner)).length,
          potPresent: prs.filter(p => !!p.potVideoLink).length,
          prCount: prs.length,
          contributors,
        };

        const llm = await generateReleaseInsights(
          {
            release: {
              xyneId: ticket.xyneId,
              title: ticket.title,
              description: ticket.description ?? null,
              status: report.release.status,
              version: report.release.version,
            },
            stats,
            devTickets: devTickets.slice(0, 40).map(t => ({
              title: t.title,
              type: t.type,
              status: t.status,
              devOwner: t.devOwner,
              qaOwner: t.qaOwner,
              changes: t.changes,
              hasPr: !!t.prUrl,
            })),
            prs: prs.slice(0, 40).map(p => ({
              title: p.title,
              description: (p.description ?? '').slice(0, 400),
              hasPot: !!p.potVideoLink,
            })),
            migrations: report.migrations.slice(0, 40).map(m => ({
              service: m.applicationName,
              file: m.filePath,
            })),
            environmentChanges: report.environmentChanges.slice(0, 40).map(e => ({
              service: e.applicationName,
              description: e.description,
            })),
          },
          { userId, projectId: ticket.projectId ?? null },
        );

        const releaseInsights = { generatedAt: new Date().toISOString(), stats, ...llm };
        await this.ticketRepository.updateTicketMetadata(ticketId, {
          releaseInsights,
          isGeneratingReleaseInsights: false,
        });
        res.json({ success: true });
      } finally {
        await this.ticketRepository
          .updateTicketMetadata(ticketId, { isGeneratingReleaseInsights: false })
          .catch(err =>
            logger.warn('[ReleaseInsights] failed to clear generating flag', {
              ticketId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[ReleaseInsights] generate failed', { ticketId, error: msg });
      res.status(500).json({ success: false, error: 'Failed to generate release insights' });
    }
  };
}
