import { z } from 'zod';
import https from 'node:https';
import { type Tool } from '@juspay-jaf/jaf';
import { AttachmentEntityType } from '@prisma/client';
import { logger } from '../../../../utils/logger.js';
import type { XyneAIAgentContext } from '../types.js';
import { getDescription } from '../helpers.js';
import { getStorageService } from '../../../../services/storage/index.js';

import { MessageAttachmentRepository } from '../../../../database/repositories/messageAttachmentRepository.js';
import { ChannelRepository } from '../../../../database/repositories/channelRepository.js';
import { config } from '../../../../config/env.js';

const storageService = getStorageService();

function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchBuffer(res.headers.location).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

export function createGenerateImageTool(): Tool<
  { prompt: string; height?: number; width?: number },
  XyneAIAgentContext
> {
  return {
    schema: {
      name: 'generate_image',
      description: getDescription('generate_image'),
      parameters: z.object({
        prompt: z.string().describe(
          'Detailed description of the image to generate. Include subject, style, colors, mood, and composition for best results.'
        ),
        height: z.number().int().optional().default(1024).describe(
          'Height of the generated image in pixels (default: 1024).'
        ),
        width: z.number().int().optional().default(1024).describe(
          'Width of the generated image in pixels (default: 1024).'
        ),
      }),
    },
    execute: async (args, context) => {
      const { prompt, height = 1024, width = 1024 } = args;
      const imageModel = config.litellm.imageGenerationModel;
      const imageEndpoint = config.litellm.imageGenerationEndpoint;
      logger.info(
        `[Tool] [${context.sessionId}] generate_image: model=${imageModel}, ${width}x${height}, prompt="${prompt.slice(0, 80)}"`
      );

      try {
        const imgRes = await httpsPost(
          imageEndpoint,
          JSON.stringify({ model: imageModel, prompt, height, width }),
          {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.litellm.apiKey}`,
          }
        );

        if (imgRes.status < 200 || imgRes.status >= 300) {
          throw new Error(`Image generation failed: ${imgRes.status} — ${imgRes.text.slice(0, 300)}`);
        }

        const imgData = JSON.parse(imgRes.text) as {
          data?: Array<{ b64_json?: string; url?: string }>;
        };

        const item = imgData.data?.[0];
        if (!item) throw new Error('No image data returned from model');

        let imageBuffer: Buffer;
        let mimeType = 'image/png';
        let ext = 'png';

        if (item.b64_json) {
          imageBuffer = Buffer.from(item.b64_json, 'base64');
        } else if (item.url) {
          const urlLower = item.url.toLowerCase();
          if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) { mimeType = 'image/jpeg'; ext = 'jpg'; }
          else if (urlLower.includes('.webp')) { mimeType = 'image/webp'; ext = 'webp'; }
          imageBuffer = await fetchBuffer(item.url);
        } else {
          throw new Error('Response contained neither b64_json nor url');
        }

        const safePrompt = prompt.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        const filename = `${safePrompt}.${ext}`;

        const gcsResult = await storageService.uploadFile(imageBuffer, {
          filename,
          contentType: mimeType,
          metadata: { prompt, source: 'xyne-ai-generate-image' },
          scopeType: 'ASKAI',
          scopeId: context.sessionId,
        });


        const messageAttachmentRepo = new MessageAttachmentRepository();
        const channelRepository = new ChannelRepository();
        const workspaceId = context.channelIds.length > 0
          ? await channelRepository.getWorkspaceId(context.channelIds[0])
          : '';
        const attachment = await messageAttachmentRepo.create({
          entityId: context.conversationId ?? context.sessionId,
          entityType: AttachmentEntityType.CHAT,
          originalFilename: filename,
          size: gcsResult.size,
          mimetype: mimeType,
          url: gcsResult.path,
          uploadedByUserId: context.userId,
          createdBy: context.userId,
          storageProvider: config.fileStorage.provider,
          conversationId: context.conversationId ?? null,
          workspaceId,
          metadata: { prompt, height, width, type: 'image', source: 'generate_image' },
        });

        logger.info(
          `[Tool] [${context.sessionId}] generate_image: uploaded ${gcsResult.path} (${(imageBuffer.length / 1024).toFixed(0)}KB), attachmentId=${attachment.id}`
        );

        const isLocalDev = (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') && config.gcs.fakeGcsHost;
        return isLocalDev
          ? `http://${config.gcs.fakeGcsHost}/download/storage/v1/b/${config.gcs.bucketName}/o/${encodeURIComponent(gcsResult.path)}?alt=media`
          : `/api/attachments/${attachment.id}/download`;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[Tool] [${context.sessionId}] generate_image error: ${msg}`, error);
        return `Error generating image: ${msg}`;
      }
    },
  };
}

export function getGenerateImageTool() {
  return createGenerateImageTool();
}