import Foundation
import React
import Security

@objc(MtlsSocketModule)
class MtlsSocketModule: RCTEventEmitter {
  private static let eventName = "mtlsWebSocketEvent"
  private static let identityTag = "ClientIdentity"
  private static let privateKeyTag = "ClientIdentity"

  private let socketQueue = DispatchQueue(label: "net.juspay.xynespaces.mtlssocket.state", qos: .userInitiated)
  private var nextSocketId = 1
  private var connections: [Int: MtlsSocketConnection] = [:]

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    [Self.eventName]
  }

  @objc(connect:protocols:headers:resolve:reject:)
  func connect(
    _ urlString: String,
    protocols: [String]?,
    headers: [String: String]?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let url = URL(string: urlString) else {
        reject("INVALID_URL", "Invalid URL: \(urlString)", nil)
        return
      }

      guard MtlsTransportPolicy.isApprovedWebSocketURL(urlString) else {
        reject("UNAPPROVED_DESTINATION", "WebSocket destination is not approved", nil)
        return
      }

      guard self.getPrivateKeyFromKeychain() != nil else {
        reject("NO_PRIVATE_KEY", "No private key found. Please generate CSR first.", nil)
        return
      }

      guard let certificate = self.getCertificateFromKeychain(tag: Self.identityTag) else {
        reject("NO_CERTIFICATE", "No certificate found. Please complete enrollment first.", nil)
        return
      }

      guard let identity = self.getCertificateIdentity(tag: Self.identityTag) else {
        reject("NO_IDENTITY", "Failed to retrieve identity from stored certificate and key.", nil)
        return
      }

      self.socketQueue.async {
        let socketId = self.nextSocketId
        self.nextSocketId += 1
        let connection = MtlsSocketConnection(
          socketId: socketId,
          url: url,
          protocols: protocols ?? [],
          headers: headers ?? [:],
          identity: identity,
          certificate: certificate,
          caCertificate: Self.loadServerCaCertificate(),
          eventSink: { [weak self] payload in
            self?.emit(payload: payload)
          },
          cleanup: { [weak self] socketId in
            self?.removeConnection(socketId)
          }
        )

        self.connections[socketId] = connection
        connection.connect()
        resolve(socketId)
      }
    }
  }

  @objc(send:data:resolve:reject:)
  func send(
    _ socketId: NSNumber,
    data: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    socketQueue.async {
      guard let connection = self.connections[socketId.intValue] else {
        resolve(false)
        return
      }

      connection.send(data: data, resolve: resolve, reject: reject)
    }
  }

  @objc(close:code:reason:resolve:reject:)
  func close(
    _ socketId: NSNumber,
    code: NSNumber?,
    reason: String?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    socketQueue.async {
      guard let connection = self.connections[socketId.intValue] else {
        resolve(false)
        return
      }

      connection.close(code: code?.intValue ?? 1000, reason: reason)
      self.connections.removeValue(forKey: socketId.intValue)
      resolve(true)
    }
  }

  private func emit(payload: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      self?.sendEvent(withName: Self.eventName, body: payload)
    }
  }

  private func removeConnection(_ socketId: Int) {
    socketQueue.async {
      self.connections.removeValue(forKey: socketId)
    }
  }

  private func getPrivateKeyFromKeychain() -> SecKey? {
    let tag = Self.privateKeyTag.data(using: .utf8)!
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnRef as String: true
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else {
      return nil
    }

    guard let foundItem = item, CFGetTypeID(foundItem) == SecKeyGetTypeID() else {
      return nil
    }

    return (foundItem as! SecKey)
  }

  private func getCertificateFromKeychain(tag: String) -> SecCertificate? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassCertificate,
      kSecAttrLabel as String: tag,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnRef as String: true
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else {
      return nil
    }

    guard let foundItem = item, CFGetTypeID(foundItem) == SecCertificateGetTypeID() else {
      return nil
    }

    return (foundItem as! SecCertificate)
  }

  private func getCertificateIdentity(tag: String) -> SecIdentity? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassIdentity,
      kSecAttrLabel as String: tag,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnRef as String: true
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else {
      return nil
    }

    guard let foundItem = item, CFGetTypeID(foundItem) == SecIdentityGetTypeID() else {
      return nil
    }

    return (foundItem as! SecIdentity)
  }

  private static func loadServerCaCertificate() -> SecCertificate? {
    let env = ProcessInfo.processInfo.environment["APP_ENV"]?.lowercased() ?? ""
    let pem = env.contains("sandbox") ? serverCaPemSandbox : serverCaPemProd
    guard let data = pem.data(using: .utf8) else {
      return nil
    }
    return SecCertificateCreateWithData(nil, data as CFData)
  }

  private static let serverCaPemProd = """
-----BEGIN CERTIFICATE-----
MIICrjCCAjOgAwIBAgITZxdzXXsS5keda9UdiTUtHHK4NjAKBggqhkjOPQQDAzCB
hTELMAkGA1UEBhMCSU4xEjAQBgNVBAgTCUthcm5hdGFrYTESMBAGA1UEBxMJQmVu
Z2FsdXJ1MSYwJAYDVQQKEx1KdXNwYXkgVGVjaG5vbG9naWVzIFB2dC4gTHRkLjEN
MAsGA1UECxMEWHluZTEXMBUGA1UEAxMOcjAxLmp1c3BheS5uZXQwHhcNMjUxMjA5
MTMyMDQyWhcNMzUxMjA3MTMyMDQxWjCBhTELMAkGA1UEBhMCSU4xEjAQBgNVBAgT
CUthcm5hdGFrYTESMBAGA1UEBxMJQmVuZ2FsdXJ1MSYwJAYDVQQKEx1KdXNwYXkg
VGVjaG5vbG9naWVzIFB2dC4gTHRkLjENMAsGA1UECxMEWHluZTEXMBUGA1UEAxMO
cjAxLmp1c3BheS5uZXQwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAATBlHoBIf4D/JBR
HgHEjU+0X2OQb4HytqHAxC1e5gN1NIMPZsvwDAShtbAgyWhrOJRYuv2clPn14pF7
OLRqXe00oySpRDiJVy97OsmWUEN2XD3HnjaG6sRlQG9VcfPFtVqjYzBhMA4GA1Ud
DwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBSiaksd1ABgrQoc
4a698TXSCeYtXjAfBgNVHSMEGDAWgBSiaksd1ABgrQoc4a698TXSCeYtXjAKBggq
hkjOPQQDAwNpADBmAjEA6mkvk1NFhNuMb5rdFro3Ein1qmzPLS01B+AyDXvqYzWd
wvUGnScnS10DpdnOqSdgAjEArtfIK2DX2deS9hcaM6PREiZJpdQSvWJqfdSFp7ok
xYl9zN4KS7S4UNSH946JKfhn
-----END CERTIFICATE-----
"""

  private static let serverCaPemSandbox = """
-----BEGIN CERTIFICATE-----
MIID2TCCA2CgAwIBAgITUCUlU/RLwrb27kHlJyAyFzz7vTAKBggqhkjOPQQDAzCB
jTELMAkGA1UEBhMCSU4xEjAQBgNVBAgTCUthcm5hdGFrYTESMBAGA1UEBxMJQmVu
Z2FsdXJ1MSYwJAYDVQQKEx1KdXNwYXkgVGVjaG5vbG9naWVzIFB2dC4gTHRkLjEN
MAsGA1UECxMEWHluZTEfMB0GA1UEAxMWcjAxLnNhbmRib3guanVzcGF5Lm5ldDAe
Fw0yNTEyMTcxOTIwNTdaFw0yODEyMTYxOTIwNTZaMIGOMQswCQYDVQQGEwJJTjES
MBAGA1UECBMJS2FybmF0YWthMRIwEAYDVQQHEwlCZW5nYWx1cnUxJjAkBgNVBAoT
HUp1c3BheSBUZWNobm9sb2dpZXMgUHZ0LiBMdGQuMQ0wCwYDVQQLEwRYeW5lMSAw
HgYDVQQDExdjYTAxLnNhbmRib3guanVzcGF5Lm5ldDB2MBAGByqGSM49AgEGBSuB
BAAiA2IABFw0bCLd/AqCuqYk1T/WvyGj5Tno84WMruo3NHmyVz93b2t5SbNhW/IB
7uGw9QQJFQ7ggdGC0NbH0TRdoMxH4ier7RajU/33n2SgFgEB6SEnxqr3a6VU76RR
2Z2EBcu2QaOCAX0wggF5MA4GA1UdDwEB/wQEAwIBBjASBgNVHRMBAf8ECDAGAQH/
AgEAMB0GA1UdDgQWBBSz3HK7QxHNhncLZA/LZQUHwrdiKTAfBgNVHSMEGDAWgBSl
t7kdWCIrbtei7wA845kg/tye0DCBjQYIKwYBBQUHAQEEgYAwfjB8BggrBgEFBQcw
AoZwaHR0cDovL3ByaXZhdGVjYS1jb250ZW50LTY5NDUxOTZmLTAwMDAtMjNmZC1i
NDY5LWY0MDMwNDM4Y2E0OC5zdG9yYWdlLmdvb2dsZWFwaXMuY29tL2YyZWUyY2Rm
M2JhYzA1ZmMwZDIwL2NhLmNydDCBggYDVR0fBHsweTB3oHWgc4ZxaHR0cDovL3By
aXZhdGVjYS1jb250ZW50LTY5NDUxOTZmLTAwMDAtMjNmZC1iNDY5LWY0MDMwNDM4
Y2E0OC5zdG9yYWdlLmdvb2dsZWFwaXMuY29tL2YyZWUyY2RmM2JhYzA1ZmMwZDIw
L2NybC5jcmwwCgYIKoZIzj0EAwMDZwAwZAIwATkwXl71mmqgG0KJbbAlsZxqp6sN
eHHAkg6zVxW+tqFy7XBXW39VYl+Y87i3esAuAjBDKOhsPYvpZhXWZByKrT8T7ICQ
X3Lzm0UE40jWh56ZL+VDzSbZQsxBuweMAM4lZfo=
-----END CERTIFICATE-----
"""
}

