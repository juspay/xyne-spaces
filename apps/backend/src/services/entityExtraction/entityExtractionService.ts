import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import vespaClient from '@/vespa/client';
import { entityResolver } from '@/services/entityExtraction/entityResolver';
import { entityLlm } from '@/services/entityExtraction/entityLlmClient';
import {
  collectThreadDocuments,
  writeEntitiesToVespa,
} from '@/services/entityExtraction/channelSource';
import { extractMentions, mergeConfig, type ExtractionType } from '@/services/entityExtraction/pipeline';

/**
 * Mention extraction + entity resolution, one thread at a time.
 *
 * Type discovery lives in claw-auth; the per-channel approved types (names +
 * rules + examples) are read whole from Vespa (chat_container.entityTypeDefs,
 * which claw publishes on approval). This backend owns the entity registry.
 * `processThread` is the worker's unit of work — extract → resolve → write-back.
 */
export class EntityExtractionService {
  private prisma = DatabaseClient.getInstance();

  private settings() {
    return mergeConfig({
      // Keep whole threads intact: the thread's full context is what makes
      // coreference work. Only genuinely huge threads split, and never truncate.
      fetchMessages: { maxThreadChars: 60_000 },
      // concurrency is bounded by the shared LiteLLM key's max_parallel_requests
      // (5). Other services use the same key, so we stay well under it.
      extract: {
        maxDocChars: 60_000,
        maxBatchChars: 60_000,
        concurrency: config.entityExtraction.concurrency,
      },
    });
  }

  /**
   * Process a single thread end to end. Fetch the thread (chat + ticket header +
   * mails), extract mentions against the channel's approved types, resolve them
   * into the registry, and write entity ids back onto its Vespa message docs.
   */
  async processThread(threadId: string) {
    const ctx = await this.resolveThread(threadId);
    if (!ctx) return { skipped: 'unknown-thread' as const };

    const types = await this.channelTypes(ctx.channelId);
    if (types.length === 0) return { skipped: 'no-approved-types' as const };

    const settings = this.settings();
    const channel = { id: ctx.channelId, name: ctx.channelName };
    const docs = await collectThreadDocuments(channel, threadId, settings);
    if (docs.length === 0) return { skipped: 'empty-thread' as const };

    const context = buildContext(config.entityExtraction.orgContext);
    const mentions = await extractMentions(docs, types, entityLlm, settings, context);
    const { stats, byDoc } = await entityResolver.resolveMentions(ctx.workspaceId, mentions);
    const written = await writeEntitiesToVespa(byDoc, docs);

    return { ...stats, messagesWritten: written.messages, ticketsWritten: written.tickets };
  }

  /**
   * The channel's approved types, shaped for the extractor — read whole from
   * Vespa (chat_container.entityTypeDefs, the JSON blob claw publishes on
   * approval). Empty means the channel is not entity-enabled.
   */
  private async channelTypes(channelId: string): Promise<ExtractionType[]> {
    return vespaClient.channelService.getChannelTypeDefs(channelId);
  }

  /** Resolve a thread (== conversationId) to its channel (id + name) + workspace. */
  private async resolveThread(
    threadId: string,
  ): Promise<{ channelId: string; workspaceId: string; channelName: string } | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { conversationId: threadId },
      select: { channelId: true },
    });
    if (!conv?.channelId) return null;
    const channel = await this.prisma.channel.findUnique({
      where: { id: conv.channelId },
      select: { workspaceId: true, name: true },
    });
    if (!channel?.workspaceId) return null;
    return {
      channelId: conv.channelId,
      workspaceId: channel.workspaceId,
      channelName: channel.name ?? conv.channelId,
    };
  }
}

/** Org-level framing prepended to the extraction prompt. */
export function buildContext(orgContext?: string): string {
  return orgContext && orgContext.trim() ? orgContext.trim() : '';
}

export const entityExtractionService = new EntityExtractionService();
