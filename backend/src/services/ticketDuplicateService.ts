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
}

export const ticketDuplicateService = new TicketDuplicateService();
