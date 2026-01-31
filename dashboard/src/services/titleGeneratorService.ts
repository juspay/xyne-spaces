/**
 * Title Generator Service
 * Provides methods to generate titles from descriptions using AI
 */

import { apiInstance } from './clients/apiClient';

export interface TitleGeneratorInput {
  description: string;
  maxLength?: number;
}

export interface TitleGeneratorResponse {
  title: string;
}

/**
 * Generate a title from a description
 */
export async function generateTitle(
  input: TitleGeneratorInput,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const response = await apiInstance.post<TitleGeneratorResponse>(
      '/ai/generate-title',
      {
        description: input.description,
        maxLength: input.maxLength || 100,
      },
      signal ? { signal } : undefined,
    );

    return response.data.title;
  } catch (error) {
    console.error('Failed to generate title:', error);
    throw error;
  }
}
