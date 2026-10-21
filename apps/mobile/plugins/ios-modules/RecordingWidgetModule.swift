import Foundation
import React
import WidgetKit

/// Publishes recording state into the App Group's UserDefaults so the
/// RecordingWidget extension's TimelineProvider can read it, then asks
/// WidgetKit to refresh the on-screen widget immediately. Called from JS
/// (recordingWidgetModule.publishState) at the same start/stop transitions
/// that drive the Android widget and the Live Activity.
///
/// Also the JS-side half of the iOS 17+ no-foreground Stop: observes the
/// Darwin notification StopRecordingIntent posts (extension process) and
/// re-emits it as a JS event. Safe from cold-launch timing races — a
/// recording can only be in progress if the app (and this observer) is
/// already alive, since JS itself owns the LiveKit connection.
///
/// Start has no intent at all: it must foreground the app (no JS is running
/// yet to own the LiveKit connection), and openAppWhenRun is not honored for
/// intents living only in a widget extension — so the widget's Start tap is
/// a plain Link into the xyne-spaces://recordings deep link instead.
@objc(RecordingWidgetModule)
class RecordingWidgetModule: RCTEventEmitter {
  private static let widgetKind = "RecordingWidget"
  private static let isRecordingKey = "recording_is_recording"
  private static let startTimeMsKey = "recording_start_time_ms"
  private static let externalIdKey = "recording_external_id"
  private static let hasErrorKey = "recording_has_error"
  private static let stopEventName = "RECORDING_WIDGET_STOP"

  private var appGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "AppGroupIdentifier") as? String
  }

  private var requestStopNotificationName: String {
    "\(Bundle.main.bundleIdentifier ?? "").recording.requestStop"
  }

  override init() {
    super.init()
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      observer,
      { _, observerPtr, _, _, _ in
        guard let observerPtr else { return }
        let module = Unmanaged<RecordingWidgetModule>.fromOpaque(observerPtr).takeUnretainedValue()
        module.sendEvent(withName: RecordingWidgetModule.stopEventName, body: nil)
      },
      requestStopNotificationName as CFString,
      nil,
      .deliverImmediately
    )
  }

  deinit {
    CFNotificationCenterRemoveObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      nil,
      nil
    )
  }

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    [Self.stopEventName]
  }

  @objc(publishState:startTimeMs:externalId:hasError:resolver:rejecter:)
  func publishState(
    _ isRecording: Bool,
    startTimeMs: Double,
    externalId: String?,
    hasError: Bool,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let appGroup, let defaults = UserDefaults(suiteName: appGroup) else {
      resolve(nil)
      return
    }

    defaults.set(isRecording, forKey: Self.isRecordingKey)
    defaults.set(startTimeMs, forKey: Self.startTimeMsKey)
    defaults.set(externalId, forKey: Self.externalIdKey)
    defaults.set(hasError, forKey: Self.hasErrorKey)

    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)
    }
    resolve(nil)
  }
}
