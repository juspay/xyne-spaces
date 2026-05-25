import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';

const UpdateTagsConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)),
  tags: z
    .array(z.string().min(1))
    .min(1)
    .describe('Tag names to add. Press Enter after each one. Tags already on the ticket are kept.'),
});

const UpdateTagsOutputSchema = z.object({
  ticketId: z.string(),
  addedTags: z.array(z.string()),
  alreadyPresentTags: z.array(z.string()),
});

interface UpdateTagsOutput extends Record<string, unknown> {
  ticketId: string;
  addedTags: string[];
  alreadyPresentTags: string[];
}

export class UpdateTagsStep extends BaseActionStep<typeof UpdateTagsConfigSchema, UpdateTagsOutput> {
  readonly type = 'UPDATE_TAGS';
  readonly configSchema = UpdateTagsConfigSchema;
  readonly outputSchema = UpdateTagsOutputSchema;
  readonly name = 'Add or update ticket tags';
  readonly description =
    'Adds one or more tags to a ticket. Tags already on the ticket are kept as-is (no duplicates).';
  readonly category = StepCategory.TICKET;
  readonly icon = 'Tag';

  async execute(
    config: z.infer<typeof UpdateTagsConfigSchema>,
  ): Promise<UpdateTagsOutput> {
    const ticketId = config.ticketId as string;
    const { added, alreadyPresent } = await repositories.tickets.addTagsByName(
      ticketId,
      config.tags as string[],
    );
    logger.info(
      `[automations] UPDATE_TAGS ticket=${ticketId} added=[${added.join(',')}] alreadyPresent=[${alreadyPresent.join(',')}]`,
    );
    return { ticketId, addedTags: added, alreadyPresentTags: alreadyPresent };
  }
}

export const updateTagsStep = new UpdateTagsStep();
