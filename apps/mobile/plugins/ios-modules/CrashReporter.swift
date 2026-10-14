import Foundation
import React

// MARK: - Constants

private let kCrashFileName = "native_crash_pending.json"
private let kMaxStackSize = 50_000  // ~50KB cap to avoid OOM during crash
private let kAppGroupId = "group.net.juspay.xynespaces.share"
private let kNSECrashQueueDir = "nse_crash_queue"
private let kMaxCrashAge: TimeInterval = 7 * 24 * 60 * 60 // 7 days

// MARK: - Global State (signal-handler safe — no Swift ARC calls)

private var gPreviousExceptionHandler: NSUncaughtExceptionHandler? = nil
private var gCrashFilePath: String = ""

// MARK: - NSException Handler

private func lotusUncaughtExceptionHandler(exception: NSException) {
  let timestamp = ISO8601DateFormatter().string(from: Date())
  let name = exception.name.rawValue
  let reason = exception.reason ?? "(no reason)"
  var stack = exception.callStackSymbols.joined(separator: "\n")
  if stack.utf8.count > kMaxStackSize {
    stack = String(stack.prefix(kMaxStackSize)) + "\n... [truncated]"
  }

  // Encode userInfo as a simple key-value JSON object (string values only)
  var userInfoJSON = "{}"
  if let ui = exception.userInfo, !ui.isEmpty {
    let pairs = ui.compactMap { k, v -> String? in
      guard let key = k as? String else { return nil }
      return "  \(jsonStringEscape(key)): \(jsonStringEscape("\(v)"))"
    }.joined(separator: ",\n")
    userInfoJSON = "{\n\(pairs)\n}"
  }

  let json = """
  {
    "type": "native_ios",
    "name": \(jsonStringEscape(name)),
    "message": \(jsonStringEscape(reason)),
    "stack": \(jsonStringEscape(stack)),
    "timestamp": \(jsonStringEscape(timestamp)),
    "userInfo": \(userInfoJSON)
  }
  """

  writeStringAtomically(json, to: gCrashFilePath)

  // Chain to previous handler
  gPreviousExceptionHandler?(exception)
}

// MARK: - Atomic File Write (signal-handler safe)

/// Writes `content` to `path` atomically using Foundation APIs.
/// NOT async-signal-safe — only call from normal thread context (NSException handler).
private func writeStringAtomically(_ content: String, to path: String) {
  guard !path.isEmpty else { return }
  let tmpPath = path + ".tmp"

  guard let data = content.data(using: .utf8) else { return }

  do {
    try data.write(to: URL(fileURLWithPath: tmpPath), options: [.atomic])
    _ = try? FileManager.default.replaceItemAt(
      URL(fileURLWithPath: path),
      withItemAt: URL(fileURLWithPath: tmpPath),
      backupItemName: nil,
      options: []
    )
  } catch {
    // Silently fail — never crash the crash handler
  }
}

// MARK: - JSON String Escape Helper

private func jsonStringEscape(_ s: String) -> String {
  let escaped = s
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
    .replacingOccurrences(of: "\n", with: "\\n")
    .replacingOccurrences(of: "\r", with: "\\r")
    .replacingOccurrences(of: "\t", with: "\\t")
  return "\"\(escaped)\""
}

// MARK: - RN Module

@objc(LotusCrashReporter)
class LotusCrashReporter: NSObject {

  private static let ioQueue = DispatchQueue(label: "net.juspay.xynespaces.crashreporter", qos: .utility)
  private static var handlersInstalled = false
  private static let installLock = NSLock()

  override init() {
    super.init()
    LotusCrashReporter.install()
  }

  // MARK: Module Registration

  @objc static func requiresMainQueueSetup() -> Bool { false }

  // MARK: - Handler Installation

  /// Call once at app startup (e.g., from AppDelegate or module init).
  @objc static func install() {
    installLock.lock()
    defer { installLock.unlock() }
    guard !handlersInstalled else { return }

    // Cache crash file path into global so signal handler can use it safely
    if let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      gCrashFilePath = docs.appendingPathComponent(kCrashFileName).path
    }

