import type { RecordingDetail } from '../../services/Recording/recordingService';

/**
 * Single discriminated state for the summary panel/canvas region.
 *
 * - `ready`  → canvas is fetchable and should render; the panel is hidden.
 * - `pending` → generation is running; the panel shows a shimmer/progress bar.
 * - `failed`  → last generation attempt failed; the panel shows "Try again".
 * - `idle`    → nothing generated and nothing running; the panel offers
 *   "Generate summary".
 */
export type SummaryPanelState = 'ready' | 'pending' | 'failed' | 'idle';

export interface DeriveSummaryPanelStateInput {
  recording: RecordingDetail;
  /** True while a user-initiated regenerate request is in flight or persisted in sessionStorage. */
  awaitingSummary: boolean;
  /** Last regenerate attempt from this browser session threw. */
  summaryFailed: boolean;
}

/**
 * Single source of truth for the recording summary UI. Callers use the returned
 * state to derive both the canvas render (`ready`) and the panel props
 * (`pending` → shimmer, `failed` → try again, `idle` → generate offer).
 *
 * Priority order — earlier rules always win over later ones:
 *   1. Backend-published detailedSummaryStatus (authoritative when set — it is
 *      written 'pending' at recording creation and flipped to 'ready'/'failed'
 *      by every generation path).
 *   2. Local client state (in-flight click, this-session failure).
 *   3. Legacy detailedSummaryReady/detailedSummaryCanvasId inference for
 *      recordings that predate the status field.
 */
export function deriveSummaryPanelState(input: DeriveSummaryPanelStateInput): SummaryPanelState {
  const { recording, awaitingSummary, summaryFailed } = input;

  // 1. Backend-published status wins. 'failed' in particular is terminal — the
  // panel must render "Try again" regardless of any stale awaiting marker,
  // in-flight request, or legacy boolean flag from earlier revisions.
  if (recording.detailedSummaryStatus === 'failed') return 'failed';
  if (recording.detailedSummaryStatus === 'pending') return 'pending';
  if (recording.detailedSummaryStatus === 'ready') return 'ready';

  // 2. This-session local state next. A local failure (regenerate request
  // rejected in this tab) surfaces the retry offer even before the backend
  // has had a chance to publish its own 'failed' status.
  if (summaryFailed) return 'failed';
  if (awaitingSummary) return 'pending';

  // 3. Legacy inference for recordings that predate detailedSummaryStatus
  // (new recordings always carry the field from creation, so reaching here
  // means the row is old). ready=false with a canvas is a stranded run that
  // will never complete on its own — offer "Try again" rather than a shimmer
  // that can never resolve.
  if (recording.detailedSummaryReady === true) return 'ready';
  if (recording.detailedSummaryReady === false && recording.detailedSummaryCanvasId) {
    return 'failed';
  }
  if (recording.detailedSummaryCanvasId) return 'ready';

  return 'idle';
}
