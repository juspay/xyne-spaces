/**
 * Controller for AI-powered features
 */

import type { Request, Response } from 'express';
import { generateTitle } from '../services/agents/title-generator.js';
import type {
  TitleGeneratorInput,
  TitleGeneratorContext,
} from '../services/agents/title-generator.js';
import { rewriteEmailText } from '../agents/email-quick-rewrite/index.js';
import type {
  EmailQuickRewriteInput,
  EmailQuickRewriteContext,
} from '../agents/email-quick-rewrite/index.js';
import { generateCanvasTitle } from '../services/agents/canvas-title-generator.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

const MAX_CANVAS_TITLE_INPUT_LENGTH = 6_000;

/**
 * Generate a title from a description
 */
export async function generateTitleFromDescription(req: Request, res: Response): Promise<void> {
  try {
    const { description, maxLength } = req.body;
    const userId = req.user?.id;

    if (!description || typeof description !== 'string') {
      res.status(400).json({
        error: 'Description is required and must be a string',
      });
      return;
    }

    if (description.trim().length < 5) {
      res.status(400).json({
        error: 'Description must be at least 5 characters',
      });
      return;
    }

    const input: TitleGeneratorInput = {
      description: description.trim(),
      maxLength: maxLength || 100,
    };

    const context: TitleGeneratorContext = {
      userId,
    };

    const result = await generateTitle(input, context);

    res.json({
      title: result.title,
      ticketType: result.ticketType,
    });
  } catch (_) {
    res.status(500).json({
      error: 'Failed to generate title',
      message: 'An unexpected error occurred. Please try again later.',
    });
  }
}

export async function generateTitleFromCanvasContent(req: Request, res: Response): Promise<void> {
  try {
    const { content, maxLength } = req.body;

    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'Canvas content is required and must be a string' });
      return;
    }

    const normalizedContent = content
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (normalizedContent.length < 20) {
      res.status(400).json({ error: 'Canvas content must be at least 20 characters' });
      return;
    }

    const requestedMaxLength =
      typeof maxLength === 'number' && Number.isFinite(maxLength) ? Math.floor(maxLength) : 100;
    const boundedMaxLength = Math.min(Math.max(requestedMaxLength, 10), 100);
    const boundedContent = normalizedContent.slice(0, MAX_CANVAS_TITLE_INPUT_LENGTH);
    const context = { userId: req.user?.id };

    let title: string;
    try {
      const result = await generateCanvasTitle(
        { content: boundedContent, maxLength: boundedMaxLength },
        context
      );
      title = result.title;
    } catch (canvasGeneratorError) {
      logger.warn('[CanvasTitleGenerator] Canvas prompt failed; trying title generator fallback', {
        error:
          canvasGeneratorError instanceof Error
            ? canvasGeneratorError.message
            : String(canvasGeneratorError),
      });
      const fallback = await generateTitle(
        { description: boundedContent, maxLength: boundedMaxLength },
        context
      );
      title = fallback.title;
    }

    res.json({ title });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[CanvasTitleGenerator] Failed to generate canvas title', {
      error: errorMessage,
    });
    res.status(500).json({
      error: 'Failed to generate canvas title',
      message:
        config.env === 'development'
          ? errorMessage
          : 'An unexpected error occurred. Please try again later.',
    });
  }
}

/**
 * Rewrite email text based on the provided query/prompt
 */
export async function rewriteEmail(req: Request, res: Response): Promise<void> {
  try {
    const { query } = req.body;
    const userId = req.user?.id;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        error: 'query is required and must be a string',
      });
      return;
    }

    if (query.trim().length === 0) {
      res.status(400).json({
        error: 'query cannot be empty',
      });
      return;
    }

    const input: EmailQuickRewriteInput = {
      query: query.trim(),
    };

    const context: EmailQuickRewriteContext = {
      userId,
    };

    const result = await rewriteEmailText(input, context);

    res.json({
      rewrittenText: result.rewrittenText,
    });
  } catch (_) {
    res.status(500).json({
      error: 'Failed to rewrite email',
      message: 'An unexpected error occurred. Please try again later.',
    });
  }
}
