import { Request, Response } from 'express';
import { TicketReferenceRelation } from '@prisma/client';
import { ApiResponse } from '@/types/express';
import { DatabaseClient } from '@/database/client';
import { logger as baseLogger } from '@/utils/logger';
import { vespaService } from '@/services/vespaSearch';
import { transformVespaResults } from '@/services/vespaSearch/resultTransform';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';
import type { TicketDuplicateCandidate, TicketDuplicateCheckAnalysis } from '@/types/ticket';

const prisma = DatabaseClient.getInstance();
const logger = baseLogger.child({ module: 'TicketDuplicateBackfill' });
const DUPLICATE_DUE_DATE = new Date('2026-03-31T00:00:00.000Z');

interface BackfillStats {
  totalTickets: number;
  processedTickets: number;
  skippedExistingReference: number;
  skippedEmpty: number;
  skippedShortText: number;
  skippedNoCandidates: number;
  skippedLowRelevance: number;
  llmCalls: number;
  duplicatesFound: number;
  referencesCreated: number;
  dueDatesUpdated: number;
  failedTickets: number;
  startTime: Date;
  endTime?: Date;
}

interface BackfillConfig {
  batchSize: number;
  candidateLimit: number;
  minRelevance: number;
  minTextLength: number;
  sleepMs: number;
  maxTickets: number;
  dryRun: boolean;
  projectId?: string | null;
}

interface BackfillConfigInput {
  batchSize?: number;
  candidateLimit?: number;
  minRelevance?: number;
  minTextLength?: number;
  sleepMs?: number;
  maxTickets?: number;
  dryRun?: boolean;
  projectId?: string | null;
}

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
};

const getDuplicateCandidates = async (params: {
  ticketId: string;
  title: string;
  description: string;
  projectId: string;
  userId: string;
  limit: number;
}): Promise<TicketDuplicateCandidate[]> => {
  const { ticketId, title, description, projectId, userId, limit } = params;
  const query = `${title}\n\n${description}`.trim();

  if (!query) {
    return [];
  }

  const vespaResults = await vespaService.searchService.searchVespa(
    query,
    userId,
    ['ticket'],
    {
      offset: 0,
      limit,
      ticket: {
        projectId: [projectId],
      },
    },
  );

  const hits = vespaResults.root.children || [];
  const transformedResults = await transformVespaResults(hits, prisma);

  return transformedResults
    .filter(result => result.type === 'ticket' && result.id !== ticketId)
    .map(result => ({
      id: result.id,
      title: result.title,
      description: result.context || '',
      boardId: result.searchContext?.boardId,
      status: result.searchContext?.ticketStatus || result.metadata.status,
      stage: result.subtitle,
      relevanceScore: result.relevanceScore,
      channelId: result.searchContext?.channelId,
      createdAt: result.metadata.timestamp,
    }));
};

const logFinalStats = (stats: BackfillStats): void => {
  const durationSeconds = stats.endTime
    ? (stats.endTime.getTime() - stats.startTime.getTime()) / 1000
    : 0;

  logger.info('Duplicate backfill completed');
  logger.info('==========================================');
  logger.info(`Total tickets: ${stats.totalTickets}`);
  logger.info(`Processed tickets: ${stats.processedTickets}`);
  logger.info(`Skipped (existing duplicate ref): ${stats.skippedExistingReference}`);
  logger.info(`Skipped (empty title/description): ${stats.skippedEmpty}`);
  logger.info(`Skipped (short text): ${stats.skippedShortText}`);
  logger.info(`Skipped (no candidates): ${stats.skippedNoCandidates}`);
  logger.info(`Skipped (low relevance): ${stats.skippedLowRelevance}`);
  logger.info(`LLM calls: ${stats.llmCalls}`);
  logger.info(`Duplicates found: ${stats.duplicatesFound}`);
  logger.info(`References created: ${stats.referencesCreated}`);
  logger.info(`Due dates updated: ${stats.dueDatesUpdated}`);
  logger.info(`Failed tickets: ${stats.failedTickets}`);
  logger.info(`Duration: ${durationSeconds.toFixed(2)} seconds`);
};

