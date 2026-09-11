import { logger, Event as LogEvent } from '../utils/logger';
/**
 * Title Generator Service
 * Provides methods to generate titles from descriptions using AI
 */

import { apiInstance } from './clients/apiClient';
import { type ClassifiableTicketType } from '@xyne/shared';

export interface TitleGeneratorInput {
  description: string;
  maxLength?: number;
}

export interface TitleGeneratorResponse {
  title: string;
  ticketType: ClassifiableTicketType;
}

export interface TitleGeneratorResult {
  title: string;
  ticketType: ClassifiableTicketType;
}

/**
 * Generate a title and ticket type from a description
 */
export async function generateTitle(
  input: TitleGeneratorInput,
  signal?: AbortSignal,
): Promise<TitleGeneratorResult> {
  try {
    const response = await apiInstance.post<TitleGeneratorResponse>(
      '/ai/generate-title',
      {
        description: input.description,
        maxLength: input.maxLength || 100,
      },
      signal ? { signal } : undefined,
    );

    return {
      title: response.data.title,
      ticketType: response.data.ticketType,
    };
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to generate title:'),
      error: error,
    });
    throw error;
  }
}
