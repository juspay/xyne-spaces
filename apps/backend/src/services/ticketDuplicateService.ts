import { logger } from '@/utils/logger';
import { TicketReferenceRelation } from '@xyne/shared';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { transformVespaResults } from '@/services/vespaSearch/resultTransform';
import { vespaService } from '@/services/vespaSearch';
import { RankProfile } from '@/vespa/src/types';
import type {
  TicketDuplicateCandidate,
  TicketDuplicateCheckAnalysis,
} from '@/types/ticket';
import {
  analyzeTicketDuplicates,
  type TicketDuplicateCandidateInput,
  type TicketDuplicateContext,
} from '@/agents/ticket-duplicate';

const prisma = DatabaseClient.getInstance();
const DUPLICATE_REFERENCE_LIMIT = 10;

// Cap on the text handed to Vespa, mirroring the agent's MAX_DESCRIPTION_LENGTH.
const VESPA_QUERY_MAX_LENGTH = 4000;

// Desk tickets carry raw HTML email bodies, so strip markup before it reaches the
// lexical term and the embedding. Mirrors normalizePromptText in agents/ticket-duplicate.
const buildDuplicateSearchQuery = (title: string, description: string): string => {
  const plainTitle = extractPlainTextFromHtml(title).trim() || title.trim();
  const plainDescription = extractPlainTextFromHtml(description).trim();
  return `${plainTitle}\n\n${plainDescription}`.trim().slice(0, VESPA_QUERY_MAX_LENGTH);
};

class TicketDuplicateService {
  async checkDuplicates(params: {
    title: string;
    description: string;
    projectId: string;
    userId: string;
    limit: number;
    excludeTicketId?: string;
    parentTicketId?: string;
  }): Promise<{ candidates: TicketDuplicateCandidate[]; analysis: TicketDuplicateCheckAnalysis }> {
    const { title, description, projectId, userId, limit, excludeTicketId, parentTicketId } = params;

    const candidates = await this.getDuplicateCandidates({
      title,
      description,
      projectId,
      userId,
      limit,
      excludeTicketId,
      parentTicketId,
    });

    if (candidates.length === 0) {
      return {
        candidates,
        analysis: {
          isDuplicate: false,
          duplicateTicketId: null,
          confidence: 0,
          reason: 'No similar tickets found.',
        },
      };
    }

    const analysis = await this.analyzeDuplicate(
      { title, description },
      candidates,
      { userId, projectId },
    );


    const reorderedCandidates = this.reorderCandidatesWithDuplicateFirst(
      candidates,
      analysis.duplicateTicketId,
    );

    return { candidates: reorderedCandidates, analysis };
  }

  private reorderCandidatesWithDuplicateFirst(
    candidates: TicketDuplicateCandidate[],
    duplicateTicketId: string | null | undefined,
  ): TicketDuplicateCandidate[] {
    // If no duplicate identified, return original order
    if (!duplicateTicketId) {
      return candidates;
    }

    const duplicateIndex = candidates.findIndex(c => c.id === duplicateTicketId);

    // If duplicate not found or already at index 0, return original order
    if (duplicateIndex <= 0) {
      return candidates;
    }

    // Move the duplicate to index 0, keep rest in original order
    const duplicate = candidates[duplicateIndex];
    const reordered = [
      duplicate,
      ...candidates.slice(0, duplicateIndex),
      ...candidates.slice(duplicateIndex + 1),
    ];

    return reordered;
  }

