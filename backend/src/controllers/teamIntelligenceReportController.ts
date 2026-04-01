import { Request, Response } from 'express';
import { z } from 'zod';
import { teamIntelligenceReportService } from '@/services/teamIntelligenceReport/reportService';
import { teamIntelligenceReportPdfService } from '@/services/teamIntelligenceReport/pdfService';
import { teamIntelligenceReportQueue } from '@/queues/teamIntelligenceReportQueue';
import type { ApiResponse } from '@/types/express';
import { logger } from '@/utils/logger';

const controllerLogger = logger.child({ module: 'team-intelligence-report-controller' });

const CreateReportRequestSchema = z.object({
  orgId: z.string().min(1),
  userIds: z.array(z.string().min(1)).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  includeTranscripts: z.boolean().optional(),
  limitPerUser: z.number().int().min(1).max(20).optional(),
});

export class TeamIntelligenceReportController {
  createReport = async (req: Request, res: Response<ApiResponse>): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const parsed = CreateReportRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request payload',
          message: parsed.error.message,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const report = await teamIntelligenceReportService.createReportRequest(
        {
          userId: user.id,
          appRole: user.role,
        },
        parsed.data
      );
      await teamIntelligenceReportQueue.enqueueGeneration(report.id);

      res.status(202).json({
        success: true,
        data: {
          id: report.id,
          status: report.status,
          orgId: report.orgId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      controllerLogger.error('[TEAM_INTELLIGENCE] Failed to create report request', error);
      this.respondWithError(res, error);
    }
  };

  listReports = async (req: Request, res: Response<ApiResponse>): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const orgId = String(req.query.orgId || '').trim();
      if (!orgId) {
        res.status(400).json({
          success: false,
          error: 'orgId is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const reports = await teamIntelligenceReportService.listReports(
        {
          userId: user.id,
          appRole: user.role,
        },
        orgId
      );

      res.status(200).json({
        success: true,
        data: reports,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      controllerLogger.error('[TEAM_INTELLIGENCE] Failed to list reports', error);
      this.respondWithError(res, error);
    }
  };

  getReport = async (req: Request, res: Response<ApiResponse>): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const { reportId } = req.params;
      const report = await teamIntelligenceReportService.getReportById(
        {
          userId: user.id,
          appRole: user.role,
        },
        reportId
      );

      res.status(200).json({
        success: true,
        data: report,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      controllerLogger.error('[TEAM_INTELLIGENCE] Failed to fetch report', error);
      this.respondWithError(res, error);
    }
  };

  downloadPdf = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const { reportId } = req.params;
      const report = await teamIntelligenceReportService.getReportById(
        {
          userId: user.id,
          appRole: user.role,
        },
        reportId
      );

      const pdfBuffer = await teamIntelligenceReportPdfService.generatePdfBuffer(report);
      const reportTitle =
        typeof report.report === 'object' &&
        report.report !== null &&
        typeof (report.report as Record<string, unknown>).title === 'string'
          ? (report.report as Record<string, unknown>).title as string
          : 'team-intelligence-report';
      const safeFilename = reportTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'team-intelligence-report';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', pdfBuffer.length);
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      controllerLogger.error('[TEAM_INTELLIGENCE] Failed to download report PDF', error);
      this.respondWithError(res as Response<ApiResponse>, error);
    }
  };

  private respondWithError(res: Response<ApiResponse>, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'Organization not found' || message === 'Report not found') {
      res.status(404).json({
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (message.startsWith('Forbidden')) {
      res.status(403).json({
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (
      message.includes('required') ||
      message.includes('Invalid') ||
      message.includes('outside the organization scope') ||
      message.includes('supports up to') ||
      message.includes('exceeds the maximum')
    ) {
      res.status(400).json({
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to process team intelligence report request',
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
