import Foundation

/// Posts a Darwin notification the still-alive main app process observes
/// (RecordingWidgetModule.swift) to stop a recording without foregrounding —
/// only reachable while a recording is actually in progress, so the app
/// process (and its notification observer) is guaranteed to already be
/// alive. Same cross-process signaling technique as the existing
/// BroadcastExtension's DarwinNotificationCenter.swift.
enum RecordingWidgetDarwinNotification: String {
  case requestStop = "__BUNDLE_ID__.recording.requestStop"
}

enum RecordingWidgetDarwinNotificationCenter {
  static func post(_ name: RecordingWidgetDarwinNotification) {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(name.rawValue as CFString),
      nil,
      nil,
      true
    )
  }
}