    installSignalHandlers()
    installExceptionHandler()
    handlersInstalled = true
  }

  private static func installSignalHandlers() {
    crashreporter_install_handlers(gCrashFilePath)
  }

  private static func installExceptionHandler() {
    gPreviousExceptionHandler = NSGetUncaughtExceptionHandler()
    NSSetUncaughtExceptionHandler(lotusUncaughtExceptionHandler)
  }

  // MARK: - RN Bridge Methods

  @objc func getPendingCrash(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    LotusCrashReporter.ioQueue.async {
      guard let path = self.crashFilePath() else {
        resolve(nil)
        return
      }

      guard FileManager.default.fileExists(atPath: path) else {
        resolve(nil)
        return
      }

      do {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          // Corrupt — clean up
          try? FileManager.default.removeItem(atPath: path)
          resolve(nil)
          return
        }
        resolve(json)
      } catch {
        // Corrupt JSON — clean up silently
        try? FileManager.default.removeItem(atPath: path)
        resolve(nil)
      }
    }
  }

  @objc func clearPendingCrash(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    LotusCrashReporter.ioQueue.async {
      guard let path = self.crashFilePath() else {
        resolve(false)
        return
      }

      do {
        if FileManager.default.fileExists(atPath: path) {
          try FileManager.default.removeItem(atPath: path)
        }
        resolve(true)
      } catch {
        resolve(false)
      }
    }
  }

  // MARK: - Multiple Crash Recovery (App Group Shared)

  /// Returns all pending crashes from both local storage and NSE shared App Group.
  @objc func getPendingCrashes(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    LotusCrashReporter.ioQueue.async {
      var allCrashes: [[String: Any]] = []

      // 1. Check local crash file (existing behavior)
      if let localPath = self.crashFilePath(),
         FileManager.default.fileExists(atPath: localPath) {
        do {
          let data = try Data(contentsOf: URL(fileURLWithPath: localPath))
          if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
            allCrashes.append(json)
          }
        } catch {
          // Corrupt file, will be cleaned up later
        }
      }

      // 2. Check NSE crash queue in shared App Group
      if let nseCrashes = self.readNSECrashQueue() {
        allCrashes.append(contentsOf: nseCrashes)
      }

      resolve(allCrashes.isEmpty ? nil : allCrashes)
    }
  }

  /// Clears all pending crashes from both local storage and NSE shared App Group.
  @objc func clearAllPendingCrashes(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    LotusCrashReporter.ioQueue.async {
      var success = true

      // 1. Clear local crash file
      if let localPath = self.crashFilePath(),
         FileManager.default.fileExists(atPath: localPath) {
        do {
          try FileManager.default.removeItem(atPath: localPath)
        } catch {
          success = false
        }
      }

      // 2. Clear NSE crash queue
      if !self.clearNSECrashQueue() {
        success = false
      }

      resolve(success)
    }
  }

  // MARK: - NSE Crash Queue Helpers

  private func nseCrashQueueURL() -> URL? {
    guard let containerURL = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: kAppGroupId
    ) else {
      return nil
    }
    return containerURL.appendingPathComponent(kNSECrashQueueDir, isDirectory: true)
  }

  private func readNSECrashQueue() -> [[String: Any]]? {
    guard let queueURL = nseCrashQueueURL() else { return nil }

    let fileManager = FileManager.default
    guard fileManager.fileExists(atPath: queueURL.path) else { return nil }

    do {
      let files = try fileManager.contentsOfDirectory(
        at: queueURL,
        includingPropertiesForKeys: [.creationDateKey],
        options: [.skipsHiddenFiles]
      )

      let jsonFiles = files.filter { $0.pathExtension == "json" }
      guard !jsonFiles.isEmpty else { return nil }

      var crashes: [[String: Any]] = []
      let cutoffDate = Date().addingTimeInterval(-kMaxCrashAge)

      for file in jsonFiles {
        // Skip files older than max age
        if let attrs = try? fileManager.attributesOfItem(atPath: file.path),
           let creationDate = attrs[.creationDate] as? Date,
           creationDate < cutoffDate {
          // Clean up old file
          try? fileManager.removeItem(at: file)
          continue
        }

        do {
          let data = try Data(contentsOf: file)
          if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
            crashes.append(json)
          }
        } catch {
          NSLog("[CrashReporter] Skipping corrupt NSE crash file: \(file.lastPathComponent), error: \(error)")
        }
      }

      return crashes.isEmpty ? nil : crashes
    } catch {
      return nil
    }
  }

  private func clearNSECrashQueue() -> Bool {
    guard let queueURL = nseCrashQueueURL() else { return true }

    let fileManager = FileManager.default
    guard fileManager.fileExists(atPath: queueURL.path) else { return true }

    do {
      let files = try fileManager.contentsOfDirectory(
        at: queueURL,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
      )

      for file in files where file.pathExtension == "json" {
        try fileManager.removeItem(at: file)
      }

      return true
    } catch {
      return false
    }
  }

  @objc func simulateNativeCrash() {
    // Deliberately crash via forced unwrap of nil pointer
    let ptr: UnsafePointer<Int>? = nil
    _ = ptr!.pointee
  }

  @objc func getNativeAppInfo(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let bundle = Bundle.main
    let bundleId = bundle.bundleIdentifier ?? ""
    let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    let build   = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""

    #if DEBUG
    let isDebug = true
    #else
    let isDebug = false
    #endif

    let info: [String: Any] = [
      "bundleIdentifier": bundleId,
      "version": version,
      "buildNumber": build,
      "isDebug": isDebug,
      "timestamp": Date().timeIntervalSince1970 * 1000,
    ]
    resolve(info)
  }

  // MARK: - Helpers

  private func crashFilePath() -> String? {
    guard !gCrashFilePath.isEmpty else {
      // Fallback if install() wasn't called
      return FileManager.default
        .urls(for: .documentDirectory, in: .userDomainMask)
        .first?
        .appendingPathComponent(kCrashFileName)
        .path
    }
    return gCrashFilePath
  }
}

