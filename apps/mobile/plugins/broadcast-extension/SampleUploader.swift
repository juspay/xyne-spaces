//
//  SampleUploader.swift
//  BroadcastExtension
//
//  Sends screen capture frames to the main app using HTTP-style framed messages
//

import Foundation
import ReplayKit
import UIKit
import os.log

class SampleUploader {
    
    private static var imageContext = CIContext(options: nil)
    
    private let connection: SocketConnection
    private var isReady = false
    private var dataToSend: Data?
    
    private let serialQueue = DispatchQueue(label: "net.juspay.xynespaces.broadcast.uploader")
    private let logger = OSLog(subsystem: "net.juspay.xynespaces.broadcast", category: "SampleUploader")
    
    init(connection: SocketConnection) {
        self.connection = connection
        setupConnection()
    }
    
    func send(sample buffer: CMSampleBuffer) {
        guard isReady, dataToSend == nil else { return }
        
        guard let imageBuffer = CMSampleBufferGetImageBuffer(buffer) else { return }
        
        // Get dimensions
        let width = CVPixelBufferGetWidth(imageBuffer)
        let height = CVPixelBufferGetHeight(imageBuffer)
        
        // Get orientation from device
        let orientation = imageOrientationValue()
        
        guard let jpegData = jpegData(from: imageBuffer) else { return }
        
        // Create HTTP-style framed message that the library expects
        guard let framedData = createFramedMessage(
            jpegData: jpegData,
            width: width,
            height: height,
            orientation: orientation
        ) else { return }
        
        serialQueue.async { [weak self] in
            self?.sendData(framedData)
        }
    }
    
    private func setupConnection() {
        connection.didOpen = { [weak self] in
            os_log("Connection opened, ready to send", log: self?.logger ?? .default, type: .info)
            self?.isReady = true
        }
        connection.didClose = { [weak self] error in
            os_log("Connection closed: %{public}@", log: self?.logger ?? .default, type: .info, error?.localizedDescription ?? "no error")
            self?.isReady = false
        }
        connection.streamHasSpaceAvailable = { [weak self] in
            self?.serialQueue.async { self?.sendPendingData() }
        }
    }
    
    /// Creates an HTTP-style framed message with headers
    /// Format expected by react-native-webrtc ScreenCapturer:
    /// HTTP/1.1 200 OK\r\n
    /// Content-Length: <length>\r\n
    /// Buffer-Width: <width>\r\n
    /// Buffer-Height: <height>\r\n
    /// Buffer-Orientation: <orientation>\r\n
    /// \r\n
    /// <jpeg data>
    private func createFramedMessage(jpegData: Data, width: Int, height: Int, orientation: Int) -> Data? {
        var message = "HTTP/1.1 200 OK\r\n"
        message += "Content-Length: \(jpegData.count)\r\n"
        message += "Buffer-Width: \(width)\r\n"
        message += "Buffer-Height: \(height)\r\n"
        message += "Buffer-Orientation: \(orientation)\r\n"
        message += "\r\n"
        
        guard var headerData = message.data(using: .utf8) else { return nil }
        headerData.append(jpegData)
        
        return headerData
    }
    
    /// Get the current device orientation as CGImagePropertyOrientation value
    private func imageOrientationValue() -> Int {
        // Return 1 (kCGImagePropertyOrientationUp) = no rotation applied
        // The pixel buffer from ReplayKit is already in the correct orientation,
        // so we shouldn't apply any additional rotation.
        return 1
    }
    
    private func sendData(_ data: Data) {
        dataToSend = data
        sendPendingData()
    }
    
    private func sendPendingData() {
        guard let data = dataToSend, !data.isEmpty else { return }
        
        let bytesToSend = min(data.count, 10240)
        let bytesSent = data.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int in
            guard let baseAddress = ptr.baseAddress else { return 0 }
            return connection.writeToStream(
                buffer: baseAddress.assumingMemoryBound(to: UInt8.self),
                maxLength: bytesToSend
            )
        }
        
        if bytesSent > 0 {
            dataToSend = data.dropFirst(bytesSent).isEmpty ? nil : Data(data.dropFirst(bytesSent))
        }
    }
    
    private func jpegData(from imageBuffer: CVImageBuffer) -> Data? {
        CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }
        
        let ciImage = CIImage(cvPixelBuffer: imageBuffer)
        guard let cgImage = SampleUploader.imageContext.createCGImage(ciImage, from: ciImage.extent) else {
            return nil
        }
        return UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.7)
    }
}
