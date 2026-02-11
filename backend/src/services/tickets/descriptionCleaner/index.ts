import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { cleanTicketDescriptionHtml } from './htmlCleaner';
import { cleanTicketDescriptionWithLlm } from '@/agents/ticket-cleaning-and-themes';
import { ChannelType } from '@prisma/client';

export interface TicketDescriptionCleanerResult {
  description_clean: string;
  description_images: string[];
  usedLlm: boolean;
  llmError?: string;
}

export async function descCleaner(
  rawHtml: string,
  title?: string,
  channelType?: ChannelType | null,
): Promise<TicketDescriptionCleanerResult> {
  const { cleaned, images } = cleanTicketDescriptionHtml(rawHtml || '');
  if (!cleaned) {
    return { description_clean: '', description_images: images, usedLlm: false };
  }
  const shouldUseLlm = Boolean(config.litellm.apiKey) && channelType === ChannelType.EMAIL;

  if (!shouldUseLlm) {
    return { description_clean: cleaned, description_images: images, usedLlm: false };
  }

  const input = {
    title: title || '',
    description: cleaned,
    description_images: images,
  };

  try {
    const result = await cleanTicketDescriptionWithLlm(input);
    return {
      description_clean: result.description || cleaned,
      description_images: images,
      usedLlm: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn('[TicketDescriptionCleaner] LLM call failed, falling back to HTML clean', {
      error: errorMessage,
    });
    return {
      description_clean: cleaned,
      description_images: images,
      usedLlm: false,
      llmError: errorMessage,
    };
  }
}
