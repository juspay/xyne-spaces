import { useCallback, useEffect, useRef, useState } from 'react';

import {
  summarizeEmailThread,
  type EmailThreadSummaryResult,
} from '../services/summarize-email-thread';

export type EmailSummaryState = 'idle' | 'loading' | 'done' | 'error';

export type UseEmailThreadSummaryReturn = {
  isOpen: boolean;
  state: EmailSummaryState;
  summary: string;
  keypoints: string[];
  errorMessage: string;
  canSummarize: boolean;
  openSummary: () => void;
  closeSummary: () => void;
  setOpen: (open: boolean) => void;
  regenerate: () => void;
};

type UseEmailThreadSummaryArgs = {
  conversationId: string | null | undefined;
  emailCount: number;
};

/**
 * Gmail-style AI summary state for a desk email thread.
 * Gates on emails existing (dashboard parity) — empty bodies are still allowed.
 */
export function useEmailThreadSummary({
  conversationId,
  emailCount,
}: UseEmailThreadSummaryArgs): UseEmailThreadSummaryReturn {
  const canSummarize = Boolean(conversationId) && emailCount > 0;

  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<EmailSummaryState>('idle');
  const [summary, setSummary] = useState('');
  const [keypoints, setKeypoints] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  const requestVersionRef = useRef(0);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const reset = useCallback(() => {
    requestVersionRef.current += 1;
    setState('idle');
    setSummary('');
    setKeypoints([]);
    setErrorMessage('');
    setIsOpen(false);
  }, []);

  // Reset when the thread identity or email count changes (dashboard parity).
  useEffect(() => {
    reset();
  }, [conversationId, emailCount, reset]);

  const fetchSummary = useCallback(async (regenerate = false) => {
    const id = conversationIdRef.current;
    if (!id) return;

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    setState('loading');
    setSummary('');
    setKeypoints([]);
    setErrorMessage('');

    try {
      const result: EmailThreadSummaryResult = await summarizeEmailThread(id, { regenerate });
      if (requestVersionRef.current !== requestVersion) return;
      setSummary(result.summary);
      setKeypoints(result.keypoints);
      setState('done');
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) return;
      const message =
        error instanceof Error ? error.message : 'Failed to generate summary. Please try again.';
      setErrorMessage(message);
      setState('error');
    }
  }, []);

  const openSummary = useCallback(() => {
    if (!canSummarize) return;

    setIsOpen(true);

    if (state === 'idle' || state === 'error') {
      void fetchSummary(false);
      return;
    }

    // Already done — reopen cached summary without refetching.
    // Loading: sheet opens over the in-flight request.
  }, [canSummarize, fetchSummary, state]);

  const closeSummary = useCallback(() => {
    setIsOpen(false);
  }, []);

  const setOpen = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  const regenerate = useCallback(() => {
    if (!canSummarize) return;
    setIsOpen(true);
    void fetchSummary(true);
  }, [canSummarize, fetchSummary]);

  return {
    isOpen,
    state,
    summary,
    keypoints,
    errorMessage,
    canSummarize,
    openSummary,
    closeSummary,
    setOpen,
    regenerate,
  };
}
