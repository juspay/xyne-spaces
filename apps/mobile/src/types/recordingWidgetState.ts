export interface RecordingWidgetState {
  isRecording: boolean;
  startTimeMs: number | null;
  externalId: string | null;
  /** Shows a brief "Recording failed" state on the widget; auto-cleared a few
   *  seconds after being published (see recordingStore.ts's 'error' case). */
  hasError?: boolean;
}
