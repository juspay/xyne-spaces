import { createHash } from 'crypto';
import { MessageType } from '@prisma/client';
import { createVespaService } from 'vespa/src';
import vespaConfig from 'vespa/src/config';
import { config as envConfig } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { redisService } from '@/services/redisService';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';
import { messageClassifierService } from '@/services/messageClassifierService';
import type { TicketDuplicateCandidate } from '@/types/ticket';
import type { VespaSearchHit, VespaTicketDocument, importedTicketFields } from '@/vespa/src/types';

const vespaService = createVespaService({ logger, config: vespaConfig });

const MAX_CONTEXT_CHARS = 4000;
const MAX_CONTEXT_MESSAGES = 50;
const MIN_CONTEXT_MESSAGE_LENGTH = 10;
const MAX_TITLE_LENGTH = 120;

const COOLDOWN_PER_THREAD_SECONDS = 18000;
const COOLDOWN_PER_USER_SECONDS = 30;
const NUDGE_TTL_SECONDS = 18000;
const DUPLICATE_TEXT_TTL_SECONDS = 180;

const RETRIEVAL_CANDIDATE_LIMIT = 5;
const MIN_CLASSIFIER_CONFIDENCE = 0.5;
const MIN_LLM_CONFIDENCE_TO_NUDGE = 0.7;

type TicketNudgeContext = {
  channelId: string;
  conversationId: string;
  messageId: string;
  senderId: string;
  content: string;
  projectId: string;
};

class TicketNudgeService {
  private logger = logger.child({ module: 'ticketNudgeService' });

  async handleMessage(context: TicketNudgeContext): Promise<void> {
    try {
      this.logger.info('start', {
        channelId: context.channelId,
        conversationId: context.conversationId,
        messageId: context.messageId,
      });

      const threadContext = await this.buildThreadContext(context.conversationId, context.content);
      if (!threadContext) {
        this.logger.info('empty-thread-context');
        return;
      }

      const classificationResult = await messageClassifierService.classify(threadContext);
      this.logger.info('classification', {
        label: classificationResult.label,
        confidence: classificationResult.confidence,
      });

      if (classificationResult.label !== 'HEAVY' || classificationResult.confidence < MIN_CLASSIFIER_CONFIDENCE) {
        this.logger.info('classifier-rejected', {
          label: classificationResult.label,
          confidence: classificationResult.confidence,
        });
        return;
      }

      const cooldownResult = await this.checkCooldowns(context, threadContext);
      if (!cooldownResult.allowed) {
        this.logger.info('cooldown-block', { reason: cooldownResult.reason });
        return;
      }

      const candidates = await this.retrieveCandidates(threadContext, context);
      this.logger.info('retrieval', { candidateCount: candidates.length });
      if (!candidates.length) {
        return;
      }

      const ticket = this.buildTicketFromContext(threadContext);
      if (!ticket) {
        return;
      }

      const analysis = await ticketDuplicateService.analyzeDuplicate(
        ticket,
        candidates,
        {
          userId: context.senderId,
          projectId: context.projectId,
        },
      );

      if (!analysis.isDuplicate || !analysis.duplicateTicketId) {
        this.logger.info('llm-no-duplicate', { confidence: analysis.confidence, reason: analysis.reason });
        return;
      }

      if ((analysis.confidence ?? 0) < MIN_LLM_CONFIDENCE_TO_NUDGE) {
        this.logger.info('llm-low-confidence', { confidence: analysis.confidence });
        return;
      }

      const matchedCandidate = candidates.find(
        candidate => candidate.id === analysis.duplicateTicketId,
      );
      if (!matchedCandidate) {
        return;
      }

      await this.sendNudge(context, matchedCandidate, {
        classifierConfidence: classificationResult.confidence,
        llmConfidence: analysis.confidence ?? 0,
        reason: analysis.reason,
      });
      await this.recordCooldowns(context, cooldownResult.normalizedHash);

      this.logger.info('nudge-sent', { ticketId: matchedCandidate.id });
    } catch (error) {
      logger.error('Ticket nudge evaluation failed', error);
    }
  }

