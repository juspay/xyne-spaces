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
    console.error('Failed to rewrite email:', error);
    throw error;
  }
}