private final class MtlsSocketConnection: NSObject, URLSessionWebSocketDelegate, URLSessionTaskDelegate {
  private let socketId: Int
  private let eventSink: ([String: Any]) -> Void
  private let cleanup: (Int) -> Void
  private let identity: SecIdentity
  private let certificate: SecCertificate
  private let caCertificate: SecCertificate?
  private var session: URLSession?
  private var task: URLSessionWebSocketTask?
  private let stateLock = NSLock()
  private var isClosing = false

  init(
    socketId: Int,
    url: URL,
    protocols: [String],
    headers: [String: String],
    identity: SecIdentity,
    certificate: SecCertificate,
    caCertificate: SecCertificate?,
    eventSink: @escaping ([String: Any]) -> Void,
    cleanup: @escaping (Int) -> Void
  ) {
    self.socketId = socketId
    self.identity = identity
    self.certificate = certificate
    self.caCertificate = caCertificate
    self.eventSink = eventSink
    self.cleanup = cleanup
    super.init()

    var request = URLRequest(url: url)
    for (key, value) in headers {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !key.isEmpty, !trimmed.isEmpty else { continue }
      request.setValue(trimmed, forHTTPHeaderField: key)
    }
    if !protocols.isEmpty {
      request.setValue(protocols.joined(separator: ", "), forHTTPHeaderField: "Sec-WebSocket-Protocol")
    }

    let configuration = URLSessionConfiguration.ephemeral
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    self.session = session
    self.task = session.webSocketTask(with: request)
  }

