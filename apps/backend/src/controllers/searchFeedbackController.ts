import { Request, Response } from 'express';
import { WorkspaceRole } from '@xyne/shared';
import { logger } from '@/utils/logger';
import {
  SearchFeedbackUnavailableError,
  searchFeedbackService,
} from '@/services/searchFeedbackService';
import {
  SEARCH_FEEDBACK_SOURCES,
  type SearchFeedbackSource,
} from '@/services/searchFeedbackMessage';

/** Input size limits, so a huge paste can't produce an unreadable message. */
const MAX_FEEDBACK_LENGTH = 2000;
const MAX_QUERY_LENGTH = 500;
const MAX_FILTER_LABEL_LENGTH = 120;
const MAX_FILTERS = 25;
const MAX_SORT_LENGTH = 60;

export class SearchFeedbackController {
  /** GET /api/search-feedback/target — where this user's feedback will be posted. */
  async target(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user?.id || !user.workspaceId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const data = await searchFeedbackService.getTargetDisplay(user.workspaceId);
      res.json({ success: true, data });
    } catch (error) {
      // Display only. Return nulls so the form shows generic text instead of failing.
      logger.error('[SearchFeedback] Failed to resolve target for display:', error);
      res.json({ success: true, data: { channelName: null, groupHandle: null } });
    }
  }

  /**
   * Post search feedback into the feedback channel.
   * POST /api/search-feedback
   * Body: {
   *   query?: string, feedback?: string, source: 'cmdk' | 'search_results',
   *   filters?: string[], sort?: string
   * }
   */
  async submit(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user?.id || !user.workspaceId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      // Guests can't post: feedback goes to an internal channel and pings the whole group.
      if (user.role === WorkspaceRole.GUEST) {
        res.status(403).json({ success: false, error: 'Guests cannot post search feedback' });
        return;
      }

      const { query, feedback, source, filters, sort } = req.body ?? {};

      // Either a query or a comment is enough; reject only when both are empty.
      const safeQuery = typeof query === 'string' ? query.trim().slice(0, MAX_QUERY_LENGTH) : '';
      const safeFeedback =
        typeof feedback === 'string' ? feedback.trim().slice(0, MAX_FEEDBACK_LENGTH) : '';
      if (!safeQuery && !safeFeedback) {
        res.status(400).json({ success: false, error: 'A search query or feedback is required' });
        return;
      }

      if (!SEARCH_FEEDBACK_SOURCES.includes(source as SearchFeedbackSource)) {
        res.status(400).json({ success: false, error: 'Invalid feedback source' });
        return;
      }

      // Filters and sort are display-only, so bad values are dropped instead of failing the request.
      const safeFilters = Array.isArray(filters)
        ? filters
            .filter((f): f is string => typeof f === 'string' && f.trim() !== '')
            .slice(0, MAX_FILTERS)
            .map((f) => f.trim().slice(0, MAX_FILTER_LABEL_LENGTH))
        : [];

      const safeSort =
        typeof sort === 'string' && sort.trim() !== ''
          ? sort.trim().slice(0, MAX_SORT_LENGTH)
          : undefined;

      await searchFeedbackService.postFeedback({
        userId: user.id,
        workspaceId: user.workspaceId,
        query: safeQuery,
        feedback: safeFeedback,
        filters: safeFilters,
        ...(safeSort ? { sort: safeSort } : {}),
        source: source as SearchFeedbackSource,
      });

      res.json({ success: true });
    } catch (error) {
      if (error instanceof SearchFeedbackUnavailableError) {
        res.status(409).json({ success: false, error: error.message });
        return;
      }
      logger.error('[SearchFeedback] Failed to submit feedback:', error);
      res.status(500).json({ success: false, error: 'Failed to submit feedback' });
    }
  }
}

export const searchFeedbackController = new SearchFeedbackController();
