import Foundation
import OSLog
import UIKit
import UserNotifications
import Darwin
import Security
import AVFoundation
import AudioToolbox
#if canImport(FirebaseCore)
import FirebaseCore
#endif
#if canImport(FirebaseCrashlytics)
import FirebaseCrashlytics
#endif

/// Keep extension diagnostics private. Notification titles, metadata, URLs,
/// identifiers, and error text can contain user or credential material.
private let nseLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "net.juspay.xynespaces.NotificationService",
    category: "NSE"
)

private func lotusSecureNativeLog(_ message: String) {
    nseLogger.notice("\(message, privacy: .private)")
}

private func lotusSanitizedCrashError(_ error: Error) -> NSError {
    return NSError(domain: "NotificationService", code: (error as NSError).code, userInfo: nil)
}

private func lotusRemoteLoggingEnabled() -> Bool {
    guard let raw = Bundle.main.object(forInfoDictionaryKey: "LotusRemoteLoggingEnabled") as? String else {
        return false
    }
    let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return ["1", "true", "yes"].contains(normalized)
}

private func lotusEnsureFirebaseConfigured() {
    guard lotusRemoteLoggingEnabled() else {
        return
    }

    #if canImport(FirebaseCore)
    if FirebaseApp.app() == nil {
        guard
            let plistPath = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
            let options = FirebaseOptions(contentsOfFile: plistPath)
        else {
            lotusSecureNativeLog("Firebase config plist missing in NSE bundle; continuing without Crashlytics")
            return
        }
        FirebaseApp.configure(options: options)
    }
    #endif

    #if canImport(FirebaseCore) && canImport(FirebaseCrashlytics)
    guard FirebaseApp.app() != nil else {
        return
    }

    Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(lotusRemoteLoggingEnabled())
    #endif
}

/// Reports an error to Firebase Crashlytics with context.
/// Safe to call even if Crashlytics is not available.
/// Also writes to shared App Group for main app crash recovery.
private func lotusReportError(_ error: Error, context: String, writeCrashFile: Bool = false) {
    #if canImport(FirebaseCrashlytics)
    if lotusRemoteLoggingEnabled() {
        let crashlytics = Crashlytics.crashlytics()
        crashlytics.log("[NotificationService] error_reported")
        crashlytics.record(error: lotusSanitizedCrashError(error))
    }
    #endif
    lotusSecureNativeLog("NotificationService error: \(context): \(error.localizedDescription)")

    // Write to shared storage for critical errors so main app can recover
    if writeCrashFile {
        lotusWriteNSECrashFromError(error, context: context)
    }
}

/// Reports a non-Error failure to Firebase Crashlytics with context.
private func lotusReportFailure(_ message: String, context: String) {
    #if canImport(FirebaseCrashlytics)
    if lotusRemoteLoggingEnabled() {
        let crashlytics = Crashlytics.crashlytics()
        crashlytics.log("[NotificationService] failure_reported")
        crashlytics.record(error: lotusSanitizedCrashError(NSError(domain: "NotificationService", code: -1)))
    }
    #endif
    lotusSecureNativeLog("NotificationService failure: \(context): \(message)")
}

// MARK: - NSE Crash File Writer (App Group Shared)

/// Writes crash data to the shared App Group container so the main app can recover it.
private func lotusWriteNSECrashToSharedStorage(
    type: String,
    message: String,
    stack: String,
    context: String
) {
    let appGroupId = "group.net.juspay.xynespaces.share"
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupId
    ) else {
        lotusSecureNativeLog("Cannot write crash: App Group container unavailable")
        return
    }

    let crashDir = containerURL.appendingPathComponent("nse_crash_queue", isDirectory: true)

    do {
        try FileManager.default.createDirectory(at: crashDir, withIntermediateDirectories: true)
    } catch {
        lotusSecureNativeLog("Failed to create crash directory: \(error.localizedDescription)")
        return
    }

    let timestamp = ISO8601DateFormatter().string(from: Date())
    let filename = "nse_\(Int(Date().timeIntervalSince1970 * 1000)).json"
    let fileURL = crashDir.appendingPathComponent(filename)

    let crashData: [String: Any] = [
        "type": type,
        "message": message,
        "stack": stack,
        "context": context,
        "timestamp": timestamp,
        "source": "notification_service_extension"
    ]

    do {
        let jsonData = try JSONSerialization.data(withJSONObject: crashData, options: [.prettyPrinted])
        try jsonData.write(to: fileURL, options: .atomic)
        lotusSecureNativeLog("Wrote crash file: \(filename)")
    } catch {
        lotusSecureNativeLog("Failed to write crash file: \(error.localizedDescription)")
    }
}

/// Convenience wrapper to write a redacted Error as a crash file. Crash files
/// live in the shared App Group and may outlive the extension process, so they
/// must not persist localized messages, stack frames, or caller context.
private func lotusWriteNSECrashFromError(_: Error, context _: String) {
    lotusWriteNSECrashToSharedStorage(
        type: "native_ios_nse",
        message: "notification_extension_error",
        stack: "<redacted>",
        context: "error_reported"
    )
}

// MARK: - Constants matching TypeScript implementation
private enum Constants {
    static let lotusUserIdKey = "@lotus_user_id"
    static let globalUserIdKey = "xyne-global:userId"
    static let authTokenSignedOutHandoffKey = "lotus_auth_token_signed_out"
    static let authTokenSignedOutState = "signed_out"
    static let notifGroupKeyPrefix = "@notif_v3_group"
    static let maxStoredNotificationMessages = 25
    static let appGroupId = "group.net.juspay.xynespaces.share"
    static let mmkvId = "lotus-startup"
    static let notificationSoundKey = "xyne-global:notificationSoundId"
    static let settingsStorageKey = "settings:v1"

    static let apiBaseURL = "https://app.spaces.xyne.juspay.net/api"
    static let identityTag = "ClientIdentity"

    static let ignoredNotificationTypes: Set<String> = [
        "INCOMING_CALL",
        "CALL_DISMISS",
        "MISSED_CALL",
        "ONGOING_CALL"
    ]

    /// Must match MESSAGE_CATEGORY_ID in lotus/src/notifications/v3/config.ts
    static let messageCategoryId = "NOTIF_V3_MESSAGE"
    static let sosNotificationType = "sos_alert"
    static let sosCategoryId = "NOTIF_V3_SOS_ALERT"
    static let sosSoundName = "sos_alert"
    static let sosSoundFileName = "sos_alert.caf"
    static let sosAlertsStorageKeyPrefix = "@notif_v3_sos_alerts"
    static let sosPendingStorageKey = "@notif_v3_sos_alerts:pending"
    static let maxStoredSosAlerts = 25

    static let messageNotificationTypes: Set<String> = [
        "CHANNEL_MESSAGE",
        "DIRECT_MESSAGE",
        "THREAD_REPLY",
        "THREAD_MENTION",
        "MENTION"
    ]

    static let controlNotificationTypes: Set<String> = [
        "CHANNEL_READ",
        "THREAD_READ",
        "MESSAGE_DELETED",
        "MESSAGE_EDITED"
    ]

    static let reminderNotificationTypes: Set<String> = [
        "CALL_UPDATED"
    ]

    // Per-request URLSession timeout for Godel logs + metrics POSTs.
    static let observabilityPostTimeoutSeconds: TimeInterval = 5
    // Cumulative matches JS heartbeat series in VictoriaMetrics and older
    // ingest paths that drop OTLP delta. NSE is a one-shot process, so the
    // lifetime total is always 1 — the same number delta would have sent.
    static let otlpAggregationTemporalityCumulative = 2
    static let otlpDeltaWindowNanos: UInt64 = 1_000_000_000
}

// MARK: - Notification Service
final class NotificationService: UNNotificationServiceExtension, AVAudioPlayerDelegate {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?
    private var downloadTask: URLSessionDataTask?
    private var sosAudioPlayer: AVAudioPlayer?
    private var sosAudioFinish: (() -> Void)?
    private var sosAudioTimeoutWorkItem: DispatchWorkItem?
    private var sosSystemSoundID: SystemSoundID = 0
    private var sosAlertSoundLoopsRemaining = 0
    private let sosAlertSoundLoopCount = 3
    private let logPrefix = "[NotificationService]"

    // Serial queue for cache operations
    private let cacheQueue = DispatchQueue(label: "com.xyne.notificationCache", qos: .utility)

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        log("didReceive started; id=\(request.identifier), title=\(request.content.title)")
        self.contentHandler = contentHandler
        relayCallControlPush(userInfo: request.content.userInfo)
        bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        guard let bestAttemptContent else {
            log("Failed to create mutable notification content; falling back to original content")
            // Still record that a payload arrived; OS will show the original content.
            postNotificationDeliveryLogsAndWait(for: request)
            contentHandler(request.content)
            return
        }

        // Debug Marker: temporary visible prefix to confirm NSE execution on-device.
        // bestAttemptContent.title = "[NSE] " + bestAttemptContent.title

