//
//  SampleHandler.swift
//  BroadcastExtension
//
//  Created by Sayantan Paul on 21/04/26.
//

import ReplayKit
import os.log

/// The App Group identifier shared between the main app and broadcast extension
/// Must match the value in both xyneSpaces.entitlements and BroadcastExtension.entitlements
private let appGroupIdentifier = "group.net.juspay.xynespaces.share"

/// Socket file name used for IPC between main app and broadcast extension
private let socketFileName = "rtc_SSFD"

/// Darwin notification name for stopping broadcast from main app
private let stopBroadcastNotificationName = "net.juspay.xynespaces.STOP_BROADCAST" as CFString

class SampleHandler: RPBroadcastSampleHandler {
    
    private var socketConnection: SocketConnection?
    private var sampleUploader: SampleUploader?
    
    private let logger = OSLog(subsystem: "com.xyne.spaces.broadcast", category: "SampleHandler")
    
    override func broadcastStarted(withSetupInfo setupInfo: [String : NSObject]?) {
        os_log("Broadcast started", log: logger, type: .info)
        
        // Register for stop notification from main app
        registerForStopNotification()
        
        // Get the shared container URL for the App Group
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        ) else {
            os_log("Failed to get app group container for identifier: %{public}@", 
                   log: logger, type: .error, appGroupIdentifier)
            finishBroadcastWithError(createError(
                code: -1,
                message: "Cannot access shared app group container. Please ensure the app group is properly configured."
            ))
            return
        }
        
        // Build the socket file path
        let socketPath = containerURL.appendingPathComponent(socketFileName).path
        os_log("Socket path: %{public}@", log: logger, type: .info, socketPath)
        
        // Create the socket connection
        guard let connection = SocketConnection(filePath: socketPath) else {
            os_log("Failed to create socket connection", log: logger, type: .error)
            finishBroadcastWithError(createError(
                code: -2,
                message: "Failed to create socket connection"
            ))
            return
        }
        
        socketConnection = connection
        sampleUploader = SampleUploader(connection: connection)
        
        // Setup connection callbacks
        connection.didClose = { [weak self] error in
            guard let self = self else { return }
            os_log("Socket connection closed: %{public}@", 
                   log: self.logger, type: .info, error?.localizedDescription ?? "no error")
            
            // Socket closed - finish broadcast gracefully
            self.stopBroadcastGracefully()
        }
        
        // Try to open the connection
        if !connection.open() {
            os_log("Failed to open socket connection - main app may not be listening", 
                   log: logger, type: .error)
            finishBroadcastWithError(createError(
                code: -3,
                message: "Failed to connect to main app. Please ensure the app is running and screen sharing is enabled."
            ))
            return
        }
        
        os_log("Broadcast extension connected successfully", log: logger, type: .info)
    }
    
    override func broadcastPaused() {
        os_log("Broadcast paused", log: logger, type: .info)
        // Frames will stop being delivered, nothing special to do
    }
    
    override func broadcastResumed() {
        os_log("Broadcast resumed", log: logger, type: .info)
        // Frames will resume being delivered
    }
    
    override func broadcastFinished() {
        os_log("Broadcast finished", log: logger, type: .info)
        cleanup()
    }
    
    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        switch sampleBufferType {
        case .video:
            // Send video frames to the main app via socket
            sampleUploader?.send(sample: sampleBuffer)
        case .audioApp:
            // App audio - could be sent separately if needed
            break
        case .audioMic:
            // Microphone audio - could be sent separately if needed
            break
        @unknown default:
            os_log("Unknown sample buffer type: %d", log: logger, type: .debug, sampleBufferType.rawValue)
            break
        }
    }
    
    // MARK: - Darwin Notifications
    
    private func registerForStopNotification() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        
        CFNotificationCenterAddObserver(
            center,
            Unmanaged.passUnretained(self).toOpaque(),
            { (center, observer, name, object, userInfo) in
                guard let observer = observer else { return }
                let handler = Unmanaged<SampleHandler>.fromOpaque(observer).takeUnretainedValue()
                handler.handleStopNotification()
            },
            stopBroadcastNotificationName,
            nil,
            .deliverImmediately
        )
        
        os_log("Registered for stop broadcast notification", log: logger, type: .info)
    }
    
    private func unregisterFromStopNotification() {
        CFNotificationCenterRemoveObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            CFNotificationName(stopBroadcastNotificationName),
            nil
        )
    }
    
    private func handleStopNotification() {
        os_log("Received stop broadcast notification from main app", log: logger, type: .info)
        stopBroadcastGracefully()
    }
    
    private func stopBroadcastGracefully() {
        os_log("Stopping broadcast gracefully", log: logger, type: .info)
        cleanup()
        // Use Objective-C helper to pass nil (silent stop without error banner)
        BroadcastHandler.finishBroadcastGracefully(self)
    }
    
    // MARK: - Private Helpers
    
    private func cleanup() {
        unregisterFromStopNotification()
        socketConnection?.close()
        socketConnection = nil
        sampleUploader = nil
    }
    
    private func createError(code: Int, message: String) -> NSError {
        return NSError(
            domain: "com.xyne.spaces.broadcast",
            code: code,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
