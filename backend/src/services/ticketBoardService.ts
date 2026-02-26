import { logger } from '@/utils/logger';
import type {
  TicketBoardCandidate,
  TicketBoardAnalysis,
} from '@/types/ticket';
import {
  analyzeTicketBoard,
  type TicketBoardCandidateInput,
  type TicketBoardContext,
} from '@/agents/ticket-board';

class TicketBoardService {
  async suggestBoard(
    ticket: { title: string; description: string },
    candidates: TicketBoardCandidate[],
    context: TicketBoardContext,
  ): Promise<TicketBoardAnalysis> {
    if (candidates.length === 0) {
      return {
        suggestedBoardId: null,
        suggestedBoardName: null,
      };
    }

    try {
      const agentCandidates: TicketBoardCandidateInput[] = candidates.map(candidate => ({
        id: candidate.id,
        name: candidate.name,
        description: candidate.description,
        boardType: candidate.boardType,
        stageCount: candidate.stageCount,
      }));

      const result = await analyzeTicketBoard(
        {
          title: ticket.title,
          description: ticket.description,
          candidates: agentCandidates,
        },
        context,
      );

      // Safety check: ensure suggested boardId is in the candidate list
      const candidateIds = new Set(candidates.map(candidate => candidate.id));
      const safeSuggestedBoardId =
        result.suggestedBoardId && candidateIds.has(result.suggestedBoardId)
          ? result.suggestedBoardId
          : null;

      const safeSuggestedBoardName =
        safeSuggestedBoardId && result.suggestedBoardName
          ? result.suggestedBoardName
          : null;

      return {
        suggestedBoardId: safeSuggestedBoardId,
        suggestedBoardName: safeSuggestedBoardName,
      };
    } catch (error) {
      logger.error('Board suggestion analysis failed', error);
      return {
        suggestedBoardId: null,
        suggestedBoardName: null,
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      };
    }
  }
}

export const ticketBoardService = new TicketBoardService();