  async analyzeDuplicate(
    ticket: { title: string; description: string },
    candidates: TicketDuplicateCandidate[],
    context: TicketDuplicateContext,
  ): Promise<TicketDuplicateCheckAnalysis> {
    if (candidates.length === 0) {
      return {
        isDuplicate: false,
        confidence: 0,
        reason: 'No similar tickets found in this project.',
      };
    }

    try {
      const agentCandidates: TicketDuplicateCandidateInput[] = candidates.map(candidate => ({
        id: candidate.id,
        title: candidate.title,
        description: candidate.description || '',
        status: candidate.status,
      }));

      const result = await analyzeTicketDuplicates(
        {
          title: ticket.title,
          description: ticket.description,
          candidates: agentCandidates,
        },
        context,
      );

      const candidateIds = new Set(candidates.map(candidate => candidate.id));
      const safeDuplicateTicketId =
        result.duplicateTicketId && candidateIds.has(result.duplicateTicketId)
          ? result.duplicateTicketId
          : null;

      return {
        isDuplicate: result.isDuplicate,
        duplicateTicketId: safeDuplicateTicketId,
        confidence: result.confidence,
        reason: result.reason,
      };
    } catch (error) {
      logger.error('Duplicate ticket analysis failed', error);
      return {
        isDuplicate: false,
        confidence: 0,
        reason: 'Duplicate analysis unavailable. Please review the similar tickets manually.',
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      };
    }
  }

  private async getDuplicateCandidates(params: {
    title: string;
    description: string;
    projectId: string;
    userId: string;
    limit: number;
    excludeTicketId?: string;
    parentTicketId?: string;
  }): Promise<TicketDuplicateCandidate[]> {
    const { title, description, projectId, userId, limit, excludeTicketId, parentTicketId } = params;
    const query = buildDuplicateSearchQuery(title, description);

    if (!query) {
      return [];
    }

    if (config.isTestEnv) {
      logger.debug('[TicketDuplicateService] Skipping Vespa in test environment');
      return [];
    }

    let vespaResults;
    try {
      vespaResults = await vespaService.searchService.searchVespa(
        query,
        userId,
        ['ticket'],
        {
          offset: 0,
          limit,
          rankProfile: RankProfile.duplicateDetection,
          ticket: {
            projectId: [projectId],
          },
        },
      );
    } catch (error) {
      logger.warn(
        '[TicketDuplicateService] Vespa search unavailable, skipping duplicate check',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return [];
    }

    const hits = vespaResults.root.children || [];
    const transformedResults = await transformVespaResults(hits, prisma);

    const candidates = transformedResults
      .filter(result => result.type === 'ticket')
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

    // Build set of IDs to exclude (self, parent)
    const excludeIds = new Set<string>();
    if (excludeTicketId) {
      excludeIds.add(excludeTicketId);
    }
    if (parentTicketId) {
      excludeIds.add(parentTicketId);
    }

    if (excludeIds.size === 0) {
      return candidates;
    }

    return candidates.filter(candidate => !excludeIds.has(candidate.id));
  }

  async persistDuplicateReferences(params: {
    ticketId: string;
    ticketCreatedBy: string;
    title: string;
    description: string;
    projectId: string;
    userId: string;
    parentTicketId?: string;
  }): Promise<void> {
    try {
      const { ticketId, ticketCreatedBy, title, description, projectId, userId, parentTicketId } = params;
      const { candidates, analysis } = await this.checkDuplicates({
        title,
        description,
        projectId,
        userId,
        limit: DUPLICATE_REFERENCE_LIMIT,
        excludeTicketId: ticketId,
        parentTicketId,
      });

      if (candidates.length === 0) {
        return;
      }

      if (!analysis.isDuplicate || !analysis.duplicateTicketId) {
        return;
      }

      const duplicateCandidate = candidates.find(
        candidate => candidate.id === analysis.duplicateTicketId,
      );

      if (!duplicateCandidate) {
        return;
      }

      const workspaceId = await resolveWorkspaceIdFromModel(prisma, 'project', { id: projectId });

      const referenceRows = [
        {
          sourceTicketId: ticketId,
          targetTicketId: duplicateCandidate.id,
          workspaceId,
          relationType: TicketReferenceRelation.DUPLICATE_POSSIBLE,
          createdBy: ticketCreatedBy,
        },
      ];

      await prisma.ticketReferenceMapping.createMany({
        data: referenceRows,
        skipDuplicates: true,
      });
    } catch (error) {
      logger.error('Failed to persist duplicate ticket references', error);
    }
  }
}

export const ticketDuplicateService = new TicketDuplicateService();
