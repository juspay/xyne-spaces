/**
 * Controller for AI-powered features
 */

import type { Request, Response } from 'express';
import { generateTitle } from '../services/agents/title-generator.js';
import type {
  TitleGeneratorInput,
  TitleGeneratorContext,
} from '../services/agents/title-generator.js';

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
    });
  } catch (_) {
    res.status(500).json({
      error: 'Failed to generate title',
      message: 'An unexpected error occurred. Please try again later.',
    });
  }
}
