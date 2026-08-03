import { Request, Response } from 'express';
import type { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import {
  createTicketExportRequestSchema,
  ticketReportService,
  ticketReportTempFileService,
} from '@/services/ticketReportService';
import { ticketReportQueue } from '@/queues/ticketReportQueue';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

function toExportUser(req: Request) {
  const user = req.user!;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    workspaceId: user.workspaceId,
    role: user.role as WorkspaceRole,
  };
}

export class TicketReportController {
  /**
   * POST /exports
   * Validate filters, create PENDING record, enqueue a worker job, return the record.
   */
  async requestExport(req: Request, res: Response): Promise<void> {
    try {
      const body = createTicketExportRequestSchema.parse(req.body);
      const user = toExportUser(req);

      const record = await ticketReportService.requestExport(body, user);

      await ticketReportQueue.addJob({
        exportId: record.id,
        workspaceId: record.workspaceId,
        requestedByUserId: record.requestedBy,
      });

      logger.info(
        `[TicketReportController] Export ${record.id} enqueued for workspace ${record.workspaceId}`,
      );

      res.status(202).json({ success: true, data: record });
    } catch (error) {
      logger.error('[TicketReportController] requestExport failed', error);
      const statusCode =
        error instanceof z.ZodError ? 400 : error instanceof AppError ? error.statusCode : 500;
      res.status(statusCode).json({
        success: false,
        error:
          error instanceof z.ZodError
            ? error.errors
            : error instanceof AppError
              ? error.message
              : 'Failed to request export',
      });
    }
  }

  /**
   * GET /exports/:id
   * Return the export record status (for polling).
   */
  async getExport(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const record = await ticketReportService.getExport(id, toExportUser(req));
      res.json({ success: true, data: record });
    } catch (error) {
      logger.error('[TicketReportController] getExport failed', error);
      const statusCode = error instanceof AppError ? error.statusCode : 500;
      res.status(statusCode).json({
        success: false,
        error: error instanceof AppError ? error.message : 'Failed to get export',
      });
    }
  }

  /**
   * GET /exports/:id/download
   * If the export is READY, stream the file and delete it after.
   */
  async downloadExport(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { filePath, fileName } = await ticketReportService.downloadFile(
        id,
        toExportUser(req),
      );

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      res.download(filePath, fileName, (err) => {
        if (err) {
          logger.error(`[TicketReportController] Download stream error for export ${id}:`, err);
        }
        // Clean up temp file after response is sent
        ticketReportTempFileService.deleteTempFile(id);
      });
    } catch (error) {
      logger.error('[TicketReportController] downloadExport failed', error);
      const statusCode = error instanceof AppError ? error.statusCode : 500;
      res.status(statusCode).json({
        success: false,
        error: error instanceof AppError ? error.message : 'Failed to download export',
      });
    }
  }
}
