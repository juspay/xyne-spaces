/**
 * Email Attachment Upload Controller
 *
 * POST /api/email/:conversationId/upload-attachments
 *
 * Provider-agnostic: dispatches each request to a strategy based on the
 * channel's connected source.
 *   • Zoho            → posts to Zoho's `/api/v1/uploads`, returns Zoho-native ids.
 *   • Microsoft/Google → uploads to GCS via the shared storage service and
 *                        stages a `MessageAttachment` row; returns the row id.
 *
 * (Filename kept as `zohoUploadController` for route-import stability.)
 */

import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { ExternalSource, AttachmentEntityType } from '@prisma/client';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { decrypt } from '@/services/encryptionService';
import { uploadFiles } from '@/services/fileUploadService';
import { repositories } from '@/database/repositories';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { ExternalSourcePlatform } from '@/integrations/core/types';

const PENDING_ENTITY_PREFIX = 'pending-email:';
const PENDING_COMPOSE_ENTITY_PREFIX = 'pending-compose:';

interface UploadContext {
  files: Express.Multer.File[];
  externalSource: ExternalSource;
  conversationId?: string;
  channelId: string;
  userId: string;
  workspaceId: string;
}

interface UploadOutcome {
  ids: string[];
  failures: Array<{ filename: string; error: string }>;
}

type Uploader = (ctx: UploadContext) => Promise<UploadOutcome>;

export class ZohoUploadController {
  private externalSourceRepo = new ExternalSourceRepository();
  private channelRepo = new ChannelRepository();
  private conversationRepo = new ConversationRepository();

  // Strategy table — one entry per supported source type. Adding a provider
  // = registering a new uploader here.
  private readonly uploaders: Record<string, Uploader> = {
    [ExternalSourcePlatform.ZOHO]: this.uploadToZoho.bind(this),
    [ExternalSourcePlatform.MICROSOFT]: this.uploadToGcsAndStage.bind(this),
    [ExternalSourcePlatform.GOOGLE]: this.uploadToGcsAndStage.bind(this),
  };

  uploadAttachments = async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const files = req.files as Express.Multer.File[] | undefined;

      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const conversation = await this.conversationRepo.findById(conversationId);
      if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

      const channel = await this.channelRepo.findById(conversation.channelId);
      if (!channel) return res.status(404).json({ error: 'Channel not found' });

      const externalSource = await this.externalSourceRepo.findByChannelId(channel.id);
      if (!externalSource) return res.status(404).json({ error: 'External source not found' });

      const uploader = this.uploaders[externalSource.sourceType];
      if (!uploader) {
        return res
          .status(400)
          .json({ error: `Unsupported source type: ${externalSource.sourceType}` });
      }

      const { ids: attachmentIds, failures } = await uploader({
        files,
        externalSource,
        conversationId,
        channelId: channel.id,
        userId: req.user?.id ?? 'system',
        workspaceId: channel.workspaceId,
      });

