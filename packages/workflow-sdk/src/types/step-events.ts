/**
 * Step progress events — emitted via `ctx.emit()` for real-time observability.
 *
 * Events are fire-and-forget: they never block step execution.
 * If persistence fails, the event is lost but the step continues.
 */

export type StepProgressEventType =
  | 'log'
  | 'tool_call'
  | 'thinking'
  | 'progress'
  | 'substep'
  | 'error';

export interface StepProgressEvent {
  type: StepProgressEventType;
  data: Record<string, unknown>;
  /** Defaults to Date.now() if not provided. */
  timestamp?: number;
}

/** Persisted step event record — returned by getStepEvents(). */
export interface StepEventRecord {
  id: string;
  type: string;
  /** JSON string of event data. */
  data: string;
  createdAt: Date;
}
