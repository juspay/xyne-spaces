import type { Request, Response } from 'express';
import { BaseTicketType, isReleaseTicket } from '@xyne/shared';
import { db } from '@/database/client';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { ReleaseReportService } from '@/services/releaseReports/releaseReportService';
import { logger } from '@/utils/logger';

export class ReleaseReportController {
  private readonly releaseReportService = new ReleaseReportService();
  private readonly channelParticipantRepository = new ChannelParticipantRepository();

  publish = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const { ticketId } = req.params;

    if (!userId || !workspaceId) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    try {
      const [ticket, publisher] = await Promise.all([
        db.ticket.findUnique({
          where: { id: ticketId },
          include: {
            channel: { select: { visibility: true } },
          },
        }),
        db.user.findUnique({ where: { id: userId } }),
      ]);

      if (!ticket) {
        res.status(404).json({ success: false, error: 'Release ticket not found' });
        return;
      }
      if (!publisher || ticket.workspaceId !== workspaceId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      if (!isReleaseTicket(ticket.ticketType as BaseTicketType)) {
        res.status(400).json({
          success: false,
          error: 'Only Release and Hotfix tickets can publish release reports',
        });
        return;
      }
      if (!ticket.conversationId || !ticket.channelId) {
        res.status(400).json({
          success: false,
          error: 'The release ticket does not have an existing conversation',
        });
        return;
      }
      if (ticket.channel?.visibility === 'PRIVATE') {
        const isParticipant = await this.channelParticipantRepository.isParticipant(
          ticket.channelId,
          userId
        );
        if (!isParticipant) {
          res.status(403).json({
            success: false,
            error: 'You do not have access to the release ticket conversation',
          });
          return;
        }
      }

      const result = await this.releaseReportService.publish({
        ticketId,
        publisher,
      });
      res.status(200).json(result);
    } catch (error) {
      logger.error('[ReleaseReportController] Failed to publish release report', error);
      res.status(500).json({
        success: false,
        partialFailure: false,
        error: error instanceof Error ? error.message : 'Failed to publish release report',
      });
    }
  };
}
