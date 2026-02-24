import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  checkTicketDuplicates,
  type TicketDuplicateCheckResponse,
} from '../services/ticketDuplicateService';
import { useDebouncedValue } from './useDebouncedValue';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

export interface UseDuplicateTicketCheckOptions {
  title: string;
  description: string;
  projectId: string;
  boardId?: string;
  isOpen: boolean;
  debounceMs?: number;
  minTitleLength?: number;
  minDescriptionLength?: number;
}

interface UseDuplicateTicketCheckResult {
  duplicateCheck: TicketDuplicateCheckResponse | null;
  candidateLinks: Map<string, string>;
  duplicateCheckError: string | null;
  isCheckingDuplicate: boolean;
  isDuplicateReasonExpanded: boolean;
  setIsDuplicateReasonExpanded: Dispatch<SetStateAction<boolean>>;
  triggerDuplicateCheck: () => void;
  resetDuplicateState: () => void;
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

export const useDuplicateTicketCheck = (
  options: UseDuplicateTicketCheckOptions,
): UseDuplicateTicketCheckResult => {
  const {
    title,
    description,
    projectId,
    boardId,
    isOpen,
    debounceMs = 2000,
    minTitleLength = 3,
    minDescriptionLength = 5,
  } = options;

  const [duplicateCheck, setDuplicateCheck] = useState<TicketDuplicateCheckResponse | null>(null);
  const [duplicateCheckError, setDuplicateCheckError] = useState<string | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [isDuplicateReasonExpanded, setIsDuplicateReasonExpanded] = useState(false);

  // Request lifecycle + caches
  const requestSeqRef = useRef(0);
  const cacheRef = useRef(new Map<string, TicketDuplicateCheckResponse>());
  const inFlightKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // UX / control-flow helpers
  const suppressNextDebouncedKeyRef = useRef<string | null>(null);
  const wasValidRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);

  const normalizedInput: NormalizedInput = useMemo(() => {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const isValid =
      Boolean(projectId) &&
      trimmedTitle.length >= minTitleLength &&
      trimmedDescription.length >= minDescriptionLength;

    return {
      trimmedTitle,
      trimmedDescription,
      isValid,
      cacheKey: isValid ? buildCacheKey(projectId, trimmedTitle, trimmedDescription) : '',
    };
  }, [title, description, projectId, minTitleLength, minDescriptionLength]);

  const debouncedInput = useDebouncedValue(normalizedInput, debounceMs);

