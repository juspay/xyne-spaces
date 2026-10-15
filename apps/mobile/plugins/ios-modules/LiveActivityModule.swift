import ActivityKit
import Foundation

/// Starts/ends the Lock Screen + Dynamic Island Live Activity in lockstep
/// with recordingStore.ts's room lifecycle. Deployment target (16.4) already
/// satisfies ActivityKit's minimum (16.1), so no @available gating is needed
/// here — only the widget/Live-Activity UI's iOS 17+ AppIntent buttons will
/// need that, in a later phase. A Live Activity is a nice-to-have: failures
/// here (disabled in Settings, request() throwing) never block recording.
@objc(LiveActivityModule)
final class LiveActivityModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  private static var currentActivity: Activity<RecordingActivityAttributes>?

  @objc(startActivity:externalId:resolver:rejecter:)
  func startActivity(
    _ startTimeMs: Double,
    externalId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      resolve(nil)
      return
    }

    let startTime = Date(timeIntervalSince1970: startTimeMs / 1000)
    let attributes = RecordingActivityAttributes(externalId: externalId)
    let content = ActivityContent(
      state: RecordingActivityAttributes.ContentState(startTime: startTime),
      staleDate: nil
    )

    do {
      let activity = try Activity<RecordingActivityAttributes>.request(
        attributes: attributes,
        content: content,
        pushType: nil
      )
      Self.currentActivity = activity
    } catch {
      // Best-effort — recording itself is unaffected.
    }
    resolve(nil)
  }

  @objc(endActivity:rejecter:)
  func endActivity(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let current = Self.currentActivity
    Self.currentActivity = nil
    Task {
      await current?.end(nil, dismissalPolicy: .immediate)
      // Also sweep any dangling activities the in-memory handle doesn't know
      // about — after a force-quit/relaunch currentActivity is nil while the
      // OS may still be showing an orphaned "Recording" Live Activity. Called
      // from the store's foreground reconciliation whenever no recording is
      // actually in progress.
      for activity in Activity<RecordingActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      resolve(nil)
    }
  }

  @objc(addListener:)
  func addListener(_ eventName: String) {}

  @objc(removeListeners:)
  func removeListeners(_ count: NSNumber) {}
}
