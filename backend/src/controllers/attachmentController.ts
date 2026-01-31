import { Request, Response } from 'express';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository';
import { ConversationRepository } from '../database/repositories/conversationRepository';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { gcsService, GCSService } from '../services/gcsService';
import { logger } from '../utils/logger';

export class AttachmentController {
  private messageAttachmentRepository: MessageAttachmentRepository;
  private conversationRepository: ConversationRepository;
  private channelParticipantRepository: ChannelParticipantRepository;

  constructor() {
    this.messageAttachmentRepository = new MessageAttachmentRepository();
    this.conversationRepository = new ConversationRepository();
    this.channelParticipantRepository = new ChannelParticipantRepository();
  }

  /**
   * GET /api/attachments/:attachmentId/download
   * Stream file from GCS to client
   */
  downloadAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const { attachmentId } = req.params;

      // Get attachment metadata from database
      const attachment = await this.messageAttachmentRepository.findById(attachmentId);

      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found'});
        return;
      }

      let serviceToUse = gcsService; // Default GCS service (singleton with default bucket xyne-spaces-chat-documents)
      let gcsPath = attachment.url;

      const meta = attachment.metadata as { type?: string }; 
      
      if (meta?.type === 'transcript') {
        if (gcsPath.startsWith('gs://')) {
          const match = gcsPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
          if (match) {
            const [, bucketName, filePath] = match;
            serviceToUse = new GCSService(bucketName); 
            gcsPath = filePath; 
          }
        }
      }

      logger.info(`Streaming attachment ${attachmentId} from GCS path: ${gcsPath}`);

      // Use the dynamic service instance (either default or custom)
      const buffer = await serviceToUse.getFileBuffer(gcsPath);

      // Set response headers
      res.setHeader('Content-Type', attachment.mimetype);
      res.setHeader('Content-Length', buffer.length);

      // Encode filename to handle special characters
      const encodedFilename = encodeURIComponent(attachment.originalFilename);
      res.setHeader('Content-Disposition', `inline; filename="${encodedFilename}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour

      // Stream the file
      res.send(buffer);

    } catch (error) {
      logger.error('Error downloading attachment:', error);
      res.status(500).json({ error: 'Failed to download attachment' });
    }
  };

  /**
   * GET /api/attachments/file
   * Stream file from GCS to client using GCS path as query parameter
   * This is useful when we have the GCS path but not the attachment ID
   */
  downloadByPath = async (req: Request, res: Response): Promise<void> => {
    try {
      const { path: gcsPath } = req.query;

      if (!gcsPath || typeof gcsPath !== 'string') {
        res.status(400).json({ error: 'GCS path is required' });
        return;
      }

      logger.info(`Streaming file from GCS path: ${gcsPath}`);

      // Check if file exists in GCS
      const fileExists = await gcsService.fileExists(gcsPath);
      if (!fileExists) {
        logger.error(`File not found in GCS: ${gcsPath}`);
        res.status(404).json({ error: 'File not found in storage' });
        return;
      }

      // Get file metadata to determine content type and size
      const metadata = await gcsService.getFileMetadata(gcsPath);
      const contentType = metadata.contentType || 'application/octet-stream';
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      // Extract filename from path
      const fileName = gcsPath.split('/').pop() || 'download';

      // Set response headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour

      // Stream the file directly from GCS
      const stream = await gcsService.createReadStream(gcsPath);
      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error('File stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream file' });
        }
      });
    } catch (error) {
      logger.error('Error downloading file by path:', error);
      res.status(500).json({ error: 'Failed to download file' });
    }
  };

  /**
   * GET /api/attachments/:attachmentId/thumbnail
   * Download thumbnail for an attachment (if available)
   */
  downloadThumbnail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { attachmentId } = req.params;

      // Get attachment metadata from database
      const attachment = await this.messageAttachmentRepository.findById(attachmentId);

      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      // Check if thumbnail exists
      if (!attachment.thumbnailUrl) {
        res.status(404).json({ error: 'Thumbnail not available for this attachment' });
        return;
      }

      const thumbnailGcsPath = attachment.thumbnailUrl;

      logger.info(`Streaming thumbnail ${attachmentId} from GCS path: ${thumbnailGcsPath}`);

      // Check if thumbnail file exists in GCS
      const fileExists = await gcsService.fileExists(thumbnailGcsPath);
      if (!fileExists) {
        logger.error(`Thumbnail file not found in GCS: ${thumbnailGcsPath}`);
        res.status(404).json({ error: 'Thumbnail file not found in storage' });
        return;
      }

      // Get file metadata to determine size for Content-Length header
      const metadata = await gcsService.getFileMetadata(thumbnailGcsPath);
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      // Set response headers
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Disposition', `inline; filename="thumbnail.jpg"`);
      res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour

      // Stream the thumbnail directly from GCS
      const stream = await gcsService.createReadStream(thumbnailGcsPath);
      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error('Thumbnail stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream thumbnail' });
        }
      });
    } catch (error) {
      logger.error('Error downloading thumbnail:', error);
      res.status(500).json({ error: 'Failed to download thumbnail' });
    }
  };

  /**
   * GET /api/attachments/:attachmentId/stream
   * Stream video/audio files with range request support (HTTP 206 Partial Content)
   * This enables seeking in video players
   */
  streamAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const { attachmentId } = req.params;
      const userId = req.user?.id;

      // Verify user is authenticated
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized - user not authenticated' });
        return;
      }

      // Get attachment metadata from database
      const attachment = await this.messageAttachmentRepository.findById(attachmentId);

      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      // CHECK: Verify user has access to this attachment
      // Attachments belong to conversations, conversations belong to channels
      // User must be a participant of the channel to access the attachment
      const conversation = await this.conversationRepository.findById(attachment.conversationId);
      
      if (!conversation) {
        logger.error(`Conversation not found for attachment ${attachmentId}`);
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // Check if user is a participant of the channel
      const isParticipant = await this.channelParticipantRepository.isParticipant(
        conversation.channelId,
        userId
      );

      if (!isParticipant) {
        logger.warn(`Unauthorized access attempt: User ${userId} tried to stream attachment ${attachmentId} from channel ${conversation.channelId}`);
        res.status(403).json({ 
          error: 'Forbidden',
          message: 'You do not have permission to access this attachment'
        });
        return;
      }

      const gcsPath = attachment.url;

      // Check if file exists in GCS
      const fileExists = await gcsService.fileExists(gcsPath);
      if (!fileExists) {
        logger.error(`File not found in GCS: ${gcsPath}`);
        res.status(404).json({ error: 'File not found in storage' });
        return;
      }

      // Get file metadata to determine size
      const metadata = await gcsService.getFileMetadata(gcsPath);
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      // Parse Range header (e.g., "bytes=0-1023")
      const range = req.headers.range;

      if (!range) {
        // No range requested - send entire file
        logger.info(`Streaming entire file: ${gcsPath}`);

        res.setHeader('Content-Type', attachment.mimetype);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=3600');

        const stream = await gcsService.createReadStream(gcsPath);
        stream.pipe(res);

        stream.on('error', (error) => {
          logger.error('Stream error:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error' });
          }
        });

        return;
      }

      // Parse range header
      const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB

      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);

      // Validate start value
      if (isNaN(start) || start < 0) {
        res.status(400).json({ error: 'Invalid Range header' });
        return;
      }

      // If client didn't specify an end, limit it to CHUNK_SIZE
      let end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + CHUNK_SIZE - 1, fileSize - 1);

      // Validate end value if it was parsed
      if (parts[1] && isNaN(end)) {
        res.status(400).json({ error: 'Invalid Range header' });
        return;
      }

      if (end >= fileSize) {
        end = fileSize - 1;
      }

      const chunkSize = end - start + 1;

      logger.info(`Streaming range for ${gcsPath}: bytes ${start}-${end}/${fileSize}`);

      // Set headers for partial content
      res.status(206); // Partial Content
      res.setHeader('Content-Type', attachment.mimetype);
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=3600');

      // Stream the requested range from GCS
      const stream = await gcsService.createReadStream(gcsPath, { start, end });
      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error('Stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        }
      });
    } catch (error) {
      logger.error('Error streaming attachment:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream attachment' });
      }
    }
  };
}