  const abortInFlight = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightKeyRef.current = null;
  }, []);

  const invalidateCurrentRequest = useCallback(() => {
    // One place to invalidate “whatever is currently running”
    requestSeqRef.current += 1;
    abortInFlight();
  }, [abortInFlight]);

  const clearUiState = useCallback(() => {
    setDuplicateCheck(null);
    setDuplicateCheckError(null);
    setIsCheckingDuplicate(false);
    setIsDuplicateReasonExpanded(false);
  }, []);

  const resetDuplicateState = useCallback(() => {
    invalidateCurrentRequest();
    cacheRef.current.clear();
    suppressNextDebouncedKeyRef.current = null;
    clearUiState();
  }, [clearUiState, invalidateCurrentRequest]);

  const runDuplicateCheck = useCallback(
    async (input: NormalizedInput): Promise<void> => {
      if (!isOpen || !input.isValid) {
        resetDuplicateState();
        return;
      }

      // Same request already in flight for same key then dont do anything
      if (inFlightKeyRef.current === input.cacheKey) return;

      // Serve from cache
      const cached = cacheRef.current.get(input.cacheKey);
      if (cached) {
        setIsCheckingDuplicate(false);
        setDuplicateCheckError(null);
        setDuplicateCheck(cached);
        setIsDuplicateReasonExpanded(false);
        return;
      }

      // Start a fresh request: abort previous, then bump seq once for this request
      abortInFlight();
      const requestSeq = ++requestSeqRef.current;

      // UX: clear old result while loading (your existing behavior)
      setIsCheckingDuplicate(true);
      setDuplicateCheckError(null);
      setDuplicateCheck(null);
      setIsDuplicateReasonExpanded(false);

      inFlightKeyRef.current = input.cacheKey;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await checkTicketDuplicates(
          {
            title: input.trimmedTitle,
            description: input.trimmedDescription,
            projectId,
            limit: 10,
          },
          { signal: controller.signal },
        );

        if (requestSeq === requestSeqRef.current) {
          cacheRef.current.set(input.cacheKey, result);
          setDuplicateCheck(result);
        }
      } catch (err) {
        if (requestSeq === requestSeqRef.current && !isAbortError(err)) {
          setDuplicateCheck(null);
          setDuplicateCheckError(err instanceof Error ? err.message : 'Duplicate check failed');
        }
      } finally {
        if (requestSeq === requestSeqRef.current) {
          setIsCheckingDuplicate(false);
        }
        if (inFlightKeyRef.current === input.cacheKey) inFlightKeyRef.current = null;
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [abortInFlight, isOpen, projectId, resetDuplicateState],
  );

  const triggerDuplicateCheck = useCallback(() => {
    if (normalizedInput.isValid) {
      suppressNextDebouncedKeyRef.current = normalizedInput.cacheKey;
    }
    void runDuplicateCheck(normalizedInput);
  }, [normalizedInput, runDuplicateCheck]);

  // 1) Close / validity transitions
  useEffect(() => {
    if (!isOpen) {
      resetDuplicateState();
      wasValidRef.current = false;
      lastKeyRef.current = null;
      return;
    }

    if (wasValidRef.current && !normalizedInput.isValid) {
      resetDuplicateState();
    }

    wasValidRef.current = normalizedInput.isValid;
  }, [isOpen, normalizedInput.isValid, resetDuplicateState]);

  // 2) If user changes input while a request is in flight, cancel immediately (don’t keep spinner on)
  useEffect(() => {
    if (!isOpen) return;

    const keyChanged = lastKeyRef.current && lastKeyRef.current !== normalizedInput.cacheKey;
    const hasInFlight = Boolean(inFlightKeyRef.current);

    if (keyChanged && hasInFlight) {
      invalidateCurrentRequest();
      suppressNextDebouncedKeyRef.current = null;
      setIsCheckingDuplicate(false);
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

    void runDuplicateCheck(debouncedInput);
  }, [debouncedInput, isOpen, normalizedInput.isValid, runDuplicateCheck]);

  // 4) Collapse “reason” section when result changes
  useEffect(() => {
    setIsDuplicateReasonExpanded(false);
  }, [duplicateCheck?.analysis.duplicateTicketId, duplicateCheck?.analysis.reason]);

  // Query for ticket data for all candidates to get authoritative projectId/boardId
  const candidateIds = duplicateCheck?.candidates?.map(c => c.id) || [];
  const [ticketsData] = useCachedQuery(queries.ticketsByIds({ ticketIds: candidateIds }), {
    enabled: candidateIds.length > 0,
  });

  // Generate links for all candidates
  const candidateLinks = useMemo(() => {
    const links = new Map<string, string>();

    for (const candidate of duplicateCheck?.candidates || []) {
      let link: string | undefined;

      // Priority: authoritative ticket data > candidate boardId > context boardId > channelId
      const ticketData = ticketsData?.find(t => t.id === candidate.id);

      if (ticketData?.projectId && ticketData?.boardId) {
        link = `/projects/${ticketData.projectId}/${ticketData.boardId}/${candidate.id}`;
      } else if (candidate.boardId && projectId) {
        // Use candidate boardId from API response
        link = `/projects/${projectId}/${candidate.boardId}/${candidate.id}`;
      } else if (boardId && projectId) {
        // Use context boardId as fallback
        link = `/projects/${projectId}/${boardId}/${candidate.id}`;
      } else if (candidate.channelId) {
        // Last resort: use chat link if no board info available
        link = `/chat/dir/${candidate.channelId}/tickets/${candidate.id}`;
      }

      if (link && candidate.id) {
        links.set(candidate.id, link);
      }
    }

    return links;
  }, [duplicateCheck, projectId, boardId, ticketsData]);

  return {
    duplicateCheck,
    candidateLinks,
    duplicateCheckError,
    isCheckingDuplicate,
    isDuplicateReasonExpanded,
    setIsDuplicateReasonExpanded,
    triggerDuplicateCheck,
    resetDuplicateState,
  };
};
