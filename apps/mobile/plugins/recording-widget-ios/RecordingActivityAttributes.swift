import ActivityKit
import Foundation

/// Kept minimal: the elapsed timer renders via Text(timerInterval:) from
/// `startTime`, so ContentState never needs per-second update() calls.
/// This file has an identical copy in the main app target (plugins/ios-modules/) —
/// ActivityAttributes must be visible to both the app (which starts/ends the
/// Activity) and this extension (which renders it), and duplicating this tiny
/// struct is simpler and lower-risk than wiring one file into two Xcode targets.
struct RecordingActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var startTime: Date
  }

  var externalId: String
}
