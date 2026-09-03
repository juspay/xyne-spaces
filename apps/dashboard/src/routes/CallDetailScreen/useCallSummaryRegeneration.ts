import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { callService } from '../../services/Call/callService';
import {
  clearSummaryRequested,
  getSummaryProgress,
  getSummaryRequest,
  getSummaryStage,
  markSummaryRequested,
  saveSummaryProgress,
} from '../../utils/recordingSummaryRequest';
import { deriveSummaryPanelState, type SummaryPanelState } from '../../utils/summaryPanelState';
import {
  getSummaryModelPreference,
  useSummaryModelPreference,
  type SummaryModelPreference,
} from '../../hooks/useSummaryModelPreference';

/**
 * How long past a call's end a backend-published 'pending' is still believed.
 * Mirrors the recording screen: a summary lands within minutes, so an hour later
 * the run that claimed it is gone.
 */
const SUMMARY_PENDING_GRACE_MS = 60 * 60 * 1000;

export interface UseCallSummaryRegenerationInput {
  callId: string;
  /** The applied template, live off the call row. */
  summaryTemplateId: string | null | undefined;
  /** Backend-published lifecycle, live off the call row's metadata. */
  detailedSummaryStatus: 'pending' | 'ready' | 'failed' | null;
  /** The summary canvas, which for a call is pointed at from the call message. */
  detailedSummaryCanvasId: string | null;
  /** When the call ended, in ms — the clock the stale-'pending' fallback reads. */
  endedAtMs: number | null;
  /** LLM tier that wrote the visible summary, live off the call row's metadata. */
  summaryModelUsed: SummaryModelPreference | null;
}

export interface CallSummaryRegeneration {
  /**
   * Template the visible summary was written with. Stays put during a rewrite: the
   * pill describes what is on screen, which is the old summary until the new lands.
   */
  appliedTemplateId: string | null;
  /** Template the running rewrite is producing, for the menu's in-progress row. */
  regeneratingTemplateId: string;
  /** Which of canvas / shimmer / try-again / generate the content pane should render. */
  panelState: SummaryPanelState;
  /** True for the whole run, so the pill can't start a second one over the first. */
  isRegenerating: boolean;
  /** Bumped per run so SummaryGenerationPanel restarts its progress animation. */
  runNonce: number;
  /** Bumped when a run lands so the canvas remounts against the rewritten document. */
  canvasNonce: number;
  /** Progress the panel resumes from, so returning mid-run doesn't restart the bar. */
  initialProgress: number;
  initialStageIndex: number;
  /** Persists the panel's progress when it unmounts mid-run. */
  onProgressPause: (progress: number, stageIndex: number) => void;
  regenerate: (templateId: string, templateName?: string) => Promise<void>;
  /** Re-runs the last attempted template, for the panel's Generate/Try again actions. */
  retry: () => void;
  /** Rewrites the applied template at `target`; `makeDefault` also moves the saved default. */
  applyModel: (target: SummaryModelPreference, makeDefault: boolean) => void;
}

/**
 * State behind a call's summary rewrite. Lives above both consumers because the
 * transition spans the pill and the content pane.
 *
 * The rewrite outlives the request that starts it (202, then the server keeps
 * generating), so progress is read from the replicated `detailedSummaryStatus`
 * rather than a promise, and the request itself is persisted in sessionStorage so
 * returning to the screen restores the shimmer instead of re-offering the button.
 */
