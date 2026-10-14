import WidgetKit

struct RecordingWidgetEntry: TimelineEntry {
  let date: Date
  let isRecording: Bool
  let startTime: Date?
  /// Brief "Recording failed" state — auto-cleared a few seconds after being
  /// published (see recordingStore.ts's 'error' case).
  let hasError: Bool
}