  private async buildThreadContext(
    conversationId: string,
    currentContent: string,
  ): Promise<string | null> {
    const recentMessages = await db.message.findMany({
      where: {
        conversationId,
        msgType: MessageType.USER,
        isDeleted: false,
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_CONTEXT_MESSAGES,
      select: { content: true },
    });

    const normalizedMessages = recentMessages
      .map(message => this.normalizePlainText(message.content))
      .filter(text => text.length >= MIN_CONTEXT_MESSAGE_LENGTH)
      .reverse();

    if (normalizedMessages.length === 0) {
      const fallback = this.normalizePlainText(currentContent);
      return fallback ? fallback.slice(0, MAX_CONTEXT_CHARS) : null;
    }

    const combined = normalizedMessages.join('\n');
    return combined.length > MAX_CONTEXT_CHARS ? combined.slice(0, MAX_CONTEXT_CHARS) : combined;
  }

  private normalizePlainText(content: string): string {
    const plainText = extractPlainTextFromHtml(content || '');
    return plainText.replace(/\s+/g, ' ').trim();
  }

  private async checkCooldowns(
    context: TicketNudgeContext,
    normalizedText: string,
  ): Promise<{ allowed: boolean; reason?: string; normalizedHash?: string }> {
    const redis = redisService.getClient();
    const projectId = context.projectId;

    const threadCooldownKey = `ticket-nudge:cooldown:thread:${projectId}:${context.conversationId}`;
    const userCooldownKey = `ticket-nudge:cooldown:user:${projectId}:${context.senderId}`;
    const duplicateHashKey = `ticket-nudge:last-hash:${projectId}:${context.conversationId}:${context.senderId}`;
    const nudgeTtlKey = `ticket-nudge:nudge-ttl:${projectId}:${context.conversationId}`;

    const [existingNudge, existingThreadCooldown, existingUserCooldown] = await Promise.all([
      redis.get(nudgeTtlKey),
      redis.get(threadCooldownKey),
      redis.get(userCooldownKey),
    ]);
    if (existingNudge) {
      return { allowed: false, reason: 'nudgeTtlActive' };
    }

    if (existingThreadCooldown) {
      return { allowed: false, reason: 'threadCooldownActive' };
    }

    if (existingUserCooldown) {
      return { allowed: false, reason: 'userCooldownActive' };
    }

    const normalizedHash = createHash('sha256').update(normalizedText).digest('hex');
    const existingHash = await redis.get(duplicateHashKey);
    if (existingHash && existingHash === normalizedHash) {
      return { allowed: false, reason: 'duplicateText' };
    }

    return { allowed: true, normalizedHash };
  }

  private async recordCooldowns(
    context: TicketNudgeContext,
    normalizedHash?: string,
  ): Promise<void> {
    if (!normalizedHash) {
      return;
    }

    const redis = redisService.getClient();
    const projectId = context.projectId;

    const threadCooldownKey = `ticket-nudge:cooldown:thread:${projectId}:${context.conversationId}`;
    const userCooldownKey = `ticket-nudge:cooldown:user:${projectId}:${context.senderId}`;
    const duplicateHashKey = `ticket-nudge:last-hash:${projectId}:${context.conversationId}:${context.senderId}`;
    const nudgeTtlKey = `ticket-nudge:nudge-ttl:${projectId}:${context.conversationId}`;

    await Promise.all([
      redis.setex(duplicateHashKey, DUPLICATE_TEXT_TTL_SECONDS, normalizedHash),
      redis.set(threadCooldownKey, '1', 'EX', COOLDOWN_PER_THREAD_SECONDS),
      redis.set(userCooldownKey, '1', 'EX', COOLDOWN_PER_USER_SECONDS),
      redis.setex(nudgeTtlKey, NUDGE_TTL_SECONDS, '1'),
    ]);
  }

  private async retrieveCandidates(
    query: string,
    context: TicketNudgeContext,
  ): Promise<TicketDuplicateCandidate[]> {
    try {
      const results = await vespaService.searchService.searchVespa(
        query,
        context.senderId,
        ['ticket'],
        {
          offset: 0,
          limit: RETRIEVAL_CANDIDATE_LIMIT,
          ticket: {
            projectId: [context.projectId],
          },
          slack: {},
        },
      );

      const hits = (results.root.children || []) as VespaSearchHit[];
      const candidates = hits
        .filter(hit => hit.fields?.docType === 'ticket')
        .slice(0, RETRIEVAL_CANDIDATE_LIMIT)
        .map(hit => this.mapTicketCandidate(hit));

      return candidates.filter(candidate => candidate.title);
    } catch (error) {
      logger.error('Ticket nudge Vespa retrieval failed', error);
      return [];
    }
  }

  private mapTicketCandidate(hit: VespaSearchHit): TicketDuplicateCandidate {
    const doc = hit.fields as VespaTicketDocument & importedTicketFields;
    const createdAt = doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined;
    return {
      id: doc.docId,
      title: doc.title || '',
      description: doc.description || '',
      status: doc.status,
      boardId: doc.boardId,
      channelId: doc.channelId,
      conversationId: doc.convId || doc.threadId,
      createdAt,
      relevanceScore: hit.relevance,
    };
  }

  private buildTicketFromContext(text: string): { title: string; description: string } | null {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    const titleSource = trimmed.replace(/\s+/g, ' ');
    const title = titleSource.length > MAX_TITLE_LENGTH
      ? `${titleSource.slice(0, MAX_TITLE_LENGTH - 3)}...`
      : titleSource;
    const description = trimmed;

    if (!title.trim() || !description.trim()) {
      return null;
    }

    return { title, description };
  }

  private async sendNudge(
    context: TicketNudgeContext,
    candidate: TicketDuplicateCandidate,
    details: {
      classifierConfidence: number;
      llmConfidence: number;
      reason?: string;
    },
  ): Promise<void> {
    const link = this.buildTicketLink(candidate);
    const rawTitle = candidate.title || 'Similar ticket';
    const plainTitle = extractPlainTextFromHtml(rawTitle) || rawTitle;
    const title = this.escapeHtml(plainTitle);
    const content = link
      ? `Similar ticket found: <a href="${link}">${title}</a>`
      : `Similar ticket found: ${title}`;

    await repositories.messages.create({
      conversationId: context.conversationId,
      senderId: 'system',
      content,
      msgType: MessageType.SYSTEM,
      showInChannel: false,
      visibleTo: context.senderId,
      metadata: {
        messageSubtype: 'ticket_nudge',
        ticketId: candidate.id,
        classifierConfidence: details.classifierConfidence,
        llmConfidence: details.llmConfidence,
        reason: details.reason,
      },
    });
  }

  private buildTicketLink(candidate: TicketDuplicateCandidate): string | null {
    const baseUrl = envConfig.slackFrontendUrl;

    if (!candidate.channelId) {
      return null;
    }

    const params = new URLSearchParams({
      tab: 'tickets',
      ticketId: candidate.id,
    });

    if (candidate.conversationId) {
      params.set('conversationId', candidate.conversationId);
    }

    return `${baseUrl}/chat/${candidate.channelId}?${params.toString()}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

}

export const ticketNudgeService = new TicketNudgeService();
