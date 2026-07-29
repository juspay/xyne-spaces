import { logger } from '@/utils/logger';
import { cleanTicketDescriptionHtml } from './htmlCleaner';
import { cleanTicketDescriptionWithLlm } from '@/agents/ticket-cleaning-and-themes';
import { ChannelType } from '@prisma/client';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

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
  projectId?: string | null,
): Promise<TicketDescriptionCleanerResult> {
  const { cleaned, images } = cleanTicketDescriptionHtml(rawHtml || '');
  if (!cleaned) {
    return { description_clean: '', description_images: images, usedLlm: false };
  }
  const credential = await orgLLMCredentialService.getCredentialByProjectId(
    projectId,
    OrgLLMServiceAccountPurpose.DEFAULT,
  );
  const shouldUseLlm = Boolean(credential) && channelType === ChannelType.EMAIL;

  if (!shouldUseLlm) {
    return { description_clean: cleaned, description_images: images, usedLlm: false };
  }

  const input = {
    title: title || '',
    description: cleaned,
    description_images: images,
  };

  try {
    const result = await cleanTicketDescriptionWithLlm(input, { projectId: projectId! });
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