  func connect() {
    task?.resume()
    receiveNext()
  }

  func send(data: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard let task else {
      cleanup(socketId)
      resolve(false)
      return
    }

    task.send(.string(data)) { error in
      if let error {
        reject("MTLS_SOCKET_SEND_FAILED", error.localizedDescription, error)
      } else {
        resolve(true)
      }
    }
  }

  func close(code: Int, reason: String?) {
    guard markClosing() else {
      return
    }
    let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
    let reasonData = reason?.data(using: .utf8)
    task?.cancel(with: closeCode, reason: reasonData)
    session?.invalidateAndCancel()
  }

  private func receiveNext() {
    guard let task, !isMarkedClosing() else {
      return
    }

    task.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let message):
        switch message {
        case .string(let text):
          self.eventSink(["socketId": self.socketId, "type": "message", "data": text])
        case .data(let data):
          let text = String(data: data, encoding: .utf8) ?? data.base64EncodedString()
          self.eventSink(["socketId": self.socketId, "type": "message", "data": text])
        @unknown default:
          break
        }
        self.receiveNext()
      case .failure(let error):
        self.emitErrorAndClose(message: error.localizedDescription)
      }
    }
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    var payload: [String: Any] = ["socketId": socketId, "type": "open"]
    if let `protocol` {
      payload["protocol"] = `protocol`
    }
    eventSink(payload)
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    let reasonText = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    eventSink([
      "socketId": socketId,
      "type": "close",
      "code": Int(closeCode.rawValue),
      "reason": reasonText,
      "wasClean": true
    ])
    cleanup(socketId)
    session.finishTasksAndInvalidate()
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    guard let redirectURL = request.url,
          let websocketURL = websocketRedirectURL(redirectURL),
          MtlsTransportPolicy.isApprovedWebSocketURL(websocketURL) else {
      completionHandler(nil)
      return
    }
    completionHandler(request)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    guard let error else { return }
    emitErrorAndClose(message: error.localizedDescription)
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard let challengeURL = websocketChallengeURL(didReceive: challenge.protectionSpace),
          MtlsTransportPolicy.isApprovedWebSocketURL(challengeURL) else {
      completionHandler(.performDefaultHandling, nil)
      return
    }

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

      if let caCertificate, evaluateServerTrust(trust, anchor: caCertificate) {
        completionHandler(.useCredential, URLCredential(trust: trust))
      } else {
        completionHandler(.performDefaultHandling, nil)
      }

    default:
      completionHandler(.performDefaultHandling, nil)
    }
  }

  private func websocketRedirectURL(_ url: URL) -> String? {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      return nil
    }
    if components.scheme?.lowercased() == "https" {
      components.scheme = "wss"
    } else if components.scheme?.lowercased() == "http" {
      components.scheme = "ws"
    }
    return components.url?.absoluteString
  }

  private func websocketChallengeURL(didReceive protectionSpace: URLProtectionSpace) -> String? {
    guard let scheme = protectionSpace.protocol?.lowercased(),
          let host = protectionSpace.host.nonEmpty else {
      return nil
    }
    var components = URLComponents()
    components.scheme = scheme == "https" ? "wss" : scheme
    components.host = host
    if protectionSpace.port > 0 {
      components.port = protectionSpace.port
    }
    return components.url?.absoluteString
  }

  private func emitErrorAndClose(message: String) {
    guard markClosing() else {
      return
    }
    eventSink(["socketId": socketId, "type": "error", "message": message])
    eventSink([
      "socketId": socketId,
      "type": "close",
      "code": 1006,
      "reason": message,
      "wasClean": false
    ])
    cleanup(socketId)
    session?.invalidateAndCancel()
  }

  private func isMarkedClosing() -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return isClosing
  }

  private func markClosing() -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    if isClosing {
      return false
    }
    isClosing = true
    return true
  }

  private func evaluateServerTrust(_ serverTrust: SecTrust, anchor: SecCertificate) -> Bool {
    SecTrustSetAnchorCertificates(serverTrust, [anchor] as CFArray)
    SecTrustSetAnchorCertificatesOnly(serverTrust, true)
    var error: CFError?
    return SecTrustEvaluateWithError(serverTrust, &error)
  }
}

private extension String {
  var nonEmpty: String? { isEmpty ? nil : self }
}
