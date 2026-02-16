import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';
import { transformVespaResults } from '@/services/vespaSearch/resultTransform';
import { vespaService } from '@/services/vespaSearch';
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

class TicketDuplicateService {
  async checkDuplicates(params: {
    title: string;
    description: string;
    projectId: string;
    userId: string;
    limit: number;
    excludeTicketId?: string;
  }): Promise<{ candidates: TicketDuplicateCandidate[]; analysis: TicketDuplicateCheckAnalysis }> {
    const { title, description, projectId, userId, limit, excludeTicketId } = params;

    const candidates = await this.getDuplicateCandidates({
      title,
      description,
      projectId,
      userId,
      limit,
      excludeTicketId,
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

    return { candidates, analysis };
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
  }): Promise<TicketDuplicateCandidate[]> {
    const { title, description, projectId, userId, limit, excludeTicketId } = params;
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

    if (!excludeTicketId) {
      return candidates;
    }

    return candidates.filter(candidate => candidate.id !== excludeTicketId);
  }
}

export const ticketDuplicateService = new TicketDuplicateService();
