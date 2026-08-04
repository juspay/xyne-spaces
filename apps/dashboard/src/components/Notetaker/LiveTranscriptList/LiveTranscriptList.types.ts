import type { MarkedMoment, TranscriptEntry } from '../../../stores/recordingStore';

/**
 * Both variants follow the latest line; they differ in whose scroller they follow it in.
 *
 * `panel` — compact type inside its own scrolling viewport, with a "Return to current"
 *   affordance and a transcribing ticker (the floating note-taker overlay).
 * `page` — full-width type that scrolls with the host document and timestamps the
 *   opening block (the recording detail screen).
 */
export type LiveTranscriptVariant = 'panel' | 'page';

export interface LiveTranscriptListProps {
  transcripts: TranscriptEntry[];
  markedMoments: MarkedMoment[];
  /** `panel` only: freezes the transcribing ticker and mutes the caret. */
  isPaused: boolean;
  variant: LiveTranscriptVariant;
  /**
   * `panel` only: suspends auto-scroll while the surrounding panel is collapsed or
   * mid-animation, when measuring the viewport would be meaningless.
   */
  isScrollSuspended?: boolean;
  /** Analytics category of the host surface. */
  trackCategory: string;
  className?: string;
}

export interface MarkedMomentAnchors {
  /** Transcript entries a divider is rendered above. */
  markedTranscriptIds: Set<number>;
  /** True when a moment was marked before any line arrived, so it renders at the top. */
  hasLeadingMoment: boolean;
}