export function useCallSummaryRegeneration({
  callId,
  summaryTemplateId,
  detailedSummaryStatus,
  detailedSummaryCanvasId,
  endedAtMs,
  summaryModelUsed,
}: UseCallSummaryRegenerationInput): CallSummaryRegeneration {
  const { setSummaryModelPreference } = useSummaryModelPreference();
  // Set on pick so the pill names the choice immediately, and cleared once the
  // run settles — by which point the applied id has moved, or the pick is off.
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const [awaitingSummary, setAwaitingSummary] = useState(() => !!getSummaryRequest(callId));
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [runNonce, setRunNonce] = useState(0);
  const [canvasNonce, setCanvasNonce] = useState(0);
  const lastTemplateIdRef = useRef<string | null>(null);

  // Navigating between calls reuses this hook, and a run belongs to the call it
  // started on. Re-read the marker rather than clearing it: arriving at a call
  // whose rewrite is still running must shimmer with that run's template.
  useEffect(() => {
    const request = getSummaryRequest(callId);
    setPendingTemplateId(request?.templateId ?? null);
    setSummaryFailed(false);
    setIsStarting(false);
    setAwaitingSummary(request !== null);
    // Without this the ref still holds the previous call's template, and
    // "Generate summary" here would silently apply it.
    lastTemplateIdRef.current = request?.templateId ?? null;
  }, [callId]);

  // A run is over when the backend says so. 'failed' is terminal too — dropping
  // the marker is what lets the panel offer "Try again" instead of a dead shimmer.
  useEffect(() => {
    const request = getSummaryRequest(callId);
    if (!request) return;
    const isReady = detailedSummaryStatus === 'ready';
    const requestedIsReady = request.templateId
      ? summaryTemplateId === request.templateId && isReady
      : isReady;
    if (!requestedIsReady && detailedSummaryStatus !== 'failed') return;
    setAwaitingSummary(false);
    setPendingTemplateId(null);
    clearSummaryRequested(callId);
    // A rewrite reuses the canvas id, so nothing in the render tree moves on its
    // own — bump the key to refetch the new content.
    if (requestedIsReady) setCanvasNonce(value => value + 1);
  }, [callId, detailedSummaryStatus, summaryTemplateId]);

  // Seed a marker for a run this browser did not start — in practice the automatic
  // post-call summary. Progress only persists across unmounts while a marker exists
  // (saveSummaryProgress no-ops without one), so otherwise leaving the tab mid-run
  // restarts the bar at zero. The recording screen seeds on the opposite condition:
  // its automatic path publishes no status, so it seeds only when there is none to
  // read; the call path does publish 'pending', which is exactly the run to track.
  useEffect(() => {
    if (detailedSummaryStatus !== 'pending' || detailedSummaryCanvasId) return;
    if (getSummaryRequest(callId)) return;
    // Same clock as the staleness check below. Past the window the run is presumed
    // gone, and this marker's TTL runs from now rather than from the call's end, so
    // seeding would push the shimmer past the point that check exists to end.
    if (endedAtMs !== null && Date.now() - endedAtMs > SUMMARY_PENDING_GRACE_MS) return;
    // No templateId: nobody picked one, so any 'ready' settles this marker.
    markSummaryRequested(callId);
  }, [callId, detailedSummaryStatus, detailedSummaryCanvasId, endedAtMs]);

  // Generation is fire-and-forget in the API process, so a deploy or crash mid-run
  // leaves 'pending' with nothing to settle it. Scoped to a backend-observed run
  // with nothing to show: a request this browser made owns the shimmer until its
  // marker expires, and a rewrite of an old call must not read as stale the moment
  // it starts — endedAt dates the call, not the run.
  const pendingIsStale =
    detailedSummaryStatus === 'pending' &&
    !awaitingSummary &&
    !detailedSummaryCanvasId &&
    endedAtMs !== null &&
    Date.now() - endedAtMs > SUMMARY_PENDING_GRACE_MS;

  const derivedPanelState = deriveSummaryPanelState({
    summary: {
      detailedSummaryStatus: pendingIsStale ? null : detailedSummaryStatus,
      detailedSummaryCanvasId,
    },
    awaitingSummary,
    summaryFailed,
  });
  // 'ready' with no pointer yet is a replication gap, not a finished summary: the
  // status lands on the call row and the pointer on the call message, two rows that
  // arrive independently. Shimmer until both agree, so the pane never flashes a
  // generate offer over a summary that exists.
  const panelState: SummaryPanelState =
    derivedPanelState === 'ready' && !detailedSummaryCanvasId ? 'pending' : derivedPanelState;

  const regenerate = useCallback(
    async (
      templateId: string,
      templateName?: string,
      modelType?: SummaryModelPreference,
    ): Promise<void> => {
      if (isStarting || awaitingSummary) return;
      // Re-picking the template already on screen is a no-op, as for recordings: an
      // LLM run reproducing the same document costs minutes and changes nothing. An
      // explicit tier is the exception — that request is "same template, other model".
      if (!modelType && detailedSummaryCanvasId && templateId === summaryTemplateId) return;
      lastTemplateIdRef.current = templateId;
      // Persist before the request, not after: the run outlives this screen.
      markSummaryRequested(callId, templateId);
      setPendingTemplateId(templateId);
      setRunNonce(value => value + 1);
      setAwaitingSummary(true);
      setSummaryFailed(false);
      setIsStarting(true);
      // A call gets no creation-time handoff of the browser's tier preference the
      // way a recording does, so seed it on the first generation only. Once the call
      // carries its own tier that wins — otherwise picking a template would silently
      // undo a "Retry with Thinking" made here.
      const requestedModelType =
        modelType ?? (summaryModelUsed ? undefined : getSummaryModelPreference());
      try {
        // 202-only: the server carries on after this resolves, and the pane flips
        // when the replicated detailedSummaryStatus lands.
        await callService.regenerateCallSummary(callId, templateId, requestedModelType);
        const label = templateName ?? (templateId === 'default' ? 'Default' : 'Call');
        toast.success(
          // A tier the user asked for by name is what that request was about; a
          // template pick is about the template.
          modelType
            ? `Generating summary with ${modelType === 'thinking' ? 'Thinking' : 'Fast'}`
            : `Generating ${label} summary`,
          { description: 'The current summary stays up until the new one is ready.' },
        );
      } catch (error) {
        // Nothing is on its way, so drop the marker — leaving it set would restore
        // a shimmer for a run that never started.
        setAwaitingSummary(false);
        setPendingTemplateId(null);
        setSummaryFailed(true);
        clearSummaryRequested(callId);
        // Prefer the server's reason, as the recording screen does: the pre-flight
        // rejects a template this user cannot use, and "Please try again" would send
        // them round the same loop forever.
        const reason = axios.isAxiosError(error)
          ? (error.response?.data as { error?: string } | undefined)?.error
          : undefined;
        toast.error('Failed to start summary generation', {
          description: reason ?? 'Please try again.',
        });
      } finally {
        setIsStarting(false);
      }
    },
    [
      callId,
      isStarting,
      awaitingSummary,
      detailedSummaryCanvasId,
      summaryTemplateId,
      summaryModelUsed,
    ],
  );

  const retry = useCallback((): void => {
    void regenerate(lastTemplateIdRef.current ?? summaryTemplateId ?? 'default');
  }, [regenerate, summaryTemplateId]);

  // Mirrors the recording screen's applyModel: rewrite the summary that is up with
  // the other tier, optionally making that tier the browser default too.
  const applyModel = useCallback(
    (target: SummaryModelPreference, makeDefault: boolean): void => {
      if (makeDefault) setSummaryModelPreference(target);
      void regenerate(summaryTemplateId ?? 'default', undefined, target);
    },
    [regenerate, summaryTemplateId, setSummaryModelPreference],
  );

  const onProgressPause = useCallback(
    (progress: number, stageIndex: number): void => {
      saveSummaryProgress(callId, progress, stageIndex);
    },
    [callId],
  );

  return {
    appliedTemplateId: summaryTemplateId ?? null,
    regeneratingTemplateId: (pendingTemplateId ?? summaryTemplateId) || 'default',
    panelState,
    // awaitingSummary covers the gap between the 202 and the backend's own
    // 'pending' write: with a summary up the row still reads 'ready' for the
    // seconds spent on pre-flight checks and the transcript fetch, so without it
    // the spinner blinks off and the retry button re-enables — onto a `regenerate`
    // that early-returns on that same flag and drops the click. The recording
    // screen closes this by writing 'pending' into its local snapshot; this row is
    // live from Zero, so the flag carries it. panelState covers the automatic run
    // too, so a rewrite can't stack on a summary the backend is already writing.
    isRegenerating: isStarting || awaitingSummary || panelState === 'pending',
    runNonce,
    canvasNonce,
    // Only read when the panel is the rendering branch — with a canvas up these
    // would be a sessionStorage parse per render for nothing.
    initialProgress: detailedSummaryCanvasId ? 0 : getSummaryProgress(callId),
    initialStageIndex: detailedSummaryCanvasId ? 0 : getSummaryStage(callId),
    onProgressPause,
    regenerate,
    retry,
    applyModel,
  };
}
