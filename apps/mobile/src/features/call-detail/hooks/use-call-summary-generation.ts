import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Call } from '@xyne/shared';

import { showMessageToast } from '@/src/utils/toast';

import { callDetailService } from '../services/call-detail-service';

type DetailedSummaryStatus = 'pending' | 'ready' | 'failed' | null;

export interface SummaryGenerationRequest {
  templateId: string;
  templateName: string;
}

export interface CallSummaryGeneration {
  selectedTemplateId: string | null;
  /** True for a run started anywhere, not just on this screen. */
  isGenerating: boolean;
  request: SummaryGenerationRequest | null;
  /** Bumps when a regeneration lands — the canvas id is reused, so it must refetch. */
  canvasNonce: number;
  regenerate: (templateId: string, templateName: string) => void;
}

/**
 * Port of the dashboard's useCallSummaryGeneration. Regeneration answers 202 and
 * finishes on its own, so the only completion signal is the status the backend
 * publishes on the call row — which `call` gets live from Zero.
 */
export function useCallSummaryGeneration(call: Call | undefined): CallSummaryGeneration {
  const metadata = call?.metadata as Record<string, unknown> | null | undefined;
  const status = useMemo<DetailedSummaryStatus>(() => {
    const raw = metadata?.['detailedSummaryStatus'];
    return raw === 'pending' || raw === 'ready' || raw === 'failed' ? raw : null;
  }, [metadata]);

  const [request, setRequest] = useState<SummaryGenerationRequest | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [canvasNonce, setCanvasNonce] = useState(0);
  const previousStatusRef = useRef<DetailedSummaryStatus>(null);

  // Edges, not values — a row that was already failed must not toast on every sync.
  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previous === 'pending' && status === 'ready') setCanvasNonce(value => value + 1);
    if (previous !== null && previous !== 'failed' && status === 'failed') {
      showMessageToast('Summary generation failed. Please try again.', 'error');
    }
  }, [status]);

  // Clearing the request stops the spinner; the extra nonce bump covers a run
  // whose 'pending' never synced.
  useEffect(() => {
    if (!request) return;
    const succeeded = call?.summaryTemplateId === request.templateId && status === 'ready';
    if (succeeded) setCanvasNonce(value => value + 1);
    if (succeeded || status === 'failed') setRequest(null);
  }, [request, call?.summaryTemplateId, status]);

  const isGenerating =
    status === 'pending' || (status !== 'failed' && (isStarting || request !== null));

  const callExternalId = call?.externalId;
  const currentTemplateId = call?.summaryTemplateId ?? null;
  const regenerate = useCallback(
    (templateId: string, templateName: string): void => {
      if (!callExternalId || isStarting || request || status === 'pending') return;
      if (templateId === currentTemplateId && status !== 'failed') return;

      setIsStarting(true);
      callDetailService
        .regenerateSummary(callExternalId, templateId)
        .then(() => {
          setRequest({ templateId, templateName });
          showMessageToast(`Generating ${templateName} summary…`, 'success');
        })
        .catch(() => {
          showMessageToast('Failed to start summary generation. Please try again.', 'error');
        })
        .finally(() => setIsStarting(false));
    },
    [callExternalId, currentTemplateId, isStarting, request, status],
  );

  return {
    selectedTemplateId: currentTemplateId,
    isGenerating,
    request,
    canvasNonce,
    regenerate,
  };
}
