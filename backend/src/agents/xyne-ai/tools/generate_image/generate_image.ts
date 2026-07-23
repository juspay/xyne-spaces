import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { AttachmentEntityType } from '@prisma/client';
import { logger } from '../../../../utils/logger.js';
import type { XyneAIAgentContext } from '../types.js';
import { getDescription } from '../helpers.js';
import { getStorageService } from '../../../../services/storage/index.js';

import { MessageAttachmentRepository } from '../../../../database/repositories/messageAttachmentRepository.js';
import { ChannelRepository } from '../../../../database/repositories/channelRepository.js';
import { config } from '../../../../config/env.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../../../agentLogger.js';
import { orgLLMCredentialService } from '../../../../services/orgLLMCredentialService.js';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

const storageService = getStorageService();

const AGENT_NAME = 'GenerateImage';

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
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
        const credential = await orgLLMCredentialService.getCredentialByUserId(
          context.userId,
          OrgLLMServiceAccountPurpose.ASK_AI,
        );
        if (!credential) {
          throw new Error('LiteLLM credentials are not configured for this organization');
        }

        // Log LLM call start
        logLLMCallStart(AGENT_NAME, imageModel, 'ASK_AI_API_KEY');

        const imgRes = await fetch(imageEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${credential.apiKey}`,
          },
          body: JSON.stringify({ model: imageModel, prompt, height, width }),
        });

        if (!imgRes.ok) {
          const text = await imgRes.text().catch(() => '');
          throw new Error(`Image generation failed: ${imgRes.status} — ${text.slice(0, 300)}`);
        }

        const imgData = await imgRes.json() as {
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

        // Log success (we'll log the image generation success)
        logLLMSuccess(AGENT_NAME, `Generated ${imageBuffer.length} byte image`);

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
        logLLMError(AGENT_NAME, error);
        logger.error(`[Tool] [${context.sessionId}] generate_image error: ${msg}`, error);
        return `Error generating image: ${msg}`;
      }
    },
  };
}

export function getGenerateImageTool() {
  return createGenerateImageTool();
}
