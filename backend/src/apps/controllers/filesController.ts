import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { ingestAttachment } from '../core/fileUtils';
import { resolveChannelId } from '../utils/channelUtils';

const UploadFilesBodySchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  text: z.string().trim().optional(),
  conversationId: z.string().trim().optional(),
  userId: z.string().min(1, 'User ID is required').trim(),
}).refine(
  data => !!data.channelId || !!data.conversationId,
  { message: 'Either channelId or conversationId is required', path: ['channelId'] }
);

export class FilesController {
  /**
   * Upload file(s) to a channel or conversation
   * POST /api/external-event/files/upload
   */
  uploadFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = UploadFilesBodySchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const { channelId, text, conversationId, userId } = bodyResult.data;

      // Resolve channelId from conversationId if not provided
      const resolvedChannelId = await resolveChannelId(channelId, conversationId);

      // Extract files from multer
      // uploadMultiple uses fields() so files are in object format
      const reqFiles = (Array.isArray(req.files) ? {} : req.files) || {};
      const files = reqFiles['files'] || [];

      if (files.length === 0) {
        res.status(400).json({
          error: 'At least one file is required',
          code: 'MISSING_FILES',
        });
        return;
      }

      // Upload files and create/update conversation
      const result = await ingestAttachment({
        files,
        channelId: resolvedChannelId,
        userId,
        text,
        conversationId,
      });

      res.status(201).json(result);
    } catch (error) {
      logger.error('Error uploading files:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({
            error: error.message,
            code: 'NOT_FOUND',
          });
          return;
        }
        if (error.message.includes('required')) {
          res.status(400).json({
            error: error.message,
            code: 'VALIDATION_ERROR',
          });
          return;
        }
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
