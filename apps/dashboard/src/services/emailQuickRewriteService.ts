import { logger, Event as LogEvent } from '../utils/logger';
/**
 * Email Quick Rewrite Service
 * Provides methods to rewrite email text using AI
 */

import { apiInstance } from './clients/apiClient';

export interface EmailQuickRewriteInput {
  query: string;
}

export interface EmailQuickRewriteResponse {
  rewrittenText: string;
}

export interface EmailQuickRewriteResult {
  rewrittenText: string;
}

/**
 * Rewrite email text using the provided query/prompt
 */
export async function rewriteEmailText(
  input: EmailQuickRewriteInput,
  signal?: AbortSignal,
): Promise<EmailQuickRewriteResult> {
  try {
    const response = await apiInstance.post<EmailQuickRewriteResponse>(
      '/ai/rewrite-email',
      {
        query: input.query,
      },
      signal ? { signal } : undefined,
    );

    return {
      rewrittenText: response.data.rewrittenText,
    };
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to rewrite email:'),
      error: error,
    });
    throw error;
  }
}
