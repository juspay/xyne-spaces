import { z } from 'zod';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { eventRouter } from '../engine/event-router';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { TicketContextSchema, buildTicketContext } from './ticket-context';
import { DESK_EMAIL_SOURCE_TYPE } from '@/tags';
import { TAG_FORMAT_REGEX } from '@xyne/shared';

export const TAG_GENERATED_EVENT = 'TAG_GENERATED';

const TagGeneratedConfigSchema = z.object({
  channelIds: z
    .array(z.string())
    .optional()
    .describe(
      'Limit to specific email-inbox channels. At least one channel is required to scope this trigger.',
    ),
  categories: z
    .array(z.string().regex(TAG_FORMAT_REGEX, 'Category must be lowercase hyphen-separated'))
    .optional()
    .describe(
      'Only fire when tags were generated for at least one of these categories. Empty matches any category.',
    ),
});

const GeneratedTagSchema = z.object({
  category: z.string(),
  tag: z.string(),
  reason: z.string().nullable(),
});

const EmailContextSchema = z.object({
  id: z.string(),
  subject: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  conversationId: z.string(),
  channelId: z.string(),
});

export const TagGeneratedOutputSchema = TicketContextSchema.partial().extend({
  sourceId: z.string(),
  sourceType: z.string(),
  channelId: z.string(),
  generatedTags: z.array(GeneratedTagSchema),
  priorityTag: z.string().nullable(),
  email: EmailContextSchema.nullable(),
});

type TagGeneratedConfig = z.infer<typeof TagGeneratedConfigSchema>;
type TagGeneratedPayload = {
  sourceId: string;
  sourceType: string;
  channelId: string;
  tags: Array<{ category: string; tag: string; reason: string | null }>;
};
type TagGeneratedOutput = z.infer<typeof TagGeneratedOutputSchema>;

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value];
  return [];
}

export class TagGeneratedTrigger extends BaseTrigger<typeof TagGeneratedConfigSchema> {
  readonly type = TAG_GENERATED_EVENT;
  readonly configSchema = TagGeneratedConfigSchema;
  readonly outputSchema = TagGeneratedOutputSchema;
  readonly name = 'When tags are generated';
  readonly description =
    'Fires after the AI tag pipeline writes tags for a desk email. Filter by channel or tag category to narrow when this trigger fires.';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'Tag';
  readonly scopeFilterFields = ['channelIds'];

  async hydratePayload(payload: TagGeneratedPayload): Promise<TagGeneratedOutput> {
    const { sourceId, sourceType, channelId, tags } = payload;
    if (sourceType !== DESK_EMAIL_SOURCE_TYPE) {
      return { sourceId, sourceType, channelId, generatedTags: [], priorityTag: null, email: null };
    }

    const email = await repositories.emails.findById(sourceId);
    if (!email) return { sourceId, sourceType, channelId, generatedTags: [], priorityTag: null, email: null };

    const ticketRef = await repositories.tickets
      .findFirstByConversationId(email.conversationId)
      .catch(() => null);

    const fullTicket = ticketRef
      ? await repositories.tickets.getTicketById(ticketRef.id).catch(() => null)
      : null;

    const ticketContext =
      fullTicket ? await buildTicketContext(fullTicket).catch(() => null) : null;

    logger.info(
      `[TAG-GENERATED] hydratePayload sourceId=${sourceId} generatedTags=${tags.length} categories=[${[...new Set(tags.map(t => t.category))].join(',')}]`,
    );

    const priorityTag = tags.find(t => t.category === 'priority')?.tag?.toUpperCase() ?? null;

    return {
      sourceId,
      sourceType,
      channelId,
      ...(ticketContext ?? {}),
      generatedTags: tags,
      priorityTag,
      email: {
        id: email.id,
        subject: email.subject,
        from: email.from,
        to: email.to,
        conversationId: email.conversationId,
        channelId: email.channelId,
      },
    };
  }

  matchFilters(filter: TagGeneratedConfig, payload: TagGeneratedOutput): boolean {
    try {
      return matchTagGenerated(filter, payload);
    } catch (err) {
      logger.error('[automations] TAG_GENERATED matchFilters threw — treating as no-match:', err);
      return false;
    }
  }
}

export const tagGeneratedTrigger = new TagGeneratedTrigger();

function matchTagGenerated(
  cfg: TagGeneratedConfig,
  payload: { channelId: string; generatedTags?: Array<{ category: string }> },
): boolean {
  const channelIds = asStringArray(cfg.channelIds);
  if (channelIds.length > 0 && !channelIds.includes(payload.channelId)) return false;

  const categories = asStringArray(cfg.categories);
  if (categories.length > 0) {
    const presentCategories = (payload.generatedTags ?? []).map(t => t.category);
    if (!categories.some(c => presentCategories.includes(c))) return false;
  }
  return true;
}

export async function emitTagGenerated(result: {
  sourceId: string;
  sourceType: string;
  tags: Array<{ category: string; tag: string; reason: string | null }>;
}): Promise<void> {
  try {
    if (result.sourceType !== DESK_EMAIL_SOURCE_TYPE) {
      logger.info('[automations] emitTagGenerated skipped — unsupported sourceType', {
        sourceType: result.sourceType,
      });
      return;
    }

    const email = await repositories.emails.findById(result.sourceId);
    if (!email) {
      logger.warn('[automations] emitTagGenerated dropped — email not found', {
        sourceId: result.sourceId,
        sourceType: result.sourceType,
      });
      return;
    }

    const channel = await repositories.channels.findById(email.channelId).catch(() => null);
    if (!channel?.workspaceId) {
      logger.warn('[automations] emitTagGenerated dropped — could not resolve workspaceId', {
        sourceId: result.sourceId,
        channelId: email.channelId,
      });
      return;
    }

    await eventRouter.emit(
      {
        type: TAG_GENERATED_EVENT,
        payload: {
          sourceId: result.sourceId,
          sourceType: result.sourceType,
          channelId: email.channelId,
          tags: result.tags,
        },
      },
      channel.workspaceId,
    );
  } catch (err) {
    logger.error('[automations] emitTagGenerated failed', {
      sourceId: result.sourceId,
      sourceType: result.sourceType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
