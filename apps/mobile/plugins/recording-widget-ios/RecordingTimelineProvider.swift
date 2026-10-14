import WidgetKit

/// Reads the recording state published by RecordingWidgetModule (main app
/// target) into the App Group's UserDefaults. Only refreshed on actual
/// start/stop transitions (via WidgetCenter.reloadTimelines) — the elapsed
/// timer itself renders via Text(timerInterval:), which SpringBoard ticks
/// natively without any per-second timeline reloads.
struct RecordingTimelineProvider: TimelineProvider {
  private static let appGroup = "__APP_GROUP__"
  private static let isRecordingKey = "recording_is_recording"
  private static let startTimeMsKey = "recording_start_time_ms"
  private static let hasErrorKey = "recording_has_error"

  private func currentEntry() -> RecordingWidgetEntry {
    let defaults = UserDefaults(suiteName: Self.appGroup)
    let isRecording = defaults?.bool(forKey: Self.isRecordingKey) ?? false
    let startTimeMs = defaults?.double(forKey: Self.startTimeMsKey) ?? 0
    let startTime = startTimeMs > 0 ? Date(timeIntervalSince1970: startTimeMs / 1000) : nil
    let hasError = defaults?.bool(forKey: Self.hasErrorKey) ?? false
    return RecordingWidgetEntry(
      date: Date(),
      isRecording: isRecording && startTime != nil,
      startTime: startTime,
      hasError: hasError
    )
  }

  func placeholder(in context: Context) -> RecordingWidgetEntry {
    RecordingWidgetEntry(date: Date(), isRecording: false, startTime: nil, hasError: false)
  }

  func getSnapshot(in context: Context, completion: @escaping (RecordingWidgetEntry) -> Void) {
    completion(currentEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<RecordingWidgetEntry>) -> Void) {
    let timeline = Timeline(entries: [currentEntry()], policy: .never)
    completion(timeline)
  }
}