export class TicketDuplicateBackfillController {
  public static async triggerBackfill(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as { user?: { email?: string } }).user;
      const config = TicketDuplicateBackfillController.parseConfig(
        req.body as BackfillConfigInput
      );
      logger.info(
        `Ticket duplicate backfill triggered by user: ${user?.email ?? 'unknown'}`
      );

      const response: ApiResponse = {
        success: true,
        data: {
          message: 'Ticket duplicate backfill started in background',
          config,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(202).json(response);

      // Fire and forget - do not await.
      TicketDuplicateBackfillController.backfillTicketDuplicates(config).catch((error) => {
        logger.error('Ticket duplicate backfill failed', error);
      });
    } catch (error) {
      logger.error('Ticket duplicate backfill trigger failed', error);

      const response: ApiResponse = {
        success: false,
        error: 'Failed to trigger ticket duplicate backfill',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };

      res.status(500).json(response);
    }
  }

  private static async backfillTicketDuplicates(config: BackfillConfig): Promise<void> {
    const stats: BackfillStats = {
      totalTickets: 0,
      processedTickets: 0,
      skippedExistingReference: 0,
      skippedEmpty: 0,
      skippedShortText: 0,
      skippedNoCandidates: 0,
      skippedLowRelevance: 0,
      llmCalls: 0,
      duplicatesFound: 0,
      referencesCreated: 0,
      dueDatesUpdated: 0,
      failedTickets: 0,
      startTime: new Date(),
    };

    const {
      batchSize,
      candidateLimit,
      minRelevance,
      minTextLength,
      sleepMs,
      maxTickets,
      dryRun,
      projectId,
    } = config;

    const whereClause = projectId ? { projectId } : {};

    try {
      stats.totalTickets = await prisma.ticket.count({ where: whereClause });
      logger.info(`Starting ticket duplicate backfill. Total tickets: ${stats.totalTickets}`);
      if (projectId) {
        logger.info(`Scoped to projectId=${projectId}`);
      }
      logger.info(
        `Settings: BATCH_SIZE=${batchSize}, CANDIDATE_LIMIT=${candidateLimit}, MIN_RELEVANCE=${minRelevance}, MIN_TEXT_LENGTH=${minTextLength}, DRY_RUN=${dryRun}, SLEEP_MS=${sleepMs}, MAX_TICKETS=${maxTickets}`,
      );

      const analysisCache = new Map<string, TicketDuplicateCheckAnalysis>();

      let lastId: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const tickets = await prisma.ticket.findMany({
          where: whereClause,
          orderBy: { id: 'asc' },
          take: batchSize,
          ...(lastId
            ? {
                cursor: { id: lastId },
                skip: 1,
              }
            : {}),
          select: {
            id: true,
            title: true,
            description: true,
            projectId: true,
            createdBy: true,
          },
        });

        if (tickets.length === 0) {
          hasMore = false;
          break;
        }

        lastId = tickets[tickets.length - 1]?.id;

        const batchTicketIds = tickets.map(ticket => ticket.id);
        const existingReferences = await prisma.ticketReferenceMapping.findMany({
          where: {
            sourceTicketId: { in: batchTicketIds },
            relationType: {
              in: [
                TicketReferenceRelation.DUPLICATE_POSSIBLE,
                TicketReferenceRelation.DUPLICATE_CONFIRMED,
              ],
            },
          },
          select: { sourceTicketId: true },
        });
        const ticketsWithDuplicates = new Set(
          existingReferences.map(reference => reference.sourceTicketId),
        );

        for (const ticket of tickets) {
          stats.processedTickets += 1;

          if (maxTickets > 0 && stats.processedTickets > maxTickets) {
            logger.info(`Reached MAX_TICKETS=${maxTickets}, stopping.`);
            stats.processedTickets -= 1;
            break;
          }

          if (ticketsWithDuplicates.has(ticket.id)) {
            stats.skippedExistingReference += 1;
            continue;
          }

          const title = ticket.title?.trim() ?? '';
          const description = ticket.description?.trim() ?? '';

          if (!title && !description) {
            stats.skippedEmpty += 1;
            continue;
          }

          const normalizedText = normalizeText(`${title} ${description}`);
          if (normalizedText.length < minTextLength) {
            stats.skippedShortText += 1;
            continue;
          }

          try {
            const candidates = await getDuplicateCandidates({
              ticketId: ticket.id,
              title,
              description,
              projectId: ticket.projectId,
              userId: ticket.createdBy,
              limit: candidateLimit,
            });

            if (candidates.length === 0) {
              stats.skippedNoCandidates += 1;
              continue;
            }

            const maxScore = candidates.reduce(
              (acc, candidate) => Math.max(acc, candidate.relevanceScore ?? 0),
              0,
            );
            if (maxScore < minRelevance) {
              stats.skippedLowRelevance += 1;
              continue;
            }

            const candidateKey = `${ticket.projectId}::${normalizedText}::${candidates
              .map(candidate => candidate.id)
              .join(',')}`;

            const cachedAnalysis = analysisCache.get(candidateKey);
            const analysis =
              cachedAnalysis ??
              (await ticketDuplicateService.analyzeDuplicate(
                { title, description },
                candidates,
                { userId: ticket.createdBy, projectId: ticket.projectId },
              ));

            if (!cachedAnalysis) {
              stats.llmCalls += 1;
              analysisCache.set(candidateKey, analysis);
            }

            if (!analysis.isDuplicate || !analysis.duplicateTicketId) {
              continue;
            }

            const duplicateCandidate = candidates.find(
              candidate => candidate.id === analysis.duplicateTicketId,
            );
            if (!duplicateCandidate) {
              continue;
            }

            stats.duplicatesFound += 1;
            if (!dryRun) {
              try {
                await prisma.ticket.update({
                  where: { id: ticket.id },
                  data: { eta: DUPLICATE_DUE_DATE },
                });
                stats.dueDatesUpdated += 1;
              } catch (error) {
                logger.error(`Failed to update due date for ticket ${ticket.id}:`, error);
              }

              const result = await prisma.ticketReferenceMapping.createMany({
                data: [
                  {
                    sourceTicketId: ticket.id,
                    targetTicketId: duplicateCandidate.id,
                    relationType: TicketReferenceRelation.DUPLICATE_POSSIBLE,
                    createdBy: ticket.createdBy,
                  },
                ],
                skipDuplicates: true,
              });
              stats.referencesCreated += result.count;
            }
          } catch (error) {
            stats.failedTickets += 1;
            logger.error(`Failed to process ticket ${ticket.id}:`, error);
          }

          if (sleepMs > 0) {
            await sleep(sleepMs);
          }
        }

        logger.info(
          `Processed ${stats.processedTickets}/${stats.totalTickets} tickets (LLM calls: ${stats.llmCalls}, duplicates: ${stats.duplicatesFound})`,
        );

        if (maxTickets > 0 && stats.processedTickets >= maxTickets) {
          break;
        }
      }
    } catch (error) {
      logger.error('Fatal error during duplicate backfill:', error);
      throw error;
    } finally {
      stats.endTime = new Date();
      logFinalStats(stats);
    }
  }

  private static parseConfig(input: BackfillConfigInput = {}): BackfillConfig {
    const normalizeNumber = (value: number | undefined, fallback: number): number => {
      if (value === undefined || value === null) {
        return fallback;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    return {
      batchSize: normalizeNumber(input.batchSize, 50),
      candidateLimit: normalizeNumber(input.candidateLimit, 10),
      minRelevance: normalizeNumber(input.minRelevance, 0.2),
      minTextLength: normalizeNumber(input.minTextLength, 20),
      sleepMs: normalizeNumber(input.sleepMs, 0),
      maxTickets: normalizeNumber(input.maxTickets, 0),
      dryRun: Boolean(input.dryRun),
      projectId: input.projectId?.trim() || null,
    };
  }
}
