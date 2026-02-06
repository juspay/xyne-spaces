import { TicketRepository } from '../database/repositories/ticketRepository';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository';
import { ImageAttachment } from '@/workflows/types/workflow-enums';
import { ActivitySource } from '@/types/ticket';
import { DatabaseClient } from '@/database/client';
import { gcsService } from '@/services/gcsService';
import { logger } from '@/utils/logger';
import { PRStatusEvent } from '@prisma/client';

const prisma = DatabaseClient.getInstance();

const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/^\.+/, '')
    .substring(0, 255)
    .trim();
};

export class TicketService {
  private ticketRepository: TicketRepository;
  private messageAttachmentRepository: MessageAttachmentRepository;

  constructor() {
    this.ticketRepository = new TicketRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();
  }

  /**
   * Update ticket stage when a workflow is created or PR status changes
   * This method validates that the stage exists before updating
   * @param ticketId - The ticket ID to update
   * @param userId - The user who initiated the workflow (for activity tracking)
   * @param stage - The stage name (can be AI_STAGES, PR_STAGES, or any custom stage)
   * @param source - The source/origin of the update (INTERNAL or WEBHOOK)
   * @param prActivityData - Optional PR activity data (only used when source is WEBHOOK)
   */
  async updateTicketStageForWorkflow(
    ticketId: string,
    userId: string,
    stage: string,
    source: ActivitySource = ActivitySource.INTERNAL,
    prActivityData?: {
      prEvent: PRStatusEvent;
      prId: number;
      prUrl: string;
      repoName: string;
      sourceBranchName: string;
      destinationBranchName: string;
      pullRequestId?: string;
      prAuthor?: string;
      remainingOpenPRs?: number;
    }
  ): Promise<void> {
    try {
      // Get ticket with board information
      const ticket = await this.ticketRepository.getTicketWithBoard(ticketId);

      if (!ticket) {
        logger.warn(`[TicketService] Ticket ${ticketId} not found. Skipping stage update.`);
        return;
      }

      const { boardId } = ticket;

      // Query the board to find the AI_PICKED_UP stage
      const targetStage = await prisma.stage.findFirst({
        where: {
          boardId: boardId,
          name: stage,
        },
      });

      // If stage doesn't exist in this board, skip the update
      if (!targetStage) {
        logger.warn(
          `[TicketService] "${stage}" stage not found in board ${boardId}. Skipping stage update for ticket ${ticketId}.`
        );
        return;
      }

      // Check if ticket is already in the target stage
      if (ticket.stageName === stage) {
        // For WEBHOOK source with PR data, we still need to call repository to create PR activity
        // even if the stage hasn't changed
        if (source === ActivitySource.WEBHOOK && prActivityData) {
          console.info(
            `[TicketService] Ticket ${ticketId} is already in "${stage}" stage. Creating PR activity only.`
          );
          // Proceed to create PR activity without stage change
        } else {
          console.info(
            `[TicketService] Ticket ${ticketId} is already in "${stage}" stage. Skipping update.`
          );
          return;
        }
      }

      // Update the ticket stage (this will also create the appropriate activity)
      await this.ticketRepository.updateTicketStage(
        ticketId,
        stage,
        userId,
        source,
        prActivityData
      );

      logger.debug(
        `[TicketService] Successfully updated ticket ${ticketId} to "${stage}" stage.`
      );
    } catch (error) {
      // Log the error but don't throw it - we don't want to fail workflow creation
      // if stage update fails
      logger.error(
        `[TicketService] Error updating ticket stage for workflow:`,
        error
      );
    }
  }

  /**
   * Fetch and download all image attachments for a ticket
   * Converts them to Base64 format for use in vision-enabled AI workflows
   */
  async getImagesForTicket(ticketId: string): Promise<ImageAttachment[]> {
    try {
      const attachments = await this.messageAttachmentRepository.findByTicketId(ticketId);

      const imageAttachmentPromises = attachments
        .filter(a => a.mimetype.startsWith('image/'))
        .map(async (attachment, index): Promise<ImageAttachment | null> => {
          try {
            const buffer = await gcsService.getFileBuffer(attachment.url);
            const rawFileName = attachment.url.split('/').pop() || `image-${index}`;
            const fileName = sanitizeFilename(rawFileName);
            return {
              id: `img-${index}-${Date.now()}`,
              type: 'image' as const,
              data: buffer.toString('base64'),
              mimeType: attachment.mimetype,
              name: fileName,
            };
          } catch (err) {
            logger.error('Failed to download image from GCS', { url: attachment.url, error: err });
            return null;
          }
        });

      const imageAttachmentsRaw = await Promise.all(imageAttachmentPromises);
      return imageAttachmentsRaw.filter((a): a is ImageAttachment => a !== null);
    } catch (error) {
      logger.error('Failed to fetch image attachments for ticket', { ticketId, error });
      return [];
    }
  }
}

// Export a singleton instance
export const ticketService = new TicketService();