      return res.status(200).json({
        success: true,
        attachmentIds,
        ...(failures.length > 0 && { failures }),
      });
    } catch (error: any) {
      logger.error('[emailUpload] Failed to upload attachments:', error);
      return res.status(500).json({
        error: 'Failed to upload attachments',
        message: error?.message ?? 'unknown',
      });
    }
  };

  uploadComposeAttachments = async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const files = req.files as Express.Multer.File[] | undefined;

      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const channel = await this.channelRepo.findById(channelId);
      if (!channel) return res.status(404).json({ error: 'Channel not found' });

      const externalSource = await this.externalSourceRepo.findByChannelId(channel.id);
      if (!externalSource) return res.status(404).json({ error: 'External source not found' });

      const uploader = this.uploaders[externalSource.sourceType];
      if (!uploader) {
        return res
          .status(400)
          .json({ error: `Unsupported source type: ${externalSource.sourceType}` });
      }

      const { ids: attachmentIds, failures } = await uploader({
        files,
        externalSource,
        channelId: channel.id,
        userId: req.user?.id ?? 'system',
        workspaceId: channel.workspaceId,
      });

      return res.status(200).json({
        success: true,
        attachmentIds,
        ...(failures.length > 0 && { failures }),
      });
    } catch (error: any) {
      logger.error('[emailUpload] Failed to upload compose attachments:', error);
      return res.status(500).json({
        error: 'Failed to upload attachments',
        message: error?.message ?? 'unknown',
      });
    }
  };

  // ─── Zoho strategy (unchanged behavior) ────────────────────────────────────

  private async uploadToZoho(ctx: UploadContext): Promise<UploadOutcome> {
    const credentials = JSON.parse(decrypt(ctx.externalSource.credentials));

    let accessToken: string;
    let orgId: string;

    if (credentials.refreshToken && credentials.clientId && credentials.clientSecret) {
      // OAuth-refresh-token credential format.
      const { ZohoService } = await import('@/services/zohoService');
      const zohoService = new ZohoService(credentials, ctx.externalSource.id);
      accessToken = await zohoService.getAccessToken(
        'Desk.tickets.CREATE Desk.basic.CREATE',
      );
      orgId = credentials.orgId;
    } else if (credentials.apiKey) {
      // Legacy api-key credential format.
      accessToken = credentials.apiKey;
      orgId = credentials.orgId;
    } else {
      throw new Error('Unknown Zoho credential format. Expected apiKey or refreshToken format.');
    }

    const settled = await Promise.allSettled(
      ctx.files.map(file => this.uploadFileToZoho(file, accessToken, orgId)),
    );
    const ids: string[] = [];
    const failures: UploadOutcome['failures'] = [];
    settled.forEach((r, i) => {
      const filename = ctx.files[i]?.originalname ?? '<unknown>';
      if (r.status === 'fulfilled' && r.value) {
        ids.push(r.value);
      } else if (r.status === 'fulfilled' && !r.value) {
        failures.push({
          filename,
          error: 'Zoho upload returned no attachment id',
        });
      } else if (r.status === 'rejected') {
        failures.push({
          filename,
          error: r.reason instanceof Error ? r.reason.message : 'unknown',
        });
      }
    });
    return { ids, failures };
  }

  private async uploadFileToZoho(
    file: Express.Multer.File,
    accessToken: string,
    orgId: string,
  ): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append('file', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype,
      });
      const response = await axios.post(
        'https://desk.zoho.com/api/v1/uploads',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            orgId,
            Authorization: `Zoho-oauthtoken ${accessToken}`,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        },
      );
      return response.data.id as string;
    } catch (error: any) {
      logger.error(`[emailUpload] Zoho upload failed for ${file.originalname}: ${error?.message}`);
      return null;
    }
  }

  // ─── GCS strategy (Microsoft / Google) ─────────────────────────────────────

  // Uploads to GCS and stages a MessageAttachment row with a sentinel
  // entityId. The reply-send path resolves these by id, fetches the bytes
  // back from GCS, attaches them to the outbound mail, and rewires the row's
  // entityId to the new Email.id so the file shows under the sent message.
  private async uploadToGcsAndStage(ctx: UploadContext): Promise<UploadOutcome> {
    const uploaded = await uploadFiles(ctx.files);
    if (uploaded.length === 0) return { ids: [], failures: [] };

    const pendingEntityId = ctx.conversationId
      ? `${PENDING_ENTITY_PREFIX}${ctx.conversationId}`
      : `${PENDING_COMPOSE_ENTITY_PREFIX}${ctx.channelId}`;

    const results = await Promise.allSettled(
      uploaded.map(file =>
        repositories.messageAttachments.create({
          entityId: pendingEntityId,
          entityType: AttachmentEntityType.EMAIL,
          originalFilename: file.originalName,
          size: file.fileSize,
          mimetype: file.mimeType,
          url: file.fileUrl,
          ...(file.thumbnailUrl ? { thumbnailUrl: file.thumbnailUrl } : {}),
          ...(file.width !== undefined ? { width: file.width } : {}),
          ...(file.height !== undefined ? { height: file.height } : {}),
          uploadedByUserId: ctx.userId,
          createdBy: ctx.userId,
          storageProvider: config.fileStorage.provider,
          conversationId: ctx.conversationId ?? null,
          workspaceId: ctx.workspaceId,
          metadata: { pending: true, pendingEntityId, ...(file.metadata ?? {}) },
        }),
      ),
    );

    const ids: string[] = [];
    const failures: UploadOutcome['failures'] = [];
    results.forEach((r, i) => {
      const filename = uploaded[i]?.originalName ?? '<unknown>';
      if (r.status === 'fulfilled') {
        ids.push(r.value.id);
      } else {
        const error = r.reason instanceof Error ? r.reason.message : 'unknown';
        logger.error(`[emailUpload] Failed to stage attachment for ${filename}: ${error}`);
        failures.push({ filename, error });
      }
    });
    return { ids, failures };
  }
}
