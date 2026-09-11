import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { callService } from '../../services/Call/callService';
import type { DetailedSummaryStatus } from '../../services/Recording/recordingService';
import { type Call } from '../CallHistoryScreen/callHistoryItem.utils';

export interface SummaryGenerationRequest {
  templateId: string;
  templateName: string;
}

export interface CallSummaryGeneration {
  selectedTemplateId: string | null;
  /** True for a run started anywhere, not just this screen. */
  isGenerating: boolean;
  request: SummaryGenerationRequest | null;
  /** Belongs in the canvas `key`: regeneration reuses the same canvas id. */
  canvasNonce: number;
  regenerate: (templateId: string, templateName: string) => void;
}

/**
 * Regeneration returns 202 and finishes without us, so the only completion signal
 * is the status the backend publishes on the call's row. `liveCall` must therefore
 * come from an enabled Zero query, never a frozen navigation snapshot.
 */
export function useCallSummaryGeneration(
  call: Call | undefined,
  liveCall: Call | undefined,
): CallSummaryGeneration {
  const summaryCall = liveCall ?? call;
  const summaryCallMetadata = summaryCall?.metadata as Record<string, unknown> | null | undefined;

  const detailedSummaryStatus = useMemo<DetailedSummaryStatus>(() => {
    const raw = summaryCallMetadata?.['detailedSummaryStatus'];
    return raw === 'pending' || raw === 'ready' || raw === 'failed' ? raw : null;
  }, [summaryCallMetadata]);

  const [request, setRequest] = useState<SummaryGenerationRequest | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [canvasNonce, setCanvasNonce] = useState(0);
  const previousStatusRef = useRef<DetailedSummaryStatus>(null);

  // Edges, not values — or a row that was already failed toasts on every sync.
  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = detailedSummaryStatus;

    if (previous === 'pending' && detailedSummaryStatus === 'ready') {
      setCanvasNonce(value => value + 1);
    }

    if (previous !== null && previous !== 'failed' && detailedSummaryStatus === 'failed') {
      toast.error('Summary generation failed', { description: 'Please try again.' });
    }
  }, [detailedSummaryStatus]);

  // Clearing the request is what stops the spinner. The second nonce bump covers
  // a run whose 'pending' never arrived, leaving the effect above no edge to see.
  useEffect(() => {
    if (!request) return;

    const succeeded =
      summaryCall?.summaryTemplateId === request.templateId && detailedSummaryStatus === 'ready';
    if (succeeded) setCanvasNonce(value => value + 1);
    if (succeeded || detailedSummaryStatus === 'failed') setRequest(null);
  }, [request, summaryCall?.summaryTemplateId, detailedSummaryStatus]);

  // A 'failed' row overrules local bookkeeping, else a lost message spins forever.
  const isGenerating =
    detailedSummaryStatus === 'pending' ||
    (detailedSummaryStatus !== 'failed' && (isStarting || request !== null));

  const regenerate = (templateId: string, templateName: string): void => {
    // The status check catches a run started elsewhere: neither local flag is set.
    if (!call || isStarting || request || detailedSummaryStatus === 'pending') return;

    // Re-picking the current template is a no-op — unless it failed, which is "try again".
    if (templateId === summaryCall?.summaryTemplateId && detailedSummaryStatus !== 'failed') {
      return;
    }

    setIsStarting(true);
    void callService
      .regenerateSummary(call.externalId, templateId)
      .then(() => {
        setRequest({ templateId, templateName });
        toast.success(`Generating ${templateName} summary`, {
          description: "We'll notify you when it's ready.",
        });
      })
      .catch(() => {
        toast.error('Failed to start summary generation', {
          description: 'Please try again.',
        });
      })
      .finally(() => setIsStarting(false));
  };

  return {
    selectedTemplateId: summaryCall?.summaryTemplateId ?? null,
    isGenerating,
    request,
    canvasNonce,
    regenerate,
  };
}
