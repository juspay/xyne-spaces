//
//  SocketConnection.swift
//  BroadcastExtension
//

import Foundation
import os.log

class SocketConnection: NSObject {
    
    var didOpen: (() -> Void)?
    var didClose: ((Error?) -> Void)?
    var streamHasSpaceAvailable: (() -> Void)?
    
    private let filePath: String
    private var socketHandle: Int32 = -1
    
    private var inputStream: InputStream?
    private var outputStream: OutputStream?
    
    private var networkQueue: DispatchQueue?
    private var shouldKeepRunning = false
    
    private let logger = OSLog(subsystem: "net.juspay.xynespaces.broadcast", category: "SocketConnection")
    
    init?(filePath path: String) {
        guard !path.isEmpty else { return nil }
        filePath = path
        super.init()
    }
    
    @discardableResult
    func open() -> Bool {
        guard setupSocket() else {
            os_log("Socket setup failed", log: logger, type: .error)
            return false
        }
        openStreams()
        networkQueue = DispatchQueue(label: "net.juspay.xynespaces.broadcast.network")
        shouldKeepRunning = true
        networkQueue?.async { [weak self] in
            self?.runNetworkLoop()
        }
        return true
    }
    
    func close() {
        shouldKeepRunning = false
        
        inputStream?.delegate = nil
        outputStream?.delegate = nil
        
        inputStream?.close()
        outputStream?.close()
        
        inputStream?.remove(from: .main, forMode: .common)
        outputStream?.remove(from: .main, forMode: .common)
        
        inputStream = nil
        outputStream = nil
        
        if socketHandle >= 0 {
            Darwin.close(socketHandle)
            socketHandle = -1
        }
    }
    
    func writeToStream(buffer: UnsafePointer<UInt8>, maxLength length: Int) -> Int {
        return outputStream?.write(buffer, maxLength: length) ?? 0
    }
    
    private func setupSocket() -> Bool {
        socketHandle = socket(AF_UNIX, SOCK_STREAM, 0)
        guard socketHandle >= 0 else {
            os_log("Failed to create socket", log: logger, type: .error)
            return false
        }
        
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        
        let pathSize = MemoryLayout.size(ofValue: addr.sun_path)
        guard filePath.count < pathSize else {
            os_log("Path too long", log: logger, type: .error)
            Darwin.close(socketHandle)
            socketHandle = -1
            return false
        }
        
        // Safely copy file path to sun_path
        _ = filePath.withCString { srcPtr in
            withUnsafeMutableBytes(of: &addr.sun_path) { dstBuffer in
                if let dstPtr = dstBuffer.baseAddress?.assumingMemoryBound(to: CChar.self) {
                    var i = 0
                    var current = srcPtr
                    while current.pointee != 0 && i < pathSize - 1 {
                        dstPtr.advanced(by: i).pointee = current.pointee
                        current = current.advanced(by: 1)
                        i += 1
                    }
                    dstPtr.advanced(by: i).pointee = 0
                }
            }
        }
        
        let connectResult = withUnsafePointer(to: &addr) { addrPtr in
            addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
                connect(socketHandle, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        
        if connectResult < 0 {
            os_log("Failed to connect: errno=%d", log: logger, type: .error, errno)
            Darwin.close(socketHandle)
            socketHandle = -1
            return false
        }
        
        os_log("Socket connected", log: logger, type: .info)
        return true
    }
    
    private func openStreams() {
        var readStream: Unmanaged<CFReadStream>?
        var writeStream: Unmanaged<CFWriteStream>?
        
        CFStreamCreatePairWithSocket(kCFAllocatorDefault, socketHandle, &readStream, &writeStream)
        
        inputStream = readStream?.takeRetainedValue()
        outputStream = writeStream?.takeRetainedValue()
        
        inputStream?.delegate = self
        outputStream?.delegate = self
        
        inputStream?.schedule(in: .main, forMode: .common)
        outputStream?.schedule(in: .main, forMode: .common)
        
        inputStream?.open()
        outputStream?.open()
    }
    
    private func runNetworkLoop() {
        while shouldKeepRunning {
            RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1))
        }
    }
}

extension SocketConnection: StreamDelegate {
    func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
        switch eventCode {
        case .openCompleted:
            if aStream == outputStream {
                os_log("Stream opened", log: logger, type: .info)
                didOpen?()
            }
        case .hasBytesAvailable:
            if aStream == inputStream {
                var buffer = [UInt8](repeating: 0, count: 1024)
                while inputStream?.hasBytesAvailable == true {
                    let bytesRead = inputStream?.read(&buffer, maxLength: buffer.count) ?? 0
                    if bytesRead <= 0 { break }
                }
            }
        case .hasSpaceAvailable:
            if aStream == outputStream {
                streamHasSpaceAvailable?()
            }
        case .errorOccurred:
            os_log("Stream error: %{public}@", log: logger, type: .error, 
                   aStream.streamError?.localizedDescription ?? "Unknown")
            close()
            didClose?(aStream.streamError)
        case .endEncountered:
            os_log("Stream ended", log: logger, type: .info)
            close()
            didClose?(nil)
        default:
            break
        }
    }
}