        let sosAlert = isSosAlert(userInfo: request.content.userInfo)
        log("isSosAlert=\(sosAlert) keys=\(sortedUserInfoKeys(request.content.userInfo))")

        applySenderPrefix(to: bestAttemptContent, userInfo: request.content.userInfo)
        if sosAlert {
            logIncomingNotificationSoundDiagnostics(
                request: request,
                label: "before-sos-mutate"
            )
            applySosPresentation(to: bestAttemptContent)
            logIncomingNotificationSoundDiagnostics(
                request: request,
                content: bestAttemptContent,
                label: "after-sos-mutate"
            )
        } else {
            applyUserSelectedSound(to: bestAttemptContent)
        }

        // iOS groups notifications by threadIdentifier (APNS thread-id).
        // NSE must set this explicitly so mixed DM + channel pushes stay in separate stacks.
        if let groupId = extractNotificationGroupId(from: request) {
            bestAttemptContent.threadIdentifier = groupId
            if let summary = stringValue(bestAttemptContent.title), !summary.isEmpty {
                bestAttemptContent.summaryArgument = summary
            }
            log("Set threadIdentifier=\(groupId)")
        } else {
            log("No notification group id found; iOS may collapse notifications together")
        }

        if sosAlert {
            bestAttemptContent.categoryIdentifier = Constants.sosCategoryId
            log("Set categoryIdentifier=\(Constants.sosCategoryId)")
            let sosOwnerUserId = currentSharedUserId()
            applySosOwnerMetadata(to: bestAttemptContent, userId: sosOwnerUserId)
            persistSosAlertForAppLaunch(from: request, ownerUserId: sosOwnerUserId)

            // Delivery must not wait for extension-owned audio. Holding the content
            // handler until AudioServices finishes can leave the persisted modal state
            // without a delivered banner if iOS suspends or expires the extension.
            // The notification's configured content.sound is owned by the system.
            log("SOS: delivering immediately with system-owned notification sound")
            // JS never runs for this path; flush funnel logs before we return.
            postNotificationDeliveryLogsAndWait(for: request)
            deliverBestAttemptContent(reason: "sos-immediate")
            return
        }

        if shouldAttachMessageCategory(for: request) {
            bestAttemptContent.categoryIdentifier = Constants.messageCategoryId
            log("Set categoryIdentifier=\(Constants.messageCategoryId)")
        }

        lotusEnsureFirebaseConfigured()

        let group = DispatchGroup()

        // Funnel logs: JS `setBackgroundMessageHandler` usually does not run
        // for iOS alert pushes, so Grafana only sees these if NSE sends them.
        group.enter()
        sendNotificationDeliveryLogs(for: request) { [weak self] in
            self?.log("Observability POST finished")
            group.leave()
        }

        group.enter()
        handleImageAttachment(for: request) {
            group.leave()
        }

