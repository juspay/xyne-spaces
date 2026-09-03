/**
 * Single discriminated state for the summary panel/canvas region, shared by the
 * recording and call detail screens — both render the same four states off the
 * same backend field.
 *
 * - `ready`   → canvas is fetchable and should render; the panel is hidden.
 * - `pending` → generation is running; the panel shimmers.
 * - `failed`  → last attempt failed; the panel shows "Try again".
 * - `idle`    → nothing generated or running; the panel offers "Generate summary".
 */
export type SummaryPanelState = 'ready' | 'pending' | 'failed' | 'idle';

/**
 * The fields the derivation reads, kept structural so both a recording
 * (RecordingDetail) and a call (its Zero row plus the pointer that for calls lives
 * on the call message) satisfy it.
 */
export interface SummarySubject {
  /** Backend-published lifecycle, from Call.metadata.detailedSummaryStatus. */
  detailedSummaryStatus?: 'pending' | 'ready' | 'failed' | null;
  /** Legacy boolean predating the status field; recordings only. */
  detailedSummaryReady?: boolean | null;
  /** The canvas holding the summary, once one has been written. */
  detailedSummaryCanvasId?: string | null;
}

export interface DeriveSummaryPanelStateInput {
  summary: SummarySubject;
  /** True while a user-initiated regenerate request is in flight or persisted in sessionStorage. */
  awaitingSummary: boolean;
  /** Last regenerate attempt from this browser session threw. */
  summaryFailed: boolean;
}

/**
 * Single source of truth for the summary UI on both detail screens.
 *
 * Priority order — earlier rules always win:
 *   1. Backend-published detailedSummaryStatus (authoritative when set; every
 *      generation path in both pipelines writes it).
 *   2. Local client state (in-flight click, this-session failure).
 *   3. Legacy detailedSummaryReady/canvasId inference for rows predating it.
 */
export function deriveSummaryPanelState(input: DeriveSummaryPanelStateInput): SummaryPanelState {
  const { summary, awaitingSummary, summaryFailed } = input;

  // 1. Backend-published status wins. 'failed' in particular is terminal — the
  // panel must render "Try again" regardless of any stale awaiting marker,
  // in-flight request, or legacy boolean flag from earlier revisions.
  if (summary.detailedSummaryStatus === 'failed') return 'failed';
  if (summary.detailedSummaryStatus === 'pending') return 'pending';
  if (summary.detailedSummaryStatus === 'ready') return 'ready';

  // 2. This-session local state next. A local failure (regenerate request
  // rejected in this tab) surfaces the retry offer even before the backend
  // has had a chance to publish its own 'failed' status.
  if (summaryFailed) return 'failed';
  if (awaitingSummary) return 'pending';

  // 3. Legacy inference for rows predating detailedSummaryStatus. ready=false with
  // a canvas is a stranded run that will never complete — offer "Try again" rather
  // than a dead shimmer. A call has no detailedSummaryReady, so it falls through to
  // the canvas check.
  if (summary.detailedSummaryReady === true) return 'ready';
  if (summary.detailedSummaryReady === false && summary.detailedSummaryCanvasId) {
    return 'failed';
  }
  if (summary.detailedSummaryCanvasId) return 'ready';

  return 'idle';
}
