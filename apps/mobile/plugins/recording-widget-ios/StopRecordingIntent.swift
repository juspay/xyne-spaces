import AppIntents
import Foundation
import WidgetKit

/// iOS 17+ no-foreground Stop for both the home-screen widget and the Live
/// Activity. Below iOS 17 both surfaces fall back to deep links instead.
///
/// Conforms to LiveActivityIntent — NOT plain AppIntent — so the system runs
/// perform() in the APP's process (the type is compiled into both the app and
/// the widget extension; that dual membership is required for the in-app
/// routing to engage). This matters for the home-screen widget staying in
/// sync: a Live Activity button tap gets no automatic widget reload
/// (WidgetKit's post-perform auto-reload only covers the interacted WIDGET),
/// and a reload issued by a backgrounded app is budget-deferred — but reloads
/// requested while the app is executing a user-initiated intent are honored.
@available(iOS 17.0, *)
struct StopRecordingIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Stop Recording"
  static var openAppWhenRun: Bool = false

  private static let appGroup = "__APP_GROUP__"
  private static let isRecordingKey = "recording_is_recording"
  private static let widgetKind = "RecordingWidget"

  func perform() async throws -> some IntentResult {
    // Optimistically flip the shared state to idle FIRST, so every reload —
    // WidgetKit's own post-perform one (widget-button taps) and the explicit
    // ones below — renders the stopped state immediately.
    UserDefaults(suiteName: Self.appGroup)?.set(false, forKey: Self.isRecordingKey)
    WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)

    // The app's Darwin observer (RecordingWidgetModule) turns this into the
    // JS stopRecording dispatch. Delivery works from the app's own process
    // too — the Darwin notify center is system-wide.
    RecordingWidgetDarwinNotificationCenter.post(.requestStop)

    // Hold the intent open briefly: it keeps the app process inside
    // user-initiated intent execution while JS tears the room down and
    // publishes its own state, then issues a final reload from that same
    // privileged context (a backgrounded app's later reload could be
    // deferred). The Live Activity button's built-in progress spinner covers
    // the pause, reading as "stopping…".
    try? await Task.sleep(nanoseconds: 1_500_000_000)
    WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)
    return .result()
  }
}
