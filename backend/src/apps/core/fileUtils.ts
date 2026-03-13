import { z } from 'zod';
import { uploadFiles, UploadedFileResult } from '@/services/fileUploadService';
import { logger } from '@/utils/logger';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { FileUploadEventType, FileUploadResponse } from '../types';
import { findOrCreateConversation } from './conversationUtils';
import { resolveSlackMentions } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { SlackBlockKitParser } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser';
import { config } from '@/config/env';

// Initialize Block Kit parser instance
const blockKitParser = new SlackBlockKitParser();

/**
 * Schema for validating ingestAttachment function parameters
 */
const IngestAttachmentParamsSchema = z.object({
  files: z.array(z.any()).min(1, 'Files are required'),
  channelId: z.string().min(1, 'Channel ID is required').trim(),
  userId: z.string().min(1, 'User ID is required').trim(),
  text: z.string().trim().optional(),
  conversationId: z.string().trim().optional(),
});

/**
 * Ingest attachment(s) into a conversation with optional text message
 * 
 * @param params - Parameters for ingesting attachment
 * @returns The result containing conversation, message, and attachment IDs
 */
export async function ingestAttachment(
  params: z.infer<typeof IngestAttachmentParamsSchema>
): Promise<FileUploadResponse> {
  try {
    // Validate parameters with Zod
    const paramsResult = IngestAttachmentParamsSchema.safeParse(params);

    if (!paramsResult.success) {
      const errorMessages = paramsResult.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ');
      throw new Error(`Validation error: ${errorMessages}`);
    }

    const { files, channelId, userId, text, conversationId } = paramsResult.data;

    // Upload files to GCS
    logger.info(`[INGEST-ATTACHMENT] Uploading ${files.length} file(s)`);
    const uploadedFiles: UploadedFileResult[] = await uploadFiles(files);

    // Resolve Slack mentions in text if text exists
    const botOauthToken = config.slackBotToken;
    let resolvedText = text;
    if (resolvedText) {
      resolvedText = await resolveSlackMentions(resolvedText, botOauthToken);
    }

    const processedContent = blockKitParser.parse({
      text: resolvedText,
      attachments: undefined,
    });

    // Reuse the find or create conversation logic
    const result = await findOrCreateConversation(
      channelId,
      userId,
      processedContent,
      conversationId,
      uploadedFiles
    );

    // Get created attachments from database
    const messageAttachmentRepository = new MessageAttachmentRepository();
    const attachments = await messageAttachmentRepository.findByMessageId(result.messageId);

    return {
      eventType: FileUploadEventType.FILE_UPLOADED,
      conversationId: result.conversationId,
      messageId: result.messageId,
      attachments: attachments.map(att => ({
        fileid: att.id,
        originalFilename: att.originalFilename,
        url: att.url,
        size: att.size,
        mimeType: att.mimetype,
      })),
    };
  } catch (error) {
    logger.error('[INGEST-ATTACHMENT] Error ingesting attachment:', error);
    throw error;
  }
}
