/**
 * ResumePayload — the unified shape for resuming a paused execution.
 *
 * One contract for every pause type:
 * - Mid-execution agent pauses (tool approval, input required, user interrupted)
 * - Review gates (`onComplete: 'review'`)
 *
 * The router validates incoming bodies into this shape; persistence stores it
 * verbatim; the executor and step `onResume` handlers consume it.
 */

import type { Attachment } from './attachment.js';

/**
 * Alias for {@link Attachment} kept for clarity at call sites that historically
 * said "resume attachment". The shape is shared across the framework.
 */
export type ResumeAttachment = Attachment;

/**
 * What the user decided.
 * - `approve`: continue from a mid-pause OR advance past a review gate
 * - `retry`:   re-execute the current step with `priorState` + `feedback` (review gate)
 * - `abort`:   cancel the execution
 */
export type ResumeAction = 'approve' | 'retry' | 'abort';

/** Payload from the host when resuming a paused execution. */
export interface ResumePayload {
  action: ResumeAction;
  /** User-provided text input (form feedback, instruction, additional context). */
  feedback?: string;
  /** Files uploaded alongside the feedback. Opaque references — host resolves. */
  attachments?: ResumeAttachment[];
  /** Step-specific extras from custom form fields. Opaque to the framework. */
  data?: Record<string, unknown>;
}
