import { Request, Response } from 'express';
import { WorkspaceRole } from '@xyne/shared';
import { z } from 'zod';
import {
  downloadTicketExportRequestSchema,
  ticketReportService,
} from '@/services/ticketReportService';
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
  async downloadExport(req: Request, res: Response): Promise<void> {
    try {
      const body = downloadTicketExportRequestSchema.parse(req.body);
      const { buffer, fileName } = await ticketReportService.downloadExport(
        body,
        toExportUser(req),
      );

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', buffer.length.toString());
      res.send(buffer);
    } catch (error) {
      logger.error('[TicketReportController] downloadExport failed', error);
      const statusCode =
        error instanceof z.ZodError ? 400 : error instanceof AppError ? error.statusCode : 500;
      res.status(statusCode).json({
        success: false,
        error:
          error instanceof z.ZodError
            ? error.errors
            : error instanceof AppError
              ? error.message
              : 'Failed to download export',
      });
    }
  }
}