        group.enter()
        persistTrayHandoff(for: request) {
            group.leave()
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            self.log("All background work completed; delivering notification")
            self.deliverBestAttemptContent(reason: "handoff-complete")
        }
    }

    // MARK: - Call-control relay
    //
    // CALL_DISMISS / MISSED_CALL arrive as visible pushes, which never reach the app
    // process while it is in the background — only this extension runs. The ring
    // lives in CallKit, in the app process, which is alive for as long as a call is
    // ringing. Hand the push over through the App Group and wake the app's
    // LotusCallPushRouter (AppDelegate.swift) with a Darwin notification; it ends
    // the ring, or remembers the dismiss if the ring push has not arrived yet.
    private static let pendingCallDismissalsKey = "lotus.pendingCallDismissals"
    private static let maxPendingCallDismissals = 10

    private func relayCallControlPush(userInfo: [AnyHashable: Any]) {
        let metadata = extractMetadata(from: userInfo)
        let type = firstNonEmpty([stringValue(userInfo["type"]), stringValue(metadata["type"])])?.uppercased()
        guard type == "CALL_DISMISS" || type == "MISSED_CALL" else { return }
        guard let defaults = UserDefaults(suiteName: Constants.appGroupId) else {
            log("Call relay: App Group unavailable")
            return
        }
        guard let payload = propertyListSafe(userInfo) as? [String: Any] else {
            log("Call relay: payload is not property-list safe")
            return
        }
        var entries = (defaults.array(forKey: Self.pendingCallDismissalsKey) as? [[String: Any]]) ?? []
        entries.append(["payload": payload, "receivedAt": Date().timeIntervalSince1970])
        if entries.count > Self.maxPendingCallDismissals {
            entries.removeFirst(entries.count - Self.maxPendingCallDismissals)
        }
        defaults.set(entries, forKey: Self.pendingCallDismissalsKey)
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName("\(Constants.appGroupId).call-dismiss" as CFString),
            nil,
            nil,
            true
        )
        log("Call relay: \(type ?? "") handed to the app")
    }

    /// UserDefaults stores property-list types only. APNs payloads are nearly that,
    /// but keys arrive as AnyHashable and values can include NSNull.
    private func propertyListSafe(_ value: Any) -> Any? {
        switch value {
        case let dict as [AnyHashable: Any]:
            var out: [String: Any] = [:]
            for (key, raw) in dict {
                guard let key = key as? String, let safe = propertyListSafe(raw) else { continue }
                out[key] = safe
            }
            return out
        case let array as [Any]:
            return array.compactMap { propertyListSafe($0) }
        case is String, is NSNumber, is Date, is Data:
            return value
        default:
            return nil
        }
    }

    override func serviceExtensionTimeWillExpire() {
        log("serviceExtensionTimeWillExpire called; cancelling in-flight work")
        if sosAudioFinish != nil {
            log("SOS extension audio interrupted by NSE expiry; delivering now")
            completeSosExtensionAudioPlayback()
        } else {
            cancelSosExtensionAudio()
        }
        downloadTask?.cancel()
        if contentHandler != nil {
            deliverBestAttemptContent(reason: "extension-timeout")
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard player === sosAudioPlayer else { return }
        log("SOS extension audio finished successfully=\(flag)")
        completeSosExtensionAudioPlayback()
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        guard player === sosAudioPlayer else { return }
        log("SOS extension audio decode error=\(error?.localizedDescription ?? "unknown")")
        completeSosExtensionAudioPlayback()
    }

    /// Delivers mutated content at most once. Calling `contentHandler` twice is undefined
    /// and can drop the NSE sound/category overrides on the first killed-state alert.
    private func deliverBestAttemptContent(reason: String) {
        guard let contentHandler, let bestAttemptContent else {
            log("deliver skipped (\(reason)): already delivered or missing content")
            return
        }

        let soundState = bestAttemptContent.sound == nil ? "nil" : "non-nil"
        log(
            "Delivering notification (\(reason)) category=\(bestAttemptContent.categoryIdentifier) thread=\(bestAttemptContent.threadIdentifier) content.sound=\(soundState)"
        )

        self.contentHandler = nil
        self.bestAttemptContent = nil
        contentHandler(bestAttemptContent)
        log("Delivered notification content (\(reason))")
    }

    // MARK: - Shared handoff (App Group)
    /// NSE may write only keys the main app must share: tray grouping and SOS.
    /// Chat cache, shadows, and activity snapshots stay in process-local MMKV.
    private func persistTrayHandoff(
        for request: UNNotificationRequest,
        completion: @escaping () -> Void
    ) {
        cacheQueue.async { [weak self] in
            guard let self else {
                completion()
                return
            }
            defer { completion() }

            guard self.isMMKVAvailable() else {
                self.log("Tray handoff: MMKV app group is unavailable")
                return
            }

            // Reuse the signed-out-aware owner gate used by SOS persistence.
            // Cached IDs can survive logout and must never receive a post-logout
            // notification handoff.
            guard let effectiveUserId = self.currentSharedUserId() else {
                self.log("Tray handoff: no user id; skipping")
                return
            }

            self.appendMessageToNotificationV3Group(for: request, userId: effectiveUserId)
        }
    }

    private func getCertificateIdentity() -> SecIdentity? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassIdentity,
            kSecAttrLabel as String: Constants.identityTag,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnRef as String: true
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let item else {
            log("Image download: failed to fetch identity from keychain (status \(status))")
            lotusReportFailure("Keychain lookup failed with status \(status)", context: "getCertificateIdentity")
            return nil
        }
        guard CFGetTypeID(item) == SecIdentityGetTypeID() else {
            log("Image download: keychain item for identity tag was not a SecIdentity")
            lotusReportFailure("Keychain item was not a SecIdentity", context: "getCertificateIdentity")
            return nil
        }

        return (item as! SecIdentity)
    }

    private func getSharedAuthToken() -> String? {
        // Logout records a shared tombstone before native Keychain cleanup.
        // Honor it here so an interrupted/failed deletion cannot authorize
        // background work with the previous session.
        guard NotificationCacheGetString(
            Constants.appGroupId,
            Constants.mmkvId,
            Constants.authTokenSignedOutHandoffKey
        ) != Constants.authTokenSignedOutState else {
            return nil
        }

        // The bearer is shared with the extension through the provisioned
        // Keychain access group. Never read it from App Group MMKV: that store
        // is shared plaintext application data and survives independently of
        // the main-app logout lifecycle.
        return SharedAuthTokenKeychain.read()
    }

    private func isMMKVAvailable() -> Bool {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Constants.appGroupId) != nil
    }

    /// Extracts messageId from notification payload (matches TypeScript extractMessageIdFromFcmData)
    private func extractMessageId(from request: UNNotificationRequest) -> String? {
        let userInfo = request.content.userInfo
        log("ExtractMessageId: userInfo keys = \(Array(userInfo.keys).map { String(describing: $0) }.sorted())")

        // Check notification type first (skip call-related notifications)
        if let type = userInfo["type"] as? String {
            log("ExtractMessageId: found type = \(type)")
            if Constants.ignoredNotificationTypes.contains(type) {
                log("Skipping message id extraction for call notification type: \(type)")
                return nil
            }
        }

        // Priority 1: Parse metadata JSON for messageId
        let metadata = extractMetadata(from: userInfo)
        if let messageId = stringValue(metadata["messageId"]) {
            log("ExtractMessageId: found messageId in metadata = \(messageId)")
            return messageId
        }

        // Priority 2: Direct messageId field
        if let direct = userInfo["messageId"] as? String, !direct.isEmpty {
            log("ExtractMessageId: found direct messageId = \(direct)")
            return direct
        }
        if let fcmMsgId = userInfo["gcm.message_id"] as? String {
            log("ExtractMessageId: found gcm.message_id = \(fcmMsgId)")
        }

        log("ExtractMessageId: no messageId found")
        return nil
    }

    private func extractNotificationMessage(from request: UNNotificationRequest) -> String? {
        let userInfo = request.content.userInfo
        let metadata = extractMetadata(from: userInfo)

        let candidates: [String?] = [
            stringValue(metadata["message"]),
            stringValue(metadata["messageText"]),
            stringValue(metadata["body"]),
            stringValue(metadata["text"]),
            stringValue(metadata["content"]),
            stringValue(userInfo["message"]),
            stringValue(userInfo["messageText"]),
            stringValue(userInfo["msg_body"]),
            stringValue(userInfo["body"]),
            stringValue(userInfo["text"]),
            stringValue(userInfo["content"]),
            extractApsAlertBody(from: userInfo),
            request.content.body,
            request.content.subtitle,
            request.content.title
        ]

        return firstNonEmpty(candidates)
    }

    /// Matches backend `getApnsThreadId` + JS `parseMessageNotification.notificationId`.
    private func extractNotificationGroupId(from request: UNNotificationRequest) -> String? {
        if isSosAlert(userInfo: request.content.userInfo),
           let notificationId = sosNotificationId(from: request.content.userInfo) {
            return notificationId
        }

        if shouldUseThreadMessageOnlyPrefetch(for: request),
           let conversationId = extractConversationId(from: request) {
            return conversationId
        }

        if let channelId = extractChannelId(from: request) {
            return channelId
        }

        // Legacy nested FCM payload shape (webview app).
        let userInfo = request.content.userInfo
        if let data = userInfo["data"] as? [String: Any] {
            let type = stringValue(data["type"])?.uppercased()
            let metadata = extractMetadata(from: data)
            let isThread = type == "THREAD_REPLY" || type == "THREAD_READ"
            if isThread {
                return stringValue(metadata["conversationId"])
            }
            return stringValue(metadata["channelId"]) ?? stringValue(data["channelId"])
        }

        let existingThreadId = request.content.threadIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
        return existingThreadId.isEmpty ? nil : existingThreadId
    }

    private func shouldAttachMessageCategory(for request: UNNotificationRequest) -> Bool {
        let userInfo = request.content.userInfo
        let metadata = extractMetadata(from: userInfo)

        let type = firstNonEmpty([
            stringValue(userInfo["type"]),
            stringValue(metadata["type"])
        ])?.uppercased() ?? ""

        if Constants.ignoredNotificationTypes.contains(type) {
            return false
        }

        return Constants.messageNotificationTypes.contains(type)
    }

    private func extractChannelId(from request: UNNotificationRequest) -> String? {
        let userInfo = request.content.userInfo
        let metadata = extractMetadata(from: userInfo)

        return firstNonEmpty([
            stringValue(metadata["channelId"]),
            stringValue(metadata["relatedEntityId"]),
            stringValue(metadata["chatId"]),
            stringValue(userInfo["channelId"]),
            stringValue(userInfo["relatedEntityId"]),
            stringValue(userInfo["chatId"])
        ])
    }

    private func extractConversationId(from request: UNNotificationRequest) -> String? {
        let userInfo = request.content.userInfo
        let metadata = extractMetadata(from: userInfo)

        return firstNonEmpty([
            stringValue(metadata["conversationId"]),
            stringValue(metadata["threadId"]),
            stringValue(userInfo["conversationId"]),
            stringValue(userInfo["threadId"])
        ])
    }

    private func shouldUseThreadMessageOnlyPrefetch(for request: UNNotificationRequest) -> Bool {
        let userInfo = request.content.userInfo
        let metadata = extractMetadata(from: userInfo)

        let messageType = firstNonEmpty([
            stringValue(metadata["messageType"]),
            stringValue(userInfo["messageType"])
        ])?.lowercased()

        let category = firstNonEmpty([
            stringValue(userInfo["category"]),
            stringValue(metadata["category"])
        ])?.uppercased()

        let type = firstNonEmpty([
            stringValue(userInfo["type"]),
            stringValue(metadata["type"])
        ])?.uppercased()

        let isThreadReply =
            messageType == "thread_reply" ||
            category == "THREAD_REPLY" ||
            type == "THREAD_REPLY"
        let isMention = category == "MENTION" || type == "MENTION"

        return isThreadReply || isMention
    }

    private func extractCreatedBy(from request: UNNotificationRequest) -> String? {
        let userInfo = request.content.userInfo
        let metadata = extractMetadata(from: userInfo)

        return firstNonEmpty([
            stringValue(metadata["createdBy"]),
            stringValue(metadata["senderId"]),
            stringValue(metadata["userId"]),
            stringValue(userInfo["createdBy"]),
            stringValue(userInfo["senderId"]),
            stringValue(userInfo["userId"])
        ])
    }

    /// Prepend sender for non-DM channel notifications (matches backend desktop + JS display).
    private func applySenderPrefix(to content: UNMutableNotificationContent, userInfo: [AnyHashable: Any]) {
        guard let body = stringValue(content.body), !body.isEmpty else { return }

        let metadata = extractMetadata(from: userInfo)
        guard
            let senderName = stringValue(metadata["senderName"]),
            stringValue(metadata["scopeType"]) != "DM"
        else { return }

        let prefix = "\(senderName): "
        guard !body.hasPrefix(prefix) else { return }

        content.body = prefix + body
    }

    private func applyUserSelectedSound(to content: UNMutableNotificationContent) {
        let soundId = readUserSelectedSoundId()

        switch soundId {
        case "none":
            content.sound = nil
        case "default":
            content.sound = .default
        default:
            content.sound = UNNotificationSound(
                named: UNNotificationSoundName(rawValue: "\(soundId).caf")
            )
        }
        log("Applied user-selected sound=\(soundId)")
    }

    private func isSosAlert(userInfo: [AnyHashable: Any]) -> Bool {
        let payload = flattenedUserInfo(userInfo)
        let metadata = extractMetadata(from: payload)
        let notificationType = firstNonEmpty([
            stringValue(payload["notificationType"]),
            stringValue(metadata["notificationType"])
        ])
        let matched = notificationType == Constants.sosNotificationType
        log(
            "SOS detect type=\(notificationType ?? "nil") matched=\(matched)"
        )
        return matched
    }

    private func sosNotificationId(from userInfo: [AnyHashable: Any]) -> String? {
        let payload = flattenedUserInfo(userInfo)
        let metadata = extractMetadata(from: payload)
        return firstNonEmpty([
            stringValue(payload["notificationId"]),
            stringValue(metadata["notificationId"])
        ])
    }

    private func applySosPresentation(to content: UNMutableNotificationContent) {
        // Keep content.sound set (same as chat bell/string) AND patch aps.sound so
        // iOS owns both reliable banner delivery and background sound playback.
        logSosSoundAvailability()
        let sharedSoundReady = ensureSosSoundInSharedLibrary()
        log("SOS shared Library/Sounds ready=\(sharedSoundReady)")
        patchApsSound(in: content, soundName: Constants.sosSoundFileName)
        content.sound = UNNotificationSound(
            named: UNNotificationSoundName(rawValue: Constants.sosSoundFileName)
        )
        log("Applied SOS content.sound=\(Constants.sosSoundFileName) + patched aps.sound")
    }

    /// iOS can resolve custom notification sounds from the host app's Library/Sounds.
    private func ensureSosSoundInSharedLibrary() -> Bool {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: Constants.appGroupId
        ) else {
            log("SOS shared sounds skipped: app group container unavailable")
            return false
        }

        let soundsDir = container.appendingPathComponent("Library/Sounds", isDirectory: true)
        let dest = soundsDir.appendingPathComponent(Constants.sosSoundFileName)

        if FileManager.default.fileExists(atPath: dest.path) {
            return true
        }

        guard let src = resolveSosSoundURL() else {
            log("SOS shared sounds skipped: source \(Constants.sosSoundFileName) missing")
            return false
        }

        do {
            try FileManager.default.createDirectory(at: soundsDir, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: src, to: dest)
            log("SOS copied \(Constants.sosSoundFileName) to shared Library/Sounds")
            return true
        } catch {
            log("SOS shared sounds copy failed: \(error.localizedDescription)")
            return false
        }
    }

    private func patchApsSound(in content: UNMutableNotificationContent, soundName: String) {
        var userInfo = content.userInfo
        var aps = userInfo[AnyHashable("aps")] as? [AnyHashable: Any] ?? [:]
        let before = String(describing: aps[AnyHashable("sound")] ?? "nil")
        aps[AnyHashable("sound")] = soundName
        userInfo[AnyHashable("aps")] = aps
        content.userInfo = userInfo
        log("Patched aps.sound \(before) -> \(soundName)")
    }

    private func logIncomingNotificationSoundDiagnostics(
        request: UNNotificationRequest,
        content: UNMutableNotificationContent? = nil,
        label: String
    ) {
        let userInfo = content?.userInfo ?? request.content.userInfo
        var apsSound = "missing-aps"
        if let aps = userInfo[AnyHashable("aps")] as? [AnyHashable: Any] {
            apsSound = String(describing: aps[AnyHashable("sound")] ?? "nil")
        }
        let incomingContentSound = request.content.sound == nil ? "nil" : "non-nil"
        let outgoingContentSound = content?.sound == nil ? "nil" : "non-nil"
        log(
            "SOS sound diag [\(label)] requestId=\(request.identifier) aps.sound=\(apsSound) incoming.content.sound=\(incomingContentSound) outgoing.content.sound=\(outgoingContentSound)"
        )
    }

    /// Play faaah.caf inside the NSE process, then deliver the notification.
    /// AVAudioSession activation fails in NSE ("Session activation failed"), so we
    /// use AudioServicesPlayAlertSound first (no session, plays in silent mode).
    private func playSosSirenInExtensionThenDeliver(reason: String) {
        guard let url = resolveSosSoundURL() else {
            log("SOS extension audio skipped: \(Constants.sosSoundFileName) not found in host or extension bundle")
            deliverBestAttemptContent(reason: "\(reason)-no-audio-file")
            return
        }

        logSosSoundFileDetails(url)

        sosAudioFinish = { [weak self] in
            self?.deliverBestAttemptContent(reason: reason)
        }

        if playSosViaAudioServices(url: url) {
            return
        }

        if playSosViaAVAudioPlayerNoSession(url: url) {
            return
        }

        log("SOS extension audio: all playback paths failed")
        cancelSosExtensionAudio()
        deliverBestAttemptContent(reason: "\(reason)-audio-error")
    }

    private func logSosSoundFileDetails(_ url: URL) {
        let fileSize: UInt64
        if let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
           let size = attrs[.size] as? UInt64 {
            fileSize = size
        } else {
            fileSize = 0
        }
        log("SOS extension audio resolved url=\(url.path) bytes=\(fileSize)")
    }

    /// Primary path: AudioToolbox alert sound — no AVAudioSession, bypasses silent switch.
    private func playSosViaAudioServices(url: URL) -> Bool {
        var soundID: SystemSoundID = 0
        let status = AudioServicesCreateSystemSoundID(url as CFURL, &soundID)
        guard status == kAudioServicesNoError, soundID != 0 else {
            log("SOS AudioServices create failed status=\(status)")
            return false
        }

        sosSystemSoundID = soundID
        sosAlertSoundLoopsRemaining = sosAlertSoundLoopCount
        log(
            "SOS AudioServices playAlertSound starting loops=\(sosAlertSoundLoopCount) soundID=\(soundID)"
        )

        scheduleSosExtensionAudioTimeout(seconds: 8.0)
        playNextSosAlertSoundLoop()
        return true
    }

    private func playNextSosAlertSoundLoop() {
        guard sosSystemSoundID != 0, sosAlertSoundLoopsRemaining > 0 else {
            completeSosExtensionAudioPlayback()
            return
        }

        let soundID = sosSystemSoundID
        sosAlertSoundLoopsRemaining -= 1
        let loopIndex = sosAlertSoundLoopCount - sosAlertSoundLoopsRemaining

        AudioServicesPlayAlertSoundWithCompletion(soundID) { [weak self] in
            guard let self else { return }
            self.log(
                "SOS AudioServices loop finished index=\(loopIndex) remaining=\(self.sosAlertSoundLoopsRemaining)"
            )
            if self.sosAlertSoundLoopsRemaining > 0 {
                self.playNextSosAlertSoundLoop()
            } else {
                self.completeSosExtensionAudioPlayback()
            }
        }
    }

    /// Fallback when AudioServices cannot load the file — skip session activation entirely.
    private func playSosViaAVAudioPlayerNoSession(url: URL) -> Bool {
        do {
            log("SOS AVAudioPlayer fallback (no AVAudioSession activation)")
            let player = try AVAudioPlayer(contentsOf: url)
            player.delegate = self
            player.numberOfLoops = 2
            player.volume = 1.0
            player.prepareToPlay()

            sosAudioPlayer = player

            let started = player.play()
            log(
                "SOS AVAudioPlayer play started=\(started) duration=\(String(format: "%.2f", player.duration))s"
            )
            guard started else { return false }

            let loopCount = player.numberOfLoops + 1
            let timeoutSeconds = min(max(player.duration * Double(loopCount) + 0.5, 1.0), 8.0)
            scheduleSosExtensionAudioTimeout(seconds: timeoutSeconds)
            return true
        } catch {
            log("SOS AVAudioPlayer fallback failed: \(error.localizedDescription)")
            return false
        }
    }

    private func scheduleSosExtensionAudioTimeout(seconds: Double) {
        sosAudioTimeoutWorkItem?.cancel()
        let timeout = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.log("SOS extension audio timeout after \(String(format: "%.2f", seconds))s")
            self.completeSosExtensionAudioPlayback()
        }
        sosAudioTimeoutWorkItem = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: timeout)
    }

    private func completeSosExtensionAudioPlayback() {
        guard let finish = sosAudioFinish else { return }
        sosAudioFinish = nil
        sosAudioTimeoutWorkItem?.cancel()
        sosAudioTimeoutWorkItem = nil
        sosAudioPlayer?.stop()
        sosAudioPlayer = nil
        if sosSystemSoundID != 0 {
            AudioServicesDisposeSystemSoundID(sosSystemSoundID)
            sosSystemSoundID = 0
        }
        sosAlertSoundLoopsRemaining = 0
        finish()
    }

    private func cancelSosExtensionAudio() {
        sosAudioFinish = nil
        sosAudioTimeoutWorkItem?.cancel()
        sosAudioTimeoutWorkItem = nil
        sosAudioPlayer?.stop()
        sosAudioPlayer = nil
        if sosSystemSoundID != 0 {
            AudioServicesDisposeSystemSoundID(sosSystemSoundID)
            sosSystemSoundID = 0
        }
        sosAlertSoundLoopsRemaining = 0
    }

    private func resolveSosSoundURL() -> URL? {
        if let host = hostAppBundle()?.url(forResource: Constants.sosSoundName, withExtension: "caf") {
            return host
        }
        if let local = Bundle.main.url(forResource: Constants.sosSoundName, withExtension: "caf") {
            return local
        }
        return nil
    }

    /// Debug helper: log where iOS can resolve the SOS notification sound from.
    private func logSosSoundAvailability() {
        let hostHasSound = hostAppBundle()?.url(forResource: Constants.sosSoundName, withExtension: "caf") != nil
        let extHasSound = Bundle.main.url(forResource: Constants.sosSoundName, withExtension: "caf") != nil
        log("SOS sound availability hostBundle=\(hostHasSound) extensionBundle=\(extHasSound)")
    }

    /// Host app bundle (`XyneSpaces.app`) from the NSE extension process.
    private func hostAppBundle() -> Bundle? {
        var url = Bundle.main.bundleURL
        url.deleteLastPathComponent() // PlugIns
        url.deleteLastPathComponent() // .app
        return Bundle(url: url)
    }

    private func sortedUserInfoKeys(_ userInfo: [AnyHashable: Any]) -> String {
        userInfo.keys
            .map { String(describing: $0) }
            .sorted()
            .joined(separator: ",")
    }

    private func persistSosAlertForAppLaunch(
        from request: UNNotificationRequest,
        ownerUserId: String?
    ) {
        let payload = flattenedUserInfo(request.content.userInfo)
        let metadata = extractMetadata(from: payload)

        guard let notificationId = firstNonEmpty([
            stringValue(payload["notificationId"]),
            stringValue(metadata["notificationId"])
        ]) else {
            log("SOS persist skipped: no notificationId")
            return
        }

        let actionUrl = firstNonEmpty([
            stringValue(payload["actionUrl"]),
            stringValue(payload["deeplink"]),
            stringValue(metadata["actionUrl"])
        ])

        let workspaceId = firstNonEmpty([
            stringValue(payload["workspaceId"]),
            stringValue(metadata["workspaceId"]),
            extractWorkspaceId(fromActionUrl: actionUrl)
        ])

        var alert: [String: Any] = [
            "id": notificationId,
            "title": firstNonEmpty([
                stringValue(payload["msg_title"]),
                stringValue(payload["title"]),
                stringValue(request.content.title)
            ]) ?? "SOS alert",
            "body": firstNonEmpty([
                stringValue(payload["msg_body"]),
                stringValue(payload["message"]),
                stringValue(payload["body"]),
                stringValue(request.content.body)
            ]) ?? "",
            "receivedAt": Int64(Date().timeIntervalSince1970 * 1000),
            "rawData": stringMap(from: payload)
        ]

        if let actionUrl {
            alert["actionUrl"] = actionUrl
        }
        if let workspaceId {
            alert["workspaceId"] = workspaceId
        }

        guard let ownerUserId else {
            // Never write an ownerless alert. A pending bucket can be promoted
            // to a different account after logout, so discard legacy state.
            _ = NotificationCacheDeleteKey(
                Constants.appGroupId,
                Constants.mmkvId,
                Constants.sosPendingStorageKey
            )
            log("SOS persist skipped: no authenticated user")
            return
        }
        alert["ownerUserId"] = ownerUserId
        let key = "\(Constants.sosAlertsStorageKeyPrefix):\(ownerUserId)"

        var alerts = readPersistedSosAlerts(forKey: key)
        if alerts.contains(where: { stringValue($0["id"]) == notificationId }) {
            log("SOS persist skipped: already stored id=\(notificationId)")
            return
        }

        alerts.append(alert)
        if alerts.count > Constants.maxStoredSosAlerts {
            alerts.removeFirst(alerts.count - Constants.maxStoredSosAlerts)
        }

        guard JSONSerialization.isValidJSONObject(alerts),
              let data = try? JSONSerialization.data(withJSONObject: alerts),
              let json = String(data: data, encoding: .utf8)
        else {
            log("SOS persist failed: invalid JSON id=\(notificationId)")
            return
        }

        guard currentSharedUserId() == ownerUserId else {
            log("SOS persist skipped: owner changed before write id=\(notificationId)")
            return
        }
        let ok = NotificationCacheSetString(Constants.appGroupId, Constants.mmkvId, key, json)
        log("SOS persisted id=\(notificationId) key=\(key) ok=\(ok)")
    }

    private func currentSharedUserId() -> String? {
        guard
            NotificationCacheGetString(
                Constants.appGroupId,
                Constants.mmkvId,
                Constants.authTokenSignedOutHandoffKey
            ) != Constants.authTokenSignedOutState
        else {
            return nil
        }

        return firstNonEmpty([
            NotificationCacheGetString(
                Constants.appGroupId,
                Constants.mmkvId,
                Constants.lotusUserIdKey
            ),
            NotificationCacheGetString(
                Constants.appGroupId,
                Constants.mmkvId,
                Constants.globalUserIdKey
            )
        ])
    }

    private func applySosOwnerMetadata(to content: UNMutableNotificationContent, userId: String?) {
        guard let userId else { return }
        var userInfo = content.userInfo
        userInfo[AnyHashable("ownerUserId")] = userId
        content.userInfo = userInfo
    }

    private func readPersistedSosAlerts(forKey key: String) -> [[String: Any]] {
        guard
            let raw = NotificationCacheGetString(Constants.appGroupId, Constants.mmkvId, key),
            let data = raw.data(using: .utf8),
            let parsed = try? JSONSerialization.jsonObject(with: data),
            let alerts = parsed as? [[String: Any]]
        else {
            return []
        }

        return alerts
    }

    private func readUserSelectedSoundId() -> String {
        let directSoundId = normalizeNotificationSoundId(
            NotificationCacheGetString(
                Constants.appGroupId,
                Constants.mmkvId,
                Constants.notificationSoundKey
            )
        )

        let settingsSoundId = readSettingsSoundId()

        // Protect against startup hydration clobbering the direct NSE key back to
        // default while the persisted settings snapshot still has the user's custom choice.
        if directSoundId == "default",
           let settingsSoundId,
           settingsSoundId != "default" {
            log("Using settings snapshot sound=\(settingsSoundId) because direct key was default")
            return settingsSoundId
        }

        return directSoundId
    }

    private func readSettingsSoundId() -> String? {
        guard
            let rawSettings = NotificationCacheGetString(
                Constants.appGroupId,
                Constants.mmkvId,
                Constants.settingsStorageKey
            ),
            let data = rawSettings.data(using: .utf8),
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let settings = root["settings"] as? [String: Any],
            let notifications = settings["notifications"] as? [String: Any]
        else {
            return nil
        }

        return normalizeNotificationSoundId(stringValue(notifications["soundId"]))
    }

    private func normalizeNotificationSoundId(_ value: String?) -> String {
        // App default is String (not the device default). Keep explicit "default"
        // for users who chose the device sound in Settings.
        guard let value else { return "string" }

        switch value {
        case "bell", "string", "none", "default":
            return value
        default:
            return "string"
        }
    }

    private func extractMetadata(from userInfo: [AnyHashable: Any]) -> [String: Any] {
        if let rawMeta = userInfo["metadata"] as? String {
            if let metaData = rawMeta.data(using: .utf8),
               let meta = try? JSONSerialization.jsonObject(with: metaData) as? [String: Any] {
                return meta
            }
            log("Metadata extraction: failed to parse metadata JSON")
        }

        if let meta = userInfo["metadata"] as? [String: Any] {
            return meta
        }

        return [:]
    }

    private func flattenedUserInfo(_ userInfo: [AnyHashable: Any]) -> [String: Any] {
        var payload: [String: Any] = [:]
        for (key, value) in userInfo {
            payload[String(describing: key)] = value
        }
        return flattenedPayload(payload)
    }

    private func flattenedPayload(_ payload: [String: Any]) -> [String: Any] {
        var flattened: [String: Any] = [:]

        if let nested = payload["data"] as? [String: Any] {
            flattened.merge(flattenedPayload(nested)) { _, topLevel in topLevel }
        } else if let rawData = payload["data"] as? String,
                  let data = rawData.data(using: .utf8),
                  let nested = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            flattened.merge(flattenedPayload(nested)) { _, topLevel in topLevel }
        }

        flattened.merge(payload) { _, topLevel in topLevel }
        return flattened
    }

    private func stringMap(from payload: [String: Any]) -> [String: String] {
        var result: [String: String] = [:]

        for (key, value) in payload {
            if let value = stringValue(value) {
                result[key] = value
                continue
            }

            if JSONSerialization.isValidJSONObject(value),
               let data = try? JSONSerialization.data(withJSONObject: value),
               let json = String(data: data, encoding: .utf8) {
                result[key] = json
            }
        }

        return result
    }

    private func extractWorkspaceId(fromActionUrl actionUrl: String?) -> String? {
        guard let actionUrl, actionUrl.hasPrefix("/") else { return nil }
        let first = actionUrl
            .split(separator: "/")
            .map(String.init)
            .first

        if first == "chat" || first == "tickets" || first == "support" {
            return nil
        }
        return first
    }

    private func extractApsAlertBody(from userInfo: [AnyHashable: Any]) -> String? {
        guard let aps = userInfo["aps"] as? [String: Any] else { return nil }

        if let alert = aps["alert"] as? String {
            return alert
        }

        if let alert = aps["alert"] as? [String: Any] {
            return stringValue(alert["body"])
        }

        return nil
    }

    private func stringValue(_ value: Any?) -> String? {
        guard let value else { return nil }

        if let string = value as? String {
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }

        if let number = value as? NSNumber {
            return number.stringValue
        }

        return nil
    }

    private func firstNonEmpty(_ values: [String?]) -> String? {
        values.compactMap { value in
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed?.isEmpty == false ? trimmed : nil
        }.first
    }

    // MARK: - Image Attachment Handling
    private func handleImageAttachment(
        for request: UNNotificationRequest,
        completion: @escaping () -> Void
    ) {
        guard let imageURL = extractImageURL(from: request) else {
            log("No image URL found in payload; skipping attachment")
            completion()
            return
        }

        log("Resolved image URL: \(imageURL.absoluteString)")

        let useMtls = shouldUseMtlsDownload(for: imageURL)
        let fileExtension = imageURL.pathExtension.isEmpty ? "jpg" : imageURL.pathExtension

        downloadImage(from: imageURL, useMtls: useMtls) { [weak self] data in
            defer { completion() }

            guard let self, let bestAttemptContent = self.bestAttemptContent else {
                lotusSecureNativeLog("Extension released before download completion")
                return
            }

            guard
                let data,
                let attachment = self.makeAttachment(
                    from: data,
                    preferredName: "sender-avatar",
                    fileExtension: fileExtension
                )
            else {
                self.log("Failed to create image attachment from downloaded data")
                return
            }

            bestAttemptContent.attachments = [attachment]
            self.log("Image attachment created: \(attachment.identifier)")
        }
    }

    private func downloadImage(
        from url: URL,
        useMtls: Bool,
        completion: @escaping (Data?) -> Void
    ) {
        if useMtls {
            downloadImageWithMtls(from: url, completion: completion)
            return
        }

        log("Starting public image download")
        downloadTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
            if let error {
                self?.log("Image download failed: \(error.localizedDescription)")
                lotusReportError(error, context: "downloadImage public")
                completion(nil)
                return
            }
            completion(data)
        }
        downloadTask?.resume()
    }

    private func downloadImageWithMtls(
        from url: URL,
        completion: @escaping (Data?) -> Void
    ) {
        guard let identity = getCertificateIdentity() else {
            log("Image download: no client certificate identity; skipping")
            lotusReportFailure("No client certificate identity", context: "downloadImageWithMtls")
            completion(nil)
            return
        }

        var certificateRef: SecCertificate?
        let certStatus = SecIdentityCopyCertificate(identity, &certificateRef)
        guard certStatus == errSecSuccess, let certificate = certificateRef else {
            log("Image download: failed to read client certificate (status \(certStatus))")
            lotusReportFailure("Failed to read client certificate (status \(certStatus))", context: "downloadImageWithMtls")
            completion(nil)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let token = getSharedAuthToken(), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 12

        let delegate = MtlsNotificationSessionDelegate(
            identity: identity,
            certificate: certificate
        )
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)

        log("Starting mTLS image download")
        session.dataTask(with: request) { [weak self] data, response, error in
            defer { session.finishTasksAndInvalidate() }

            if let error {
                self?.log("mTLS image download failed: \(error.localizedDescription)")
                lotusReportError(error, context: "downloadImageWithMtls network")
                completion(nil)
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                self?.log("mTLS image download returned non-HTTP response")
                lotusReportFailure("Non-HTTP response", context: "downloadImageWithMtls")
                completion(nil)
                return
            }

            guard (200..<300).contains(httpResponse.statusCode), let data, !data.isEmpty else {
                self?.log("mTLS image download failed with status \(httpResponse.statusCode)")
                lotusReportFailure("HTTP \(httpResponse.statusCode)", context: "downloadImageWithMtls")
                completion(nil)
                return
            }

            completion(data)
        }.resume()
    }

    private func shouldUseMtlsDownload(for url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        return host.contains("spaces.xyne") || host.contains("juspay.net")
    }

    private func resolveSenderPictureURL(from request: UNNotificationRequest) -> URL? {
        let userInfo = request.content.userInfo
        let metadata = extractMetadata(from: userInfo)

        guard
            let picturePath = firstNonEmpty([
                stringValue(metadata["senderPicture"]),
                stringValue(userInfo["senderPicture"])
            ])
        else {
            return nil
        }

        if picturePath.lowercased().hasPrefix("http://") || picturePath.lowercased().hasPrefix("https://") {
            return URL(string: picturePath)
        }

        let senderId = firstNonEmpty([
            stringValue(metadata["senderId"]),
            stringValue(userInfo["senderId"])
        ])
        guard let senderId else {
            log("senderPicture present but senderId missing; cannot resolve avatar URL")
            return nil
        }

        guard
            let encoded = picturePath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
        else {
            return nil
        }

        return URL(string: "\(Constants.apiBaseURL)/users/\(senderId)/picture?v=\(encoded)")
    }

    private func extractImageURL(from request: UNNotificationRequest) -> URL? {
        if let senderPictureURL = resolveSenderPictureURL(from: request) {
            log("Resolved senderPicture avatar URL")
            return senderPictureURL
        }

        let userInfo = request.content.userInfo
        var candidates: [String?] = [
            userInfo["image"] as? String,
            userInfo["imageUrl"] as? String,
            userInfo["imageURL"] as? String,
            userInfo["mediaUrl"] as? String,
            userInfo["gcm.notification.image"] as? String
        ]

        if let fcmOptions = userInfo["fcm_options"] as? [String: Any] {
            candidates.append(fcmOptions["image"] as? String)
        }

        if let notification = userInfo["notification"] as? [String: Any] {
            if let android = notification["android"] as? [String: Any] {
                candidates.append(android["imageUrl"] as? String)
            }
            if let ios = notification["ios"] as? [String: Any] {
                candidates.append(ios["imageUrl"] as? String)
            }
        }

        guard
            let urlString = candidates.compactMap({ $0?.trimmingCharacters(in: .whitespacesAndNewlines) })
                .first(where: { !$0.isEmpty }),
            let url = URL(string: urlString),
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            log("Image URL extraction failed; candidate keys present=\(candidates.compactMap { $0 }.count)")
            return nil
        }

        if components.scheme == nil {
            components.scheme = "https"
            log("Image URL had no scheme; defaulted to https")
        }

        return components.url
    }

    private func makeAttachment(
        from data: Data,
        preferredName: String?,
        fileExtension: String?
    ) -> UNNotificationAttachment? {
        let temporaryDirectory = URL(fileURLWithPath: NSTemporaryDirectory())
        let baseName = preferredName?.isEmpty == false ? preferredName! : UUID().uuidString
        let candidateExtension = (fileExtension?.isEmpty == false ? fileExtension : nil) ?? "tmp"
        let fileURL = temporaryDirectory
            .appendingPathComponent(UUID().uuidString + "-" + baseName)
            .appendingPathExtension(candidateExtension)

        do {
            try data.write(to: fileURL)
            return try UNNotificationAttachment(identifier: fileURL.lastPathComponent, url: fileURL)
        } catch {
            log("Attachment write/create failed: \(error.localizedDescription)")
            lotusReportError(error, context: "makeAttachment")
            return nil
        }
    }

    private func log(_ message: String) {
        nseLogger.notice("\(self.logPrefix, privacy: .public) \(message, privacy: .private)")
    }

    // MARK: - Delivery observability (matches JS emitNotificationDelivery)

    /// POSTs delivery logs to `/godel/events` and OTLP counters to `/godel/v1/metrics`.
    /// Waits so a killed-state wake still flushes before iOS suspends us.
    private func postNotificationDeliveryLogsAndWait(for request: UNNotificationRequest) {
        let semaphore = DispatchSemaphore(value: 0)
        sendNotificationDeliveryLogs(for: request) { [weak self] in
            self?.log("Observability POST finished")
            semaphore.signal()
        }
        let timeout = DispatchTime.now() + Constants.observabilityPostTimeoutSeconds + 1
        if semaphore.wait(timeout: timeout) == .timedOut {
            log("Observability POST timed out after \(Int(Constants.observabilityPostTimeoutSeconds))s")
        }
    }

    private func sendNotificationDeliveryLogs(
        for request: UNNotificationRequest,
        completion: @escaping () -> Void
    ) {
        guard lotusRemoteLoggingEnabled() else {
            completion()
            return
        }

        let payload = flattenedUserInfo(request.content.userInfo)
        let metadata = extractMetadata(from: payload)
        let category = classifyDeliveryCategory(payload: payload, metadata: metadata)
        let records = buildNotificationDeliveryLogRecords(
            for: request,
            payload: payload,
            metadata: metadata,
            category: category
        )
        let metricsBody = buildNotificationDeliveryMetricsPayload(category: category)

        let group = DispatchGroup()

        group.enter()
        postObservabilityJSON(
            body: records,
            url: godelEventsURL(),
            label: "logs"
        ) {
            group.leave()
        }

        group.enter()
        postObservabilityJSON(
            body: metricsBody,
            url: godelMetricsURL(),
            label: "metrics"
        ) {
            group.leave()
        }

        group.notify(queue: .global()) {
            completion()
        }
    }

    private func postObservabilityJSON(
        body: Any,
        url: URL?,
        label: String,
        completion: @escaping () -> Void
    ) {
        guard
            let url,
            JSONSerialization.isValidJSONObject(body),
            let data = try? JSONSerialization.data(withJSONObject: body)
        else {
            log("Observability \(label) POST skipped: could not build payload")
            completion()
            return
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.timeoutInterval = Constants.observabilityPostTimeoutSeconds
        urlRequest.httpBody = data

        log("Observability \(label) POST to \(url.absoluteString) bytes=\(data.count)")
        URLSession.shared.dataTask(with: urlRequest) { [weak self] body, response, error in
            if let error {
                self?.log("Observability \(label) POST failed: \(error.localizedDescription)")
            } else if let http = response as? HTTPURLResponse {
                let snippet = Self.observabilityResponseSnippet(body)
                if (200..<300).contains(http.statusCode) {
                    self?.log("Observability \(label) POST status=\(http.statusCode)")
                } else {
                    self?.log(
                        "Observability \(label) POST status=\(http.statusCode) body=\(snippet)"
                    )
                }
            } else {
                self?.log("Observability \(label) POST finished with no HTTP response")
            }
            completion()
        }.resume()
    }

    private static func observabilityResponseSnippet(_ body: Data?) -> String {
        guard let body, !body.isEmpty else {
            return "<empty>"
        }
        let raw = String(data: body, encoding: .utf8) ?? "<binary \(body.count) bytes>"
        let collapsed = raw.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        if collapsed.count <= 300 {
            return collapsed
        }
        let end = collapsed.index(collapsed.startIndex, offsetBy: 300)
        return String(collapsed[..<end]) + "…"
    }

    private func godelBaseURL() -> String {
        let bundleId = Bundle.main.bundleIdentifier ?? ""
        return bundleId.contains("sandbox")
            ? "https://spaces.sandbox.xyne.juspay.net"
            : "https://spaces.xyne.juspay.net"
    }

    private func godelEventsURL() -> URL? {
        URL(string: "\(godelBaseURL())/godel/events")
    }

    private func godelMetricsURL() -> URL? {
        URL(string: "\(godelBaseURL())/godel/v1/metrics")
    }

    private func buildNotificationDeliveryLogRecords(
        for request: UNNotificationRequest,
        payload: [String: Any],
        metadata: [String: Any],
        category: String
    ) -> [[String: Any]] {
        let notificationId = firstNonEmpty([
            stringValue(payload["notificationId"]),
            stringValue(metadata["notificationId"])
        ])
        let notificationType = firstNonEmpty([
            stringValue(payload["type"]),
            stringValue(payload["category"])
        ])
        let fcmMessageId = firstNonEmpty([
            stringValue(payload["gcm.message_id"]),
            stringValue(payload["google.message_id"]),
            stringValue(request.content.userInfo["gcm.message_id"])
        ])
        let trayNotificationId = extractNotificationGroupId(from: request) ?? notificationId
        let context = observabilityDeviceContext()

        var received: [String: Any] = context
        received["schemaVersion"] = 1
        received["timestamp"] = observabilityTimestamp()
        received["level"] = "INFO"
        received["event"] = "notification_payload_received"
        received["notificationId"] = notificationId ?? NSNull()
        received["notificationType"] = notificationType ?? NSNull()
        received["category"] = category
        received["fcmMessageId"] = fcmMessageId ?? NSNull()
        received["deliveryContext"] = "background"
        received["hasNotificationPayload"] = true
        received["fcmSentTime"] = NSNull()

        var displayed = received
        displayed["event"] = "notification_displayed"
        displayed["presentationOwner"] = "operating_system"
        displayed["trayNotificationId"] = trayNotificationId ?? NSNull()

        if category == "control" {
            var skipped = received
            skipped["event"] = "notification_display_skipped"
            skipped["reason"] = "silent_control_signal"
            return [received, skipped]
        }

        if category == "prefetch" {
            var skipped = received
            skipped["event"] = "notification_display_skipped"
            skipped["reason"] = "prefetch_only"
            return [received, skipped]
        }

        if category == "call" {
            var skipped = received
            skipped["event"] = "notification_display_skipped"
            skipped["reason"] = "native_call_pipeline"
            return [received, skipped]
        }

        if category == "unknown" {
            var skipped = received
            skipped["event"] = "notification_display_skipped"
            skipped["reason"] = "unsupported_or_invalid_payload"
            return [received, skipped]
        }

        return [received, displayed]
    }

    private func classifyDeliveryCategory(
        payload: [String: Any],
        metadata: [String: Any]
    ) -> String {
        let sosType = firstNonEmpty([
            stringValue(payload["notificationType"]),
            stringValue(payload["type"]),
            stringValue(metadata["notificationType"])
        ])
        if sosType == Constants.sosNotificationType {
            return "sos"
        }

        let type = stringValue(payload["type"]) ?? ""
        let typeOrCategory = firstNonEmpty([
            stringValue(payload["type"]),
            stringValue(payload["category"])
        ]) ?? ""
        if Constants.controlNotificationTypes.contains(type) {
            return "control"
        }
        if Constants.ignoredNotificationTypes.contains(type) {
            return "call"
        }
        if Constants.reminderNotificationTypes.contains(type) {
            return "reminder"
        }
        if stringValue(payload["prefetchOnly"]) == "1" {
            return "prefetch"
        }
        if typeOrCategory.hasPrefix("TICKET_") {
            return "ticket"
        }
        if Constants.messageNotificationTypes.contains(type) {
            return "chat"
        }
        return "unknown"
    }

    private func buildNotificationDeliveryMetricsPayload(category: String) -> [String: Any] {
        let interval = unixNanoInterval()
        var metrics: [[String: Any]] = [
            otlpSumMetric(
                name: "notification_payload_received",
                description: "FCM payloads that reached the notification pipeline",
                attributes: [
                    "delivery_context": "background",
                    "category": category
                ],
                startTimeUnixNano: interval.start,
                timeUnixNano: interval.end
            )
        ]

        switch category {
        case "chat", "sos", "reminder", "ticket":
            metrics.append(
                otlpSumMetric(
                    name: "notification_displayed",
                    description: "Payloads that resulted in a visible banner (app-drawn or OS-owned)",
                    attributes: [
                        "delivery_context": "background",
                        "category": category,
                        "presentation_owner": "operating_system"
                    ],
                    startTimeUnixNano: interval.start,
                    timeUnixNano: interval.end
                )
            )
        case "control":
            metrics.append(
                otlpSkippedMetric(
                    category: category,
                    reason: "silent_control_signal",
                    startTimeUnixNano: interval.start,
                    timeUnixNano: interval.end
                )
            )
        case "prefetch":
            metrics.append(
                otlpSkippedMetric(
                    category: category,
                    reason: "prefetch_only",
                    startTimeUnixNano: interval.start,
                    timeUnixNano: interval.end
                )
            )
        case "call":
            metrics.append(
                otlpSkippedMetric(
                    category: category,
                    reason: "native_call_pipeline",
                    startTimeUnixNano: interval.start,
                    timeUnixNano: interval.end
                )
            )
        default:
            metrics.append(
                otlpSkippedMetric(
                    category: category,
                    reason: "unsupported_or_invalid_payload",
                    startTimeUnixNano: interval.start,
                    timeUnixNano: interval.end
                )
            )
        }

        return [
            "resourceMetrics": [
                [
                    "resource": [
                        "attributes": otlpResourceAttributes(),
                        "droppedAttributesCount": 0
                    ],
                    "scopeMetrics": [
                        [
                            "scope": ["name": "xynespaces-native"],
                            "metrics": metrics
                        ]
                    ]
                ]
            ]
        ]
    }

    private func otlpSkippedMetric(
        category: String,
        reason: String,
        startTimeUnixNano: String,
        timeUnixNano: String
    ) -> [String: Any] {
        otlpSumMetric(
            name: "notification_display_skipped",
            description: "Payloads received and intentionally not presented as a banner",
            attributes: [
                "delivery_context": "background",
                "category": category,
                "reason": reason
            ],
            startTimeUnixNano: startTimeUnixNano,
            timeUnixNano: timeUnixNano
        )
    }

    private func otlpSumMetric(
        name: String,
        description: String,
        attributes: [String: String],
        startTimeUnixNano: String,
        timeUnixNano: String
    ) -> [String: Any] {
        [
            "name": name,
            "description": description,
            "unit": "1",
            "sum": [
                "aggregationTemporality": Constants.otlpAggregationTemporalityCumulative,
                "isMonotonic": true,
                "dataPoints": [
                    [
                        // JS createCounter defaults to ValueType.DOUBLE / asDouble.
                        "asDouble": 1.0,
                        "attributes": attributes.map { key, value in
                            otlpStringAttribute(key: key, value: value)
                        },
                        "startTimeUnixNano": startTimeUnixNano,
                        "timeUnixNano": timeUnixNano
                    ]
                ]
            ]
        ]
    }

    private func otlpResourceAttributes() -> [[String: Any]] {
        let host = hostAppBundle() ?? Bundle.main
        let appVersion = host.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let buildVersion = host.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        let bundleId = Bundle.main.bundleIdentifier ?? ""
        let environment = bundleId.contains("sandbox") ? "sandbox" : "prod"

        var attributes = [
            otlpStringAttribute(key: "service.name", value: "xynespaces-native"),
            otlpStringAttribute(key: "os.type", value: "ios"),
            otlpStringAttribute(key: "deployment.environment.name", value: environment)
        ]
        if let appVersion, !appVersion.isEmpty {
            attributes.append(otlpStringAttribute(key: "service.version", value: appVersion))
        }
        if let buildVersion, !buildVersion.isEmpty {
            attributes.append(otlpStringAttribute(key: "app.build.version", value: buildVersion))
        }
        return attributes
    }

    private func otlpStringAttribute(key: String, value: String) -> [String: Any] {
        [
            "key": key,
            "value": ["stringValue": value]
        ]
    }

    private func unixNanoNow() -> UInt64 {
        var timestamp = timespec()
        clock_gettime(CLOCK_REALTIME, &timestamp)
        return UInt64(timestamp.tv_sec) * 1_000_000_000 + UInt64(timestamp.tv_nsec)
    }

    /// Ingest drops some OTLP sums when start and end are identical (zero-duration).
    private func unixNanoInterval() -> (start: String, end: String) {
        let end = unixNanoNow()
        let start = end > Constants.otlpDeltaWindowNanos
            ? end - Constants.otlpDeltaWindowNanos
            : 0
        return (String(start), String(end))
    }

    private func observabilityTimestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }

    private func observabilityDeviceContext() -> [String: Any] {
        let host = hostAppBundle() ?? Bundle.main
        let appVersion = host.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let buildVersion = host.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        #if DEBUG
        let buildType = "dev"
        #else
        let buildType = "release"
        #endif

        var context: [String: Any] = [
            "serviceName": "xynespaces-native",
            "platformName": "native",
            "osName": "ios",
            "osVersion": UIDevice.current.systemVersion,
            "buildType": buildType,
            "brand": "Apple",
            "model": UIDevice.current.model,
            "sessionId": UUID().uuidString
        ]
        if let appVersion, !appVersion.isEmpty {
            context["appVersion"] = appVersion
        }
        if let buildVersion, !buildVersion.isEmpty {
            context["buildVersion"] = buildVersion
        }
        return context
    }

    // MARK: - Notification v3 tray group (matches notificationMessageStore.ts)

    private struct NotificationV3GroupState {
        var title: String = ""
        var scopeType: String?
        var messages: [[String: Any]] = []
    }

    /// Append one bubble to `@notif_v3_group:{userId}:notif_*` for silent edit/delete updates.
    private func appendMessageToNotificationV3Group(
        for request: UNNotificationRequest,
        userId: String
    ) {
        guard shouldAttachMessageCategory(for: request) else { return }
        guard let messageId = extractMessageId(from: request) else { return }
        guard let channelId = extractChannelId(from: request) else { return }

        let isThread = shouldUseThreadMessageOnlyPrefetch(for: request)
        let conversationId = extractConversationId(from: request)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        let storeKeySuffix: String
        if isThread, !conversationId.isEmpty {
            storeKeySuffix = "notif_thread_\(conversationId)"
        } else {
            storeKeySuffix = "notif_channel_\(channelId)"
        }

        let storageKey = "\(Constants.notifGroupKeyPrefix):\(userId):\(storeKeySuffix)"
        let metadata = extractMetadata(from: request.content.userInfo)
        let content = request.content

        let bodyText = firstNonEmpty([
            extractNotificationMessage(from: request),
            stringValue(content.body)
        ]) ?? ""
        guard !bodyText.isEmpty else {
            log("Notification v3 group: empty body; skipping messageId=\(messageId)")
            return
        }

        var group = loadNotificationV3Group(forKey: storageKey)
        if group.messages.contains(where: { stringValue($0["messageId"]) == messageId }) {
            log("Notification v3 group: messageId \(messageId) already stored")
            return
        }

        let senderName = firstNonEmpty([
            stringValue(metadata["senderName"]),
            stringValue(content.title)
        ]) ?? "Unknown"

        var person: [String: Any] = ["name": senderName]
        if let senderPicture = stringValue(metadata["senderPicture"]) {
            person["icon"] = senderPicture
        }

        let timestamp = extractMetadataTimestamp(metadata)
        var message: [String: Any] = [
            "text": bodyText,
            "timestamp": timestamp,
            "person": person,
            "messageId": messageId
        ]

        group.messages.append(message)
        if group.messages.count > Constants.maxStoredNotificationMessages {
            group.messages.removeFirst(group.messages.count - Constants.maxStoredNotificationMessages)
        }

        if group.title.isEmpty {
            group.title = stringValue(content.title) ?? senderName
        }
        if group.scopeType == nil {
            group.scopeType = stringValue(metadata["scopeType"])
        }

        var didPersist = false
        for attempt in 1...3 {
            let didWrite = writeNotificationV3Group(group, forKey: storageKey)
            let reloaded = loadNotificationV3Group(forKey: storageKey)
            let containsMessage = reloaded.messages.contains(where: {
                stringValue($0["messageId"]) == messageId
            })
            if didWrite && containsMessage {
                didPersist = true
                log(
                    "Notification v3 group: wrote key=\(storageKey) count=\(reloaded.messages.count) messageId=\(messageId) attempt=\(attempt)"
                )
                break
            }

            if attempt < 3 {
                group = reloaded
                if group.messages.contains(where: { stringValue($0["messageId"]) == messageId }) {
                    didPersist = true
                    break
                }
                group.messages.append(message)
                if group.messages.count > Constants.maxStoredNotificationMessages {
                    group.messages.removeFirst(group.messages.count - Constants.maxStoredNotificationMessages)
                }
                if group.title.isEmpty {
                    group.title = stringValue(content.title) ?? senderName
                }
                if group.scopeType == nil {
                    group.scopeType = stringValue(metadata["scopeType"])
                }
            }
        }

        if !didPersist {
            log(
                "Notification v3 group: failed to persist messageId=\(messageId) key=\(storageKey) after retries"
            )
        }
    }

    private func loadNotificationV3Group(forKey key: String) -> NotificationV3GroupState {
        guard
            let raw = NotificationCacheGetString(Constants.appGroupId, Constants.mmkvId, key),
            let data = raw.data(using: .utf8),
            let parsed = try? JSONSerialization.jsonObject(with: data)
        else {
            return NotificationV3GroupState()
        }

        if let legacyMessages = parsed as? [[String: Any]] {
            return NotificationV3GroupState(messages: legacyMessages)
        }

        guard let dict = parsed as? [String: Any] else {
            return NotificationV3GroupState()
        }

        return NotificationV3GroupState(
            title: stringValue(dict["title"]) ?? "",
            scopeType: stringValue(dict["scopeType"]),
            messages: dict["messages"] as? [[String: Any]] ?? []
        )
    }

    private func writeNotificationV3Group(_ group: NotificationV3GroupState, forKey key: String) -> Bool {
        var payload: [String: Any] = [
            "title": group.title,
            "messages": group.messages
        ]
        if let scopeType = group.scopeType {
            payload["scopeType"] = scopeType
        }

        guard JSONSerialization.isValidJSONObject(payload) else {
            lotusReportFailure("Invalid JSON object for key=\(key)", context: "writeNotificationV3Group")
            return false
        }

        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8)
        else {
            lotusReportFailure("Failed to serialize JSON for key=\(key)", context: "writeNotificationV3Group")
            return false
        }

        let success = NotificationCacheSetString(Constants.appGroupId, Constants.mmkvId, key, json)
        if !success {
            lotusReportFailure("MMKV write failed for key=\(key)", context: "writeNotificationV3Group")
        }
        return success
    }

    private func extractMetadataTimestamp(_ metadata: [String: Any]) -> Int64 {
        if let timestamp = metadata["timestamp"] as? Int64 {
            return timestamp
        }
        if let timestamp = metadata["timestamp"] as? Int {
            return Int64(timestamp)
        }
        if let timestamp = metadata["timestamp"] as? Double {
            return Int64(timestamp)
        }
        if let timestamp = metadata["timestamp"] as? String, let parsed = Int64(timestamp) {
            return parsed
        }
        return Int64(Date().timeIntervalSince1970 * 1000)
    }

}

// MARK: - URLSession Delegate for mTLS
private final class MtlsNotificationSessionDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    private let identity: SecIdentity
    private let certificate: SecCertificate

    init(identity: SecIdentity, certificate: SecCertificate) {
        self.identity = identity
        self.certificate = certificate
        super.init()
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        handleChallenge(challenge, completionHandler: completionHandler)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        handleChallenge(challenge, completionHandler: completionHandler)
    }

    private func handleChallenge(
        _ challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        switch challenge.protectionSpace.authenticationMethod {
        case NSURLAuthenticationMethodClientCertificate:
            let credential = URLCredential(
                identity: identity,
                certificates: [certificate],
                persistence: .forSession
            )
            completionHandler(.useCredential, credential)

        case NSURLAuthenticationMethodServerTrust:
            guard let trust = challenge.protectionSpace.serverTrust else {
                completionHandler(.performDefaultHandling, nil)
                return
            }
            completionHandler(.useCredential, URLCredential(trust: trust))

        default:
            completionHandler(.performDefaultHandling, nil)
        }
    }

}
