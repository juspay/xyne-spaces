import Airborne
import BackgroundTasks
import Foundation
import UIKit

final class AirborneManager: NSObject {
  static let shared = AirborneManager()

  private static let airborneReleaseURL = "https://airborne.juspay.in/release/xyne/xyne-mobile-ios"
  private static let airborneNamespace = "xyne-mobile-ios"
  private static let importantPackageDownloadResultKey = "important_package_download_result"
  private static let backgroundTaskIdentifier = "net.juspay.xynespaces.airborne-ota"
  
  private static let cugUrlScheme = "devtools://test"
  private static let cugDeviceName = "Whale999"

  private var airborne: AirborneServices?
  private var startAppHandler: ((URL?) -> Void)?
  private(set) var otaUpdatePending = false
  private(set) var fcmUpdate = false
  private var didEnterBackgroundObserver: NSObjectProtocol?
  private var deferredForegroundOtaTrigger = false

  private override init() {
    super.init()

    didEnterBackgroundObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.handleAppDidEnterBackground()
    }
  }

  func configure(startAppHandler: @escaping (URL?) -> Void) {
    self.startAppHandler = startAppHandler
  }

  func registerBackgroundTask() {
    guard #available(iOS 13.0, *) else {
      return
    }

    BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.backgroundTaskIdentifier, using: nil) {
      [weak self] task in
      guard let self, let processingTask = task as? BGProcessingTask else {
        task.setTaskCompleted(success: false)
        return
      }

      self.handleBackgroundTask(processingTask)
    }
  }

  func scheduleBackgroundTask() {
    guard #available(iOS 13.0, *) else {
      return
    }

    let request = BGProcessingTaskRequest(identifier: Self.backgroundTaskIdentifier)
    request.requiresNetworkConnectivity = true
    request.requiresExternalPower = false
    request.earliestBeginDate = Date(timeIntervalSinceNow: 1)

    do {
      try BGTaskScheduler.shared.submit(request)
      print("[Push][OTA] Scheduled BG task \(Self.backgroundTaskIdentifier)")
    } catch {
      print("AirborneManager: failed to schedule BG task: \(error)")
    }
  }

  func markOtaUpdatePending() {
    otaUpdatePending = true
  }

  func handleOtaTrigger() {
    fcmUpdate = true
    markOtaUpdatePending()
    print("[Push][OTA] handleOtaTrigger invoked")

    if applicationIsBackgrounded() {
      scheduleBackgroundTask()
    }

    initialize(force: true)
  }

  func initialize(force: Bool = false) {
    if Thread.isMainThread {
      initializeOnMainThread(force: force)
      return
    }

    DispatchQueue.main.async { [weak self] in
      self?.initializeOnMainThread(force: force)
    }
  }

  private func initializeOnMainThread(force: Bool) {
    if airborne != nil && !force {
      return
    }

    airborne = nil
    print("[Push][OTA] Initializing Airborne force=\(force)")
    airborne = AirborneServices(
      releaseConfigURL: Self.airborneReleaseURL,
      delegate: self
    )
  }

  private func handleBackgroundTask(_ task: BGProcessingTask) {
    print("[Push][OTA] BG task started")
    task.expirationHandler = {
      task.setTaskCompleted(success: false)
    }

    DispatchQueue.main.async { [weak self] in
      guard let self else {
        task.setTaskCompleted(success: false)
        return
      }

      self.markOtaUpdatePending()
      self.initializeOnMainThread(force: true)
      task.setTaskCompleted(success: true)
      print("[Push][OTA] BG task completed")
    }
  }

  private func handleAppDidEnterBackground() {
    guard otaUpdatePending, deferredForegroundOtaTrigger else {
      return
    }

    deferredForegroundOtaTrigger = false
    print("[Push][OTA] App entered background with pending OTA, initializing Airborne")
    scheduleBackgroundTask()
    initialize(force: true)
  }

  private func applicationIsBackgrounded() -> Bool {
    UIApplication.shared.applicationState != .active
  }
}

extension AirborneManager: AirborneDelegate {
  func namespace() -> String {
    Self.airborneNamespace
  }

  func bundle() -> Bundle {
    Bundle.main
  }

  func dimensions() -> [String: String] {
    let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    return [
      "app_version": version,
      "is_cug": isCug() ? "true" : "false"
    ]
  }

  func onEvent(
    level: String,
    label: String,
    key: String,
    value: [String: Any],
    category: String,
    subcategory: String
  ) {
    print("Airborne: \(label) \(key)")

    guard key == Self.importantPackageDownloadResultKey, otaUpdatePending else {
      return
    }

    print("[Push][OTA] important_package_download_result received while appState=\(UIApplication.shared.applicationState.rawValue)")

    guard applicationIsBackgrounded() else {
      deferredForegroundOtaTrigger = true
      print("[Push][OTA] App is foregrounded, deferring second forced Airborne init")
      return
    }

    otaUpdatePending = false
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
      self?.initialize(force: true)
    }
  }

  func startApp(indexBundleURL: URL?) {
    if fcmUpdate && !applicationIsBackgrounded() {
      return;
    }
    DispatchQueue.main.async { [weak self] in
      self?.startAppHandler?(indexBundleURL)
    }
  }
  
  private func isCug() -> Bool {
    if UIDevice.current.name == Self.cugDeviceName {
      return true
    }

    guard let cugUrl = URL(string: Self.cugUrlScheme) else {
      return false
    }

    return UIApplication.shared.canOpenURL(cugUrl)
  }
}