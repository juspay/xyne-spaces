/**
 * Hook for generating titles from descriptions using AI
 */

import { useState, useCallback, useRef } from 'react';
import { generateTitle } from '../services/titleGeneratorService';

export interface UseTitleGeneratorOptions {
  maxLength?: number;
  onError?: (error: Error) => void;
}

export interface UseTitleGeneratorReturn {
  title: string;
  isGenerating: boolean;
  error: Error | null;
  generateFromDescription: (description: string) => Promise<void>;
  cancelGeneration: () => void;
  reset: () => void;
}

/**
 * Hook to generate a title from a description
 */
export function useTitleGenerator(options: UseTitleGeneratorOptions = {}): UseTitleGeneratorReturn {
  const { maxLength = 100, onError } = options;

  const [title, setTitle] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // AbortController to cancel ongoing requests
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  }, []);

  const generateFromDescription = useCallback(
    async (description: string) => {
      if (!description || description.trim().length < 5) {
        const err = new Error('Description must be at least 5 characters');
        setError(err);
        onError?.(err);
        return;
      }

      // Cancel any ongoing generation
      cancelGeneration();

      // Create new AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsGenerating(true);
      setError(null);

      try {
        const generatedTitle = await generateTitle(
          {
            description: description.trim(),
            maxLength,
          },
          abortController.signal,
        );

        // Only set title if request wasn't aborted
        if (!abortController.signal.aborted) {
          setTitle(generatedTitle);
        }
      } catch (err) {
        // Don't show error if request was aborted
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        const error = err instanceof Error ? err : new Error('Failed to generate title');
        setError(error);
        onError?.(error);
      } finally {
        if (!abortController.signal.aborted) {
          setIsGenerating(false);
        }
        abortControllerRef.current = null;
      }
    },
    [maxLength, onError, cancelGeneration],
  );

  const reset = useCallback(() => {
    cancelGeneration();
    setTitle('');
    setError(null);
    setIsGenerating(false);
  }, [cancelGeneration]);

  return {
    title,
    isGenerating,
    error,
    generateFromDescription,
    cancelGeneration,
    reset,
  };
}
