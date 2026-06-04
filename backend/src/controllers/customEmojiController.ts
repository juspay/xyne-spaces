import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  CustomEmojiRepository,
  CreateCustomEmojiInput,
  CustomEmojiWithRelations,
} from '../database/repositories/customEmojiRepository';
import { getStorageService } from '../services/storage';
import { cleanupProxiedFile } from '../utils/attachmentUtils';

const storageService = getStorageService();

/**
 * Transform a Prisma CustomEmoji to the frontend-friendly format
 */
function transformEmoji(emoji: CustomEmojiWithRelations): any {
  return {
    id: emoji.id,
    name: emoji.name,
    url: emoji.url,
    createdAt: emoji.createdAt.toISOString(),
    createdBy: emoji.createdBy,
    creator: emoji.creator
      ? {
          id: emoji.creator.id,
          name: emoji.creator.name,
          email: emoji.creator.email,
          picture: emoji.creator.picture,
        }
      : null,
  };
}

export class CustomEmojiController {
  private customEmojiRepository: CustomEmojiRepository;

  constructor(customEmojiRepository: CustomEmojiRepository) {
    this.customEmojiRepository = customEmojiRepository;
  }

  /**
   * Create a new custom emoji
   * POST /api/emojis
   * Body: { name: string }
   * Multipart form data: file (the emoji image)
   */
  createCustomEmoji = async (req: Request, res: Response): Promise<void> => {
    try {
      const file = (req as Express.Request & { file?: Express.Multer.File }).file;
      const { name } = req.body;
      const userId = req.user?.id;

      logger.info('Creating custom emoji', { userId, name, hasFile: !!file });

      // Validate user
      if (!userId) {
        await cleanupProxiedFile(file, {
          logPrefix: 'CUSTOM-EMOJI',
          successMessage: 'Cleaned up proxied emoji upload after failed request',
          failureMessage: 'Failed to clean up proxied emoji upload after failed request',
          storage: storageService,
        });
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Validate file
      if (!file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      // Validate file type (only images allowed for emojis)
      if (!file.mimetype.startsWith('image/')) {
        await cleanupProxiedFile(file, {
          logPrefix: 'CUSTOM-EMOJI',
          successMessage: 'Cleaned up proxied emoji upload after failed request',
          failureMessage: 'Failed to clean up proxied emoji upload after failed request',
          storage: storageService,
        });
        res.status(400).json({ error: 'Only image files are allowed for emojis' });
        return;
      }

      // Validate emoji name format (alphanumeric and underscores only, no colons)
      const sanitizedName = name.replace(/:/g, '').trim();
      if (!sanitizedName || sanitizedName.length > 50) {
        await cleanupProxiedFile(file, {
          logPrefix: 'CUSTOM-EMOJI',
          successMessage: 'Cleaned up proxied emoji upload after failed request',
          failureMessage: 'Failed to clean up proxied emoji upload after failed request',
          storage: storageService,
        });
        res.status(400).json({
          error: 'Invalid emoji name. Must be 1-50 characters (letters, numbers, underscores)',
        });
        return;
      }

      // Check if emoji with this name already exists
      const existingEmoji = await this.customEmojiRepository.findByName(sanitizedName);
      if (existingEmoji) {
        await cleanupProxiedFile(file, {
          logPrefix: 'CUSTOM-EMOJI',
          successMessage: 'Cleaned up proxied emoji upload after failed request',
          failureMessage: 'Failed to clean up proxied emoji upload after failed request',
          storage: storageService,
        });
        res.status(409).json({ error: 'An emoji with this name already exists' });
        return;
      }

      logger.info('Processing streamed emoji upload', {
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      });

      // uploadSingle uses streamingStorage._handleFile -> storageService.uploadStream.
      // The file is expected to already be in object storage at this point.
      const emojiStoragePath = typeof file.path === 'string' ? file.path : '';
      if (!emojiStoragePath.startsWith('attachments/')) {
        logger.error('Expected streamed storage path is missing on uploaded emoji file', {
          fileName: file.originalname,
          hasPath: Boolean(file.path),
        });
        await cleanupProxiedFile(file, {
          logPrefix: 'CUSTOM-EMOJI',
          successMessage: 'Cleaned up proxied emoji upload after failed request',
          failureMessage: 'Failed to clean up proxied emoji upload after failed request',
          storage: storageService,
        });
        res.status(500).json({ error: 'Failed to stream emoji file to storage' });
        return;
      }

      logger.info('Emoji file already streamed to storage', { gcsPath: emojiStoragePath });

      // Create the custom emoji
      const emojiData: CreateCustomEmojiInput = {
        name: sanitizedName,
        url: emojiStoragePath,
        createdBy: userId,
      };

      const emoji = await this.customEmojiRepository.create(emojiData);

      res.status(201).json({
        success: true,
        message: 'Custom emoji created successfully',
        emoji: transformEmoji(emoji),
      });

      logger.info(`Custom emoji created: ${sanitizedName} by user ${userId}`);
    } catch (error: any) {
      await cleanupProxiedFile((req as Express.Request & { file?: Express.Multer.File }).file, {
        logPrefix: 'CUSTOM-EMOJI',
        successMessage: 'Cleaned up proxied emoji upload after failed request',
        failureMessage: 'Failed to clean up proxied emoji upload after failed request',
        storage: storageService,
      });
      logger.error('Error creating custom emoji:', error);
      if (error.code === 'P2002') {
        res.status(409).json({ error: 'An emoji with this name already exists' });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get all custom emojis
   * GET /api/emojis
   */
  getAllCustomEmojis = async (_req: Request, res: Response): Promise<void> => {
    try {
      const emojis = await this.customEmojiRepository.findAll();

      // Transform emojis to frontend-friendly format
      const transformedEmojis = emojis.map(transformEmoji);

      res.status(200).json({
        success: true,
        emojis: transformedEmojis,
      });
    } catch (error) {
      logger.error('Error fetching custom emojis:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Get a single custom emoji by ID
   * GET /api/emojis/:emojiId
   */
  getCustomEmojiById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { emojiId } = req.params;

      const emoji = await this.customEmojiRepository.findById(emojiId);

      if (!emoji) {
        res.status(404).json({ error: 'Emoji not found' });
        return;
      }

      res.status(200).json({
        success: true,
        emoji: transformEmoji(emoji),
      });
    } catch (error) {
      logger.error('Error fetching custom emoji:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Stream emoji image
   * GET /api/emojis/:emojiId/stream
   */
  streamEmojiImage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { emojiId } = req.params;

      const emoji = await this.customEmojiRepository.findById(emojiId);

      if (!emoji) {
        res.status(404).json({ error: 'Emoji not found' });
        return;
      }

      const gcsPath = emoji.url;

      // Check if file exists in GCS
      const fileExists = await storageService.fileExists(gcsPath);
      if (!fileExists) {
        logger.error(`Emoji file not found in GCS: ${gcsPath}`);
        res.status(404).json({ error: 'Emoji image not found' });
        return;
      }

      // Get file metadata to determine content type and size
      const metadata = await storageService.getFileMetadata(gcsPath);
      const contentType = metadata.contentType || 'image/png';
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      // Set response headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

      // Stream the file directly from GCS
      const stream = await storageService.createReadStream(gcsPath);
      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error('Emoji stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream emoji image' });
        }
      });
    } catch (error) {
      logger.error('Error streaming emoji image:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream emoji image' });
      }
    }
  };

  /**
   * Delete a custom emoji
   * DELETE /api/emojis/:emojiId
   */
  deleteCustomEmoji = async (req: Request, res: Response): Promise<void> => {
    try {
      const { emojiId } = req.params;
      const userId = req.user!.id;

      // Find the emoji
      const emoji = await this.customEmojiRepository.findById(emojiId);

      if (!emoji) {
        res.status(404).json({ error: 'Emoji not found' });
        return;
      }

      // Check if user is the creator (or add admin check if needed)
      if (emoji.createdBy !== userId) {
        res.status(403).json({ error: 'You do not have permission to delete this emoji' });
        return;
      }

      // Delete the file from GCS
      try {
        await storageService.deleteFile(emoji.url);
      } catch (error) {
        logger.warn(`Failed to delete emoji file from GCS: ${emoji.url}`, error);
        // Continue with emoji deletion even if file deletion fails
      }

      // Delete the emoji record
      await this.customEmojiRepository.delete(emojiId);

      res.status(200).json({
        success: true,
        message: 'Custom emoji deleted successfully',
      });

      logger.info(`Custom emoji deleted: ${emoji.name} by user ${userId}`);
    } catch (error) {
      logger.error('Error deleting custom emoji:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const customEmojiController = new CustomEmojiController(new CustomEmojiRepository());
