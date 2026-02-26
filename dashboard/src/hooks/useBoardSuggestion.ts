import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  checkBoardSuggestion,
  type TicketBoardSuggestionResponse,
} from '../services/ticketBoardService';
import { useDebouncedValue } from './useDebouncedValue';

export interface UseBoardSuggestionOptions {
  title: string;
  description: string;
  projectId: string;
  currentBoardId: string;
  isOpen: boolean;
  debounceMs?: number;
  minTitleLength?: number;
  minDescriptionLength?: number;
}

interface UseBoardSuggestionResult {
  boardSuggestion: TicketBoardSuggestionResponse | null;
  isCheckingBoard: boolean;
  resetBoardSuggestionState: () => void;
}

type NormalizedInput = {
  trimmedTitle: string;
  trimmedDescription: string;
  isValid: boolean;
  cacheKey: string;
};

const buildCacheKey = (projectId: string, title: string, description: string): string =>
  JSON.stringify([projectId, title, description]);

const isAbortError = (error: unknown): boolean => {
  const name = error instanceof Error ? error.name : undefined;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: string }).code
      : undefined;

  return name === 'AbortError' || name === 'CanceledError' || code === 'ERR_CANCELED';
};

export const useBoardSuggestion = (
  options: UseBoardSuggestionOptions,
): UseBoardSuggestionResult => {
  const {
    title,
    description,
    projectId,
    currentBoardId: _currentBoardId,
    isOpen,
    debounceMs = 2000,
    minTitleLength = 3,
  } = options;

  const [boardSuggestion, setBoardSuggestion] = useState<TicketBoardSuggestionResponse | null>(
    null,
  );
  const [isCheckingBoard, setIsCheckingBoard] = useState(false);

  // Request lifecycle + caches
  const requestSeqRef = useRef(0);
  const cacheRef = useRef(new Map<string, TicketBoardSuggestionResponse>());
  const inFlightKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // UX / control-flow helpers
  const suppressNextDebouncedKeyRef = useRef<string | null>(null);
  const wasValidRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);

  const normalizedInput: NormalizedInput = useMemo(() => {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const isValid = Boolean(projectId) && trimmedTitle.length >= minTitleLength;

    return {
      trimmedTitle,
      trimmedDescription,
      isValid,
      cacheKey: isValid ? buildCacheKey(projectId, trimmedTitle, trimmedDescription) : '',
    };
  }, [title, description, projectId, minTitleLength]);

  const debouncedInput = useDebouncedValue(normalizedInput, debounceMs);

  const abortInFlight = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightKeyRef.current = null;
  }, []);

  const invalidateCurrentRequest = useCallback(() => {
    requestSeqRef.current += 1;
    abortInFlight();
  }, [abortInFlight]);

  const clearUiState = useCallback(() => {
    setBoardSuggestion(null);
    setIsCheckingBoard(false);
  }, []);

  const resetBoardSuggestionState = useCallback(() => {
    invalidateCurrentRequest();
    cacheRef.current.clear();
    suppressNextDebouncedKeyRef.current = null;
    clearUiState();
  }, [clearUiState, invalidateCurrentRequest]);

  const runBoardSuggestion = useCallback(
    async (input: NormalizedInput): Promise<void> => {
      if (!isOpen || !input.isValid) {
        resetBoardSuggestionState();
        return;
      }

      // Same request already in flight for same key then don't do anything
      if (inFlightKeyRef.current === input.cacheKey) return;

      // Serve from cache
      const cached = cacheRef.current.get(input.cacheKey);
      if (cached) {
        setIsCheckingBoard(false);
        setBoardSuggestion(cached);
        return;
      }

      // Start a fresh request: abort previous, then bump seq once for this request
      abortInFlight();
      const requestSeq = ++requestSeqRef.current;

      // UX: clear old result while loading
      setIsCheckingBoard(true);
      setBoardSuggestion(null);

      inFlightKeyRef.current = input.cacheKey;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await checkBoardSuggestion(
          {
            title: input.trimmedTitle,
            description: input.trimmedDescription,
            projectId,
          },
          { signal: controller.signal },
        );

        if (requestSeq === requestSeqRef.current) {
          cacheRef.current.set(input.cacheKey, result);
          setBoardSuggestion(result);
        }
      } catch (err) {
        if (requestSeq === requestSeqRef.current && !isAbortError(err)) {
          setBoardSuggestion(null);
        }
      } finally {
        if (requestSeq === requestSeqRef.current) {
          setIsCheckingBoard(false);
        }
        if (inFlightKeyRef.current === input.cacheKey) inFlightKeyRef.current = null;
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [abortInFlight, isOpen, projectId, resetBoardSuggestionState],
  );

  // 1) Close / validity transitions
  useEffect(() => {
    if (!isOpen) {
      resetBoardSuggestionState();
      wasValidRef.current = false;
      lastKeyRef.current = null;
      return;
    }

    if (wasValidRef.current && !normalizedInput.isValid) {
      resetBoardSuggestionState();
    }

    wasValidRef.current = normalizedInput.isValid;
  }, [isOpen, normalizedInput.isValid, resetBoardSuggestionState]);

  // 2) If user changes input while a request is in flight, cancel immediately
  useEffect(() => {
    if (!isOpen) return;

    const keyChanged = lastKeyRef.current && lastKeyRef.current !== normalizedInput.cacheKey;
    const hasInFlight = Boolean(inFlightKeyRef.current);

    if (keyChanged && hasInFlight) {
      invalidateCurrentRequest();
      suppressNextDebouncedKeyRef.current = null;
      setIsCheckingBoard(false);
    }

    lastKeyRef.current = normalizedInput.cacheKey;
  }, [invalidateCurrentRequest, isOpen, normalizedInput.cacheKey]);

  // 3) Debounced auto-check
  useEffect(() => {
    if (!isOpen || !normalizedInput.isValid || !debouncedInput.isValid) return;

    if (suppressNextDebouncedKeyRef.current === debouncedInput.cacheKey) {
      suppressNextDebouncedKeyRef.current = null;
      return;
    }

    void runBoardSuggestion(debouncedInput);
  }, [debouncedInput, isOpen, normalizedInput.isValid, runBoardSuggestion]);

  return {
    boardSuggestion,
    isCheckingBoard,
    resetBoardSuggestionState,
  };
};
