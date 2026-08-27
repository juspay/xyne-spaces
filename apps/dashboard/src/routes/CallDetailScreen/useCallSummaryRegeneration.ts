import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { callService } from '../../services/Call/callService';

export interface CallSummaryRegeneration {
  /** Template the pill names — the pending one while a rewrite runs, else the applied one. */
  appliedTemplateId: string | null;
  isRegenerating: boolean;
  hasFailed: boolean;
  /** Bumped per run so SummaryGenerationPanel restarts its progress animation. */
  runNonce: number;
  /** Bumped on success so the canvas remounts against the rewritten document. */
  canvasNonce: number;
  regenerate: (templateId: string) => Promise<void>;
  /** Re-runs the last attempted template, for the panel's Generate/Retry actions. */
  retry: () => void;
}

/**
 * State behind a call's summary rewrite. Lives above both consumers because the
 * transition spans two of them: the pill and the content pane, which swaps to
 * `SummaryGenerationPanel` while the rewrite runs.
 */
export function useCallSummaryRegeneration(
  callId: string,
  summaryTemplateId: string | null | undefined,
): CallSummaryRegeneration {
  const [committedTemplateId, setCommittedTemplateId] = useState<string | null>(
    summaryTemplateId ?? null,
  );
  // Set on pick so the pill names the choice immediately. Clearing it reverts the
  // pill on failure; on success the committed id has already moved.
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const [runNonce, setRunNonce] = useState(0);
  const [canvasNonce, setCanvasNonce] = useState(0);
  const lastTemplateIdRef = useRef<string | null>(null);

  // The prop comes off navigation state and never re-resolves, so reseed on the
  // call alone — keying on summaryTemplateId would undo each rewrite as it landed.
  useEffect(() => {
    setCommittedTemplateId(summaryTemplateId ?? null);
    setPendingTemplateId(null);
    setIsRegenerating(false);
    setHasFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  const regenerate = useCallback(
    async (templateId: string): Promise<void> => {
      if (isRegenerating) return;
      lastTemplateIdRef.current = templateId;
      setPendingTemplateId(templateId);
      setIsRegenerating(true);
      setHasFailed(false);
      setRunNonce(value => value + 1);
      try {
        const result = await callService.regenerateCallSummary(callId, templateId);
        setCommittedTemplateId(result.summaryTemplateId);
        // Canvas id is unchanged (edited in place), so force the remount.
        setCanvasNonce(value => value + 1);
      } catch {
        setHasFailed(true);
        toast.error('Failed to update summary', { description: 'Please try again.' });
      } finally {
        setPendingTemplateId(null);
        setIsRegenerating(false);
      }
    },
    [callId, isRegenerating],
  );

  const retry = useCallback((): void => {
    void regenerate(lastTemplateIdRef.current ?? committedTemplateId ?? 'default');
  }, [regenerate, committedTemplateId]);

  return {
    appliedTemplateId: pendingTemplateId ?? committedTemplateId,
    isRegenerating,
    hasFailed,
    runNonce,
    canvasNonce,
    regenerate,
    retry,
  };
}
