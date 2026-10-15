//
//  CertificateModule.swift
//  Lotus
//
//  mTLS Certificate Module for iOS
//

import Foundation
import Security
import CommonCrypto
import React
import UIKit

@objc(CertificateModule)
class CertificateModule: NSObject {

  /// Per-flavor: follows `Bundle.main.bundleIdentifier` (dev / prod / sandbox).
  private static let kKeychainService =
    (Bundle.main.bundleIdentifier ?? "net.juspay.xynespaces") + ".mtls"
  private static let kPrivateKeyTag = "ClientIdentity"
  private static let kCertificateTag = "ClientIdentity"
  private static let kKeySize = 384  // EC P-384 (secp384r1)
  private static let kInstallMarkerKey = "mtls_install_marker"
  private static let multipartHeaderParameterMaxLength = 180

  /// A request that has not answered in 20s is never going to be useful. The old
  /// code set no timeout at all and inherited URLSession's 60s default.
  private static let kRequestTimeoutSeconds: TimeInterval = 20
  private static let kResourceTimeoutSeconds: TimeInterval = 60
  private static let kMaxConnectionsPerHost = 6
  // Pinned CA (inlined, mirrors Android)
  private static let kServerCaPemProd = """
-----BEGIN CERTIFICATE-----
MIICrjCCAjOgAwIBAgITZxdzXXsS5keda9UdiTUtHHK4NjAKBggqhkjOPQQDAzCB
hTELMAkGA1UEBhMCSU4xEjAQBgNVBAgTCUthcm5hdGFrYTESMBAGA1UEBxMJQmVu
g2FsdXJ1MSYwJAYDVQQKEx1KdXNwYXkgVGVjaG5vbG9naWVzIFB2dC4gTHRkLjEN
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
  private static let kServerCaPemSandbox = """
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

  override init() {
    super.init()
  }

  // MARK: - React Native Methods

  @objc
  func isEnrolled(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      let hasPrivateKey = self.getPrivateKeyFromKeychain() != nil
      let hasCertificate = self.getCertificateFromKeychain(tag: Self.kCertificateTag) != nil

      // Verify that certificate and private key are properly paired and can form a valid identity
      let canCreateIdentity = hasPrivateKey && hasCertificate && self.getCertificateIdentity(tag: Self.kCertificateTag) != nil

      resolve(canCreateIdentity)
    }
  }

  @objc
  func hasPrivateKey(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      let hasKey = self.getPrivateKeyFromKeychain() != nil
      resolve(hasKey)
    }
  }

  @objc
  func generateCSR(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        // The shared session's delegate captured the identity built from the key we
        // are about to destroy, so it must not outlive it.
        Self.tearDownSharedSession()

        // Delete existing key if present
        self.deletePrivateKeyFromKeychain()

        // Generate EC P-384 keypair in Secure Enclave/Keychain
        let privateKey = try self.generatePrivateKey()
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
          reject("KEY_GENERATION_ERROR", "Failed to get public key", nil)
          return
        }

        // Get device info
        let deviceInfo = self.getDeviceInfo()

        // Create CSR with proper PKCS#10 format
        let deviceFingerprint = deviceInfo["device_fingerprint"] as? String ?? "unknown"
        let subject = "CN=lotus-ios-\(deviceFingerprint), O=Juspay, OU=Lotus, C=IN"
        let csrData: Data
        do {
          csrData = try self.createPKCS10CSR(privateKey: privateKey, publicKey: publicKey, subject: subject)
        } catch {
          let errorMsg = "Failed to create PKCS#10 CSR: \(error.localizedDescription)"
          reject("CSR_CREATION_ERROR", errorMsg, error)
          return
        }

        let csrPem = self.convertToPEM(data: csrData, type: "CERTIFICATE REQUEST")

        let result: [String: Any] = [
          "csr": csrPem,
          "deviceInfo": deviceInfo
        ]

        resolve(result)
      } catch {
        reject("CSR_GENERATION_ERROR", error.localizedDescription, error)
      }
    }
  }

  @objc(storeCertificate:caChainPem:resolve:reject:)
  func storeCertificate(_ certificatePem: String, caChainPem: String?, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard self.getPrivateKeyFromKeychain() != nil else {
        let errorMsg = "Private key not found. Generate keys first."
        reject("NO_PRIVATE_KEY", errorMsg, nil)
        return
      }

      // Parse client certificate
      let certificate: SecCertificate
      do {
        certificate = try self.parseCertificate(pem: certificatePem)
      } catch {
        let errorMsg = "Failed to parse client certificate: \(error.localizedDescription)"
        reject("CERTIFICATE_PARSE_ERROR", errorMsg, error)
        return
      }

      // Store client certificate in keychain
      do {
        try self.storeCertificateInKeychain(certificate: certificate, tag: Self.kCertificateTag)
      } catch {
        let errorMsg = "Failed to store client certificate in keychain: \(error.localizedDescription)"
        reject("CLIENT_CERT_STORAGE_ERROR", errorMsg, error)
        return
      }

      // A session created before this point still presents the previous certificate,
      // because its delegate captured that identity when it was built.
      Self.tearDownSharedSession()

      resolve(true)
    }
  }

  @objc
  func getCertificate(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let certificate = self.getCertificateFromKeychain(tag: Self.kCertificateTag) else {
        reject("NO_CERTIFICATE", "No certificate found", nil)
        return
      }

      let certPem = self.convertToPEM(data: SecCertificateCopyData(certificate) as Data, type: "CERTIFICATE")
      resolve(certPem)
    }
  }

  @objc
  func getPrivateKey(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard self.getPrivateKeyFromKeychain() != nil else {
        reject("NO_PRIVATE_KEY", "No private key found", nil)
        return
      }

      // iOS Keychain doesn't allow exporting private keys (security feature)
      resolve(true)
    }
  }

  @objc
  func clearCertificates(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      self.deletePrivateKeyFromKeychain()
      self.deleteCertificateFromKeychain(tag: Self.kCertificateTag)

      // After the identity is gone, not before: a request landing in between would
      // otherwise rebuild the session around the certificate being deleted.
      Self.tearDownSharedSession()

      resolve(true)
    }
  }

  // MARK: - Shared mTLS URLSession

  /// A URLSession created with a delegate is retained by the system until it is
  /// explicitly invalidated, and its connection pool is private to it. Creating one
  /// per request therefore leaked a session, a delegate and its threads on every
  /// call, and forced a fresh client-certificate TLS handshake every time.
  ///
  /// One session for the whole process fixes both. It is torn down only when the
  /// client identity changes, because the delegate captured that identity.
  private static let sessionLock = NSLock()
  private static var sharedSession: URLSession?

  /// requestId -> in-flight task, so JS can abort a superseded request.
  private static let taskLock = NSLock()
  private static var tasksByRequestId: [String: URLSessionTask] = [:]
  /// Cancels that arrived before their task was registered.
  private static var cancelledRequestIds = Set<String>()

  private static func mtlsSession(
    identity: SecIdentity,
    certificate: SecCertificate
  ) -> URLSession {
    sessionLock.lock()
    defer { sessionLock.unlock() }

    if let existing = sharedSession {
      return existing
    }

    let delegate = MtlsURLSessionDelegate(
      identity: identity,
      certificate: certificate,
      trustAll: false,
      caCertificate: loadServerCaCertificate()
    )

    let configuration = URLSessionConfiguration.default
    configuration.httpShouldSetCookies = true
    configuration.httpCookieAcceptPolicy = .always
    configuration.httpCookieStorage = HTTPCookieStorage.shared
    configuration.timeoutIntervalForRequest = kRequestTimeoutSeconds
    configuration.timeoutIntervalForResource = kResourceTimeoutSeconds
    configuration.httpMaximumConnectionsPerHost = kMaxConnectionsPerHost
    // Never park a request waiting for the radio. JS decides what to do about
    // connectivity; a silently queued request is indistinguishable from a hang.
    configuration.waitsForConnectivity = false

    let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    sharedSession = session
    return session
  }

  /// Drops the shared session and aborts everything still running on it. The next
  /// request rebuilds a session around whatever identity the keychain holds then.
  private static func tearDownSharedSession() {
    sessionLock.lock()
    let session = sharedSession
    sharedSession = nil
    sessionLock.unlock()

    taskLock.lock()
    let pending = Array(tasksByRequestId.values)
    tasksByRequestId.removeAll()
    cancelledRequestIds.removeAll()
    taskLock.unlock()

    pending.forEach { $0.cancel() }
    session?.invalidateAndCancel()
  }

  /// Registers the task unless a cancel for this id has already landed, in which case
  /// the request must not start at all.
  ///
  /// Both halves happen under a single acquisition of `taskLock`, and that is the whole
  /// point. Checking and registering separately left a window: a cancel arriving
  /// between them found nothing in the map, recorded a tombstone, and registration —
  /// which never looked at that set again — resumed the task anyway. Doing it in one
  /// step means a concurrent cancel either finds the task and cancels it, or leaves the
  /// tombstone this observes. It can never do neither.
  private static func registerTaskUnlessCancelled(
    _ task: URLSessionTask,
    requestId: String?
  ) -> Bool {
    guard let requestId, !requestId.isEmpty else { return true }
    taskLock.lock()
    defer { taskLock.unlock() }

    if cancelledRequestIds.remove(requestId) != nil {
      return false
    }

    tasksByRequestId[requestId] = task
    return true
  }

  private static func releaseTask(requestId: String?) {
    guard let requestId, !requestId.isEmpty else { return }
    taskLock.lock()
    tasksByRequestId.removeValue(forKey: requestId)
    taskLock.unlock()
  }

  /// True when a cancel arrived for this id before the task existed.
  private static func consumeEarlyCancel(_ requestId: String?) -> Bool {
    guard let requestId, !requestId.isEmpty else { return false }
    taskLock.lock()
    let wasCancelled = cancelledRequestIds.remove(requestId) != nil
    taskLock.unlock()
    return wasCancelled
  }

  /// Aborts one in-flight request. Safe for an id that already finished.
  @objc(cancelMtlsRequest:resolve:reject:)
  func cancelMtlsRequest(
    _ requestId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    // Lookup and tombstone share one acquisition of the lock. Taking it twice left a
    // gap in which a request could register between the two, ending up with both a
    // live task and a tombstone: the task resumed and the tombstone was never consumed.
    Self.taskLock.lock()
    let task = Self.tasksByRequestId.removeValue(forKey: requestId)
    if task == nil {
      Self.cancelledRequestIds.insert(requestId)
      // Bounded: an entry only lives until its request reaches registration.
      if Self.cancelledRequestIds.count > 256 { Self.cancelledRequestIds.removeAll() }
    }
    Self.taskLock.unlock()

    task?.cancel()
    resolve(task != nil)
  }

  /// Explicit escape hatch for JS. The three methods that change the stored identity
  /// — generateCSR, storeCertificate, clearCertificates — already tear the session
  /// down themselves, so callers do not have to remember to. This exists for paths
  /// that invalidate the identity some other way.
  @objc(invalidateMtlsSession:reject:)
  func invalidateMtlsSession(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Self.tearDownSharedSession()
    resolve(nil)
  }

  // MARK: - mTLS Requests
  @objc(performMtlsRequest:requestId:method:headers:body:resolve:reject:)
  func performMtlsRequest(
    _ urlString: String,
    requestId: String?,
    method: String?,
    headers: NSDictionary?,
    body: Any?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      let httpMethod = (method ?? "GET").uppercased()

      // A caller that aborted between dispatch and here must not open a socket.
      if Self.consumeEarlyCancel(requestId) {
        reject("MTLS_CANCELLED", "Request was cancelled", nil)
        return
      }

      guard let url = URL(string: urlString) else {
        reject("INVALID_URL", "Invalid URL: \(urlString)", nil)
        return
      }

      guard MtlsTransportPolicy.isApprovedHTTPURL(urlString) else {
        reject("UNAPPROVED_DESTINATION", "HTTP destination is not approved", nil)
        return
      }

      guard self.getPrivateKeyFromKeychain() != nil else {
        reject("NO_PRIVATE_KEY", "No private key found. Please generate CSR first.", nil)
        return
      }

      guard let certificate = self.getCertificateFromKeychain(tag: Self.kCertificateTag) else {
        reject("NO_CERTIFICATE", "No certificate found. Please complete enrollment first.", nil)
        return
      }

      guard let identity = self.getCertificateIdentity(tag: Self.kCertificateTag) else {
        NSLog("[CertificateModule] Failed to retrieve identity for mTLS. Key and cert may not be properly paired.")
        reject("NO_IDENTITY", "Failed to retrieve identity from stored certificate and key.", nil)
        return
      }

      var request = URLRequest(url: url)
      request.httpMethod = httpMethod

      if let headerDict = headers as? [String: Any] {
        headerDict.forEach { key, value in
          request.setValue(String(describing: value), forHTTPHeaderField: key)
        }
      }

      // Handle body - can be String (regular JSON/text) or Dictionary (FormData)
      if let bodyDict = body as? [String: Any],
         let isFormData = bodyDict["formData"] as? Bool, isFormData {
        // Build multipart/form-data body from FormData payload
        do {
          request.httpBody = try self.buildMultipartBody(from: bodyDict)
        } catch {
          reject("FORM_DATA_ERROR", error.localizedDescription, error)
          return
        }
        // Content-Type will be set with multipart boundary
        if let contentType = self.generateMultipartContentType() {
           request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
      } else if let bodyString = body as? String {
        if let multipartPayload = self.multipartPayload(fromSerializedBody: bodyString) {
          do {
            request.httpBody = try self.buildMultipartBody(from: multipartPayload)
          } catch {
            reject("FORM_DATA_ERROR", error.localizedDescription, error)
            return
          }
          if let contentType = self.generateMultipartContentType() {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
          }
        } else {
          request.httpBody = bodyString.data(using: .utf8)
          if request.value(forHTTPHeaderField: "Content-Type") == nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
          }
        }
      }

      let session = Self.mtlsSession(identity: identity, certificate: certificate)
      let task = session.dataTask(with: request) { data, response, error in
        Self.releaseTask(requestId: requestId)

        if let error = error as NSError? {
          // A cancel is an expected outcome, not a failure. A distinct code lets JS
          // drop the result silently instead of flashing an error on every keystroke.
          if error.code == NSURLErrorCancelled {
            reject("MTLS_CANCELLED", "Request was cancelled", nil)
            return
          }
          if error.code == NSURLErrorTimedOut {
            reject("MTLS_TIMEOUT", "Request timed out", error)
            return
          }
          reject("MTLS_ERROR", error.localizedDescription, error)
          return
        }

        let httpResponse = response as? HTTPURLResponse
        let statusCode = httpResponse?.statusCode ?? 0
        let headersLower = httpResponse?.allHeaderFields.reduce(into: [String: Any]()) { acc, kv in
          guard let key = kv.key as? String else { return }
          let lowerKey = key.lowercased()
          let value = String(describing: kv.value)
          if lowerKey == "set-cookie", let existing = acc[lowerKey] {
            if var cookies = existing as? [String] {
              cookies.append(value)
              acc[lowerKey] = cookies
            } else if let existingValue = existing as? String {
              acc[lowerKey] = [existingValue, value]
            }
          } else {
            acc[lowerKey] = value
          }
        } ?? [:]

        if let httpResponse {
          let responseCookies = HTTPCookie.cookies(withResponseHeaderFields: httpResponse.allHeaderFields as? [String: String] ?? [:], for: url)
          responseCookies.forEach { HTTPCookieStorage.shared.setCookie($0) }
        }

        let contentType = headersLower["content-type"] as? String ?? "unknown"

        // Parse JSON natively so the bridge transfers a structured NSDictionary/NSArray
        // instead of a large string (avoids expensive JS-side base64 decode and bridge
        // quote-escaping). Falls back to base64 for non-JSON binary responses.
        let responseData = data ?? Data()
        let structuredMax = 256 * 1024
        let hardMax = 8 * 1024 * 1024

        if responseData.count > hardMax {
          reject("MTLS_BODY_TOO_LARGE", "Response exceeded \(hardMax) bytes. Use downloadMtlsFile.", nil)
          return
        }

        let bodyValue: Any
        let isBase64: Bool
        if responseData.isEmpty {
          bodyValue = ""
          isBase64 = false
        } else if responseData.count > structuredMax {
          if let text = String(data: responseData, encoding: .utf8),
             let first = text.trimmingCharacters(in: .whitespacesAndNewlines).first,
             first == "{" || first == "[" {
            bodyValue = text
            isBase64 = false
          } else {
            bodyValue = responseData.base64EncodedString()
            isBase64 = true
          }
        } else if let jsonObject = try? JSONSerialization.jsonObject(with: responseData, options: [.allowFragments]) {
          bodyValue = jsonObject
          isBase64 = false
        } else {
          NSLog("[CertificateModule] JSON parse failed (dataLength=%d, contentType=%@), falling back to base64", responseData.count, contentType)
          bodyValue = responseData.base64EncodedString()
          isBase64 = true
        }

        let result: [String: Any] = [
          "status": statusCode,
          "ok": statusCode >= 200 && statusCode < 300,
          "headers": headersLower,
          "body": bodyValue,
          "isBase64": isBase64
        ]
        resolve(result)
      }

      // Building the request above does three keychain lookups and can take a while,
      // so a cancel very plausibly lands in that window. Registration consumes it.
      guard Self.registerTaskUnlessCancelled(task, requestId: requestId) else {
        reject("MTLS_CANCELLED", "Request was cancelled", nil)
        return
      }

      task.resume()
    }
  }

  @objc(downloadMtlsFile:destinationPath:headers:resolve:reject:)
  func downloadMtlsFile(
    _ urlString: String,
    destinationPath: String,
    headers: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .utility).async {
      guard let url = URL(string: urlString) else {
        reject("INVALID_URL", "Invalid URL: \(urlString)", nil)
        return
      }
      guard MtlsTransportPolicy.isApprovedHTTPURL(urlString) else {
        reject("UNAPPROVED_DESTINATION", "Download destination is not approved", nil)
        return
      }
      guard self.getPrivateKeyFromKeychain() != nil else {
        reject("NO_PRIVATE_KEY", "No private key found. Please generate CSR first.", nil)
        return
      }
      guard let certificate = self.getCertificateFromKeychain(tag: Self.kCertificateTag) else {
        reject("NO_CERTIFICATE", "No certificate found. Please complete enrollment first.", nil)
        return
      }
      guard let identity = self.getCertificateIdentity(tag: Self.kCertificateTag) else {
        reject("NO_IDENTITY", "Failed to retrieve identity from stored certificate and key.", nil)
        return
      }

      var request = URLRequest(url: url)
      request.httpMethod = "GET"
      request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
      request.timeoutInterval = 60 * 60 * 6
      if let headerDict = headers as? [String: Any] {
        headerDict.forEach { key, value in
          request.setValue(String(describing: value), forHTTPHeaderField: key)
        }
      }

      let destinationURL = Self.fileURL(from: destinationPath)
      let controller = MtlsFileDownloadController(
        identity: identity,
        certificate: certificate,
        caCertificate: Self.loadServerCaCertificate(),
        destinationURL: destinationURL,
        originURL: url,
        resolve: resolve,
        reject: reject
      )
      controller.start(request: request)
    }
  }

  private static func fileURL(from path: String) -> URL {
    if path.hasPrefix("file://"), let url = URL(string: path) {
      return url
    }
    return URL(fileURLWithPath: path)
  }

  private static func isLoopbackHost(_ host: String) -> Bool {
    host == "localhost" || host == "127.0.0.1" || host == "::1"
  }

  fileprivate static func isApprovedDownloadURL(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
      return false
    }
    if url.user != nil || url.password != nil {
      return false
    }
    let host = (url.host ?? "").lowercased()
    if isLoopbackHost(host) {
      return true
    }
    return scheme == "https"
  }

  fileprivate static func sameDownloadOrigin(_ left: URL, _ right: URL) -> Bool {
    left.scheme?.lowercased() == right.scheme?.lowercased()
      && left.host?.lowercased() == right.host?.lowercased()
      && (left.port ?? defaultPort(for: left.scheme)) == (right.port ?? defaultPort(for: right.scheme))
  }

  private static func defaultPort(for scheme: String?) -> Int {
    scheme?.lowercased() == "https" ? 443 : 80
  }

  @objc(performMtlsMultipartUpload:fields:files:headers:resolve:reject:)
  func performMtlsMultipartUpload(
    _ urlString: String,
    fields: NSDictionary?,
    files: NSArray?,
    headers: NSDictionary?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let filesArray = files as? [[String: Any]] else {
        reject("FORM_DATA_ERROR", "Invalid files payload for multipart upload", nil)
        return
      }

      let fieldPairs: [[String: Any]] = (fields as? [String: Any] ?? [:]).map { key, value in
        [
          "name": key,
          "value": String(describing: value),
        ]
      }

      let payload: [String: Any] = [
        "formData": true,
        "fields": fieldPairs,
        "files": filesArray.map { file in
          let path = (file["filePath"] as? String) ?? ""
          let fileUrl = URL(fileURLWithPath: path).absoluteString
          return [
            "fieldName": (file["fieldName"] as? String) ?? "files",
            "name": (file["fileName"] as? String) ?? "upload.bin",
            "type": (file["mimeType"] as? String) ?? "application/octet-stream",
            "uri": fileUrl,
          ]
        },
      ]

      self.performMtlsRequest(
        urlString,
        requestId: nil,
        method: "POST",
        headers: headers,
        body: payload,
        resolve: resolve,
        reject: reject
      )
    }
  }

  // Stored boundary for the current request (needed for Content-Type header)
  private var currentMultipartBoundary: String?

  // MARK: - Multipart FormData Helpers

  /**
   * Build a multipart/form-data HTTP body from a FormData payload.
   * Payload format: { formData: true, fields: [{name, value}], files: [{name, type, uri, fieldName}] }
   */
  private func multipartPayload(fromSerializedBody bodyString: String) -> [String: Any]? {
    guard let data = bodyString.data(using: .utf8),
          let rootPayload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return nil
    }

    let payload: [String: Any]
    if let jsonBody = rootPayload["jsonBody"] as? [String: Any] {
      payload = jsonBody
    } else if let jsonBodyString = rootPayload["jsonBody"] as? String,
              let jsonBodyData = jsonBodyString.data(using: .utf8),
              let jsonBodyPayload = try? JSONSerialization.jsonObject(with: jsonBodyData) as? [String: Any] {
      payload = jsonBodyPayload
    } else {
      payload = rootPayload
    }

    guard payload["formData"] as? Bool == true else {
      return nil
    }

    return payload
  }

  private func multipartBodyBuildError(_ message: String) -> NSError {
    return NSError(
      domain: "CertificateModule.Multipart",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }

  // Keep aligned with MULTIPART_HEADER_PARAMETER_MAX_LENGTH and
  // sanitizeMultipartFileName in mtlsHttpClient.ts.
  private func safeMultipartHeaderParameter(_ value: String, fallback: String) -> String {
    var result = ""
    let decomposedValue = (value.isEmpty ? fallback : value)
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .decomposedStringWithCompatibilityMapping

    for scalar in decomposedValue.unicodeScalars {
      switch scalar.value {
      case 0x0300...0x036F:
        continue
      case 9, 10, 11, 12, 13, 32:
        result.append(" ")
      case 0..<9, 14..<32, 127, 128...:
        result.append("_")
      case 34, 42, 47, 58, 60, 62, 63, 92, 124:
        result.append("_")
      default:
        result.unicodeScalars.append(scalar)
      }
    }

    while result.contains("  ") {
      result = result.replacingOccurrences(of: "  ", with: " ")
    }

    while result.contains("__") {
      result = result.replacingOccurrences(of: "__", with: "_")
    }

    let trimmed = result
      .trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return fallback
    }

    return String(trimmed.prefix(Self.multipartHeaderParameterMaxLength))
  }

  private func buildMultipartBody(from payload: [String: Any]) throws -> Data {
    let boundary = "----FormDataBoundary-\(UUID().uuidString)"
    self.currentMultipartBoundary = boundary
    var body = Data()

    let newline = "\r\n".data(using: .utf8)!
    let boundaryPrefix = "--\(boundary)\r\n".data(using: .utf8)!

    // Add fields
    if let fields = payload["fields"] as? [[String: Any]] {
      for field in fields {
        if let name = field["name"] as? String, let value = field["value"] as? String {
          let safeName = safeMultipartHeaderParameter(name, fallback: "field")
          body.append(boundaryPrefix)
          body.append("Content-Disposition: form-data; name=\"\(safeName)\"\r\n\r\n".data(using: .utf8)!)
          body.append(value.data(using: .utf8)!)
          body.append(newline)
        }
      }
    }

    // Add files
    if let files = payload["files"] as? [[String: Any]] {
      for file in files {
        if let fieldName = file["fieldName"] as? String,
           let fileName = file["name"] as? String,
           let mimeType = file["type"] as? String,
           let uriString = file["uri"] as? String,
           let fileUrl = URL(string: uriString) {
          let safeFieldName = safeMultipartHeaderParameter(fieldName, fallback: "files")
          let safeFileName = safeMultipartHeaderParameter(fileName, fallback: "upload.bin")
          body.append(boundaryPrefix)
          body.append("Content-Disposition: form-data; name=\"\(safeFieldName)\"; filename=\"\(safeFileName)\"\r\n".data(using: .utf8)!)
          body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)

          guard let fileData = try? Data(contentsOf: fileUrl) else {
            let message = "Failed to read multipart file at \(fileUrl.absoluteString)"
            NSLog("[CertificateModule] %@", message)
            throw multipartBodyBuildError(message)
          }
          body.append(fileData)
          body.append(newline)
        }
      }
    }

    // Final boundary
    body.append("--\(boundary)--\r\n".data(using: .utf8)!)

    return body
  }

  /**
   * Generate Content-Type header with boundary for multipart/form-data.
   */
  private func generateMultipartContentType() -> String? {
    guard let boundary = self.currentMultipartBoundary else {
      return nil
    }
    return "multipart/form-data; boundary=\(boundary)"
  }

  // MARK: - Private Key Operations

  private func generatePrivateKey() throws -> SecKey {
    let tag = Self.kPrivateKeyTag.data(using: .utf8)!

    // Key usage attributes
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: Self.kKeySize,
      kSecAttrLabel as String: Self.kPrivateKeyTag,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag,
        kSecAttrLabel as String: Self.kPrivateKeyTag,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        kSecAttrCanSign as String: true,
        kSecAttrCanVerify as String: true,
        kSecAttrCanDerive as String: true
      ]
    ]

    var error: Unmanaged<CFError>?
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw error!.takeRetainedValue() as Error
    }

    return privateKey
  }

  private func getPrivateKeyFromKeychain() -> SecKey? {
    let tag = Self.kPrivateKeyTag.data(using: .utf8)!
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
      NSLog("[CertificateModule] Expected SecKey, got different type")
      return nil
    }

    return (foundItem as! SecKey)
  }

  private func deletePrivateKeyFromKeychain() {
    let tag = Self.kPrivateKeyTag.data(using: .utf8)!
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag
    ]
    SecItemDelete(query as CFDictionary)
  }

  // MARK: - Certificate Operations

  private func storeCertificateInKeychain(certificate: SecCertificate, tag: String) throws {
    let certData = SecCertificateCopyData(certificate) as Data

    // Delete by label
    let deleteByLabel: [String: Any] = [
      kSecClass as String: kSecClassCertificate,
      kSecAttrLabel as String: tag
    ]
    _ = SecItemDelete(deleteByLabel as CFDictionary)

    // Delete by data (in case label doesn't match)
    let deleteByData: [String: Any] = [
      kSecClass as String: kSecClassCertificate,
      kSecValueData as String: certData
    ]
    _ = SecItemDelete(deleteByData as CFDictionary)

    // Also delete any identities that might be bound to this label
    let deleteIdentity: [String: Any] = [
      kSecClass as String: kSecClassIdentity,
      kSecAttrLabel as String: tag
    ]
    _ = SecItemDelete(deleteIdentity as CFDictionary)

    // Now add the certificate
    let addQuery: [String: Any] = [
      kSecClass as String: kSecClassCertificate,
      kSecValueRef as String: certificate,
      kSecAttrLabel as String: tag,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
    ]

    var status = SecItemAdd(addQuery as CFDictionary, nil)

    if status == errSecDuplicateItem {
      let deleteExisting: [String: Any] = [
        kSecClass as String: kSecClassCertificate,
        kSecAttrLabel as String: tag
      ]
      SecItemDelete(deleteExisting as CFDictionary)
      status = SecItemAdd(addQuery as CFDictionary, nil)

      if status == errSecDuplicateItem {
        return
      }
    }

    guard status == errSecSuccess else {
      let errorMsg = "Failed to store certificate (status: \(status))"
      throw NSError(domain: "CertificateModule", code: Int(status), userInfo: [NSLocalizedDescriptionKey: errorMsg])
    }

    guard getCertificateIdentity(tag: tag) != nil else {
      let errorMsg = "Failed to create identity from stored certificate and key (tag: \(tag))"
      throw NSError(domain: "CertificateModule", code: -1, userInfo: [NSLocalizedDescriptionKey: errorMsg])
    }
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
      NSLog("[CertificateModule] Expected SecCertificate, got different type")
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
      NSLog("[CertificateModule] Failed to fetch identity for tag \(tag) (status: \(status))")
      return nil
    }

    guard let foundItem = item, CFGetTypeID(foundItem) == SecIdentityGetTypeID() else {
      NSLog("[CertificateModule] Expected SecIdentity, got different type")
      return nil
    }

    return (foundItem as! SecIdentity)
  }

  private func deleteCertificateFromKeychain(tag: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassCertificate,
      kSecAttrLabel as String: tag
    ]
    _ = SecItemDelete(query as CFDictionary)

    // Also delete any identities bound to this label
    let identityQuery: [String: Any] = [
      kSecClass as String: kSecClassIdentity,
      kSecAttrLabel as String: tag
    ]
    SecItemDelete(identityQuery as CFDictionary)
  }

  private func parseCertificate(pem: String) throws -> SecCertificate {
    let base64 = pem
      .replacingOccurrences(of: "-----BEGIN CERTIFICATE-----", with: "")
      .replacingOccurrences(of: "-----END CERTIFICATE-----", with: "")
      .replacingOccurrences(of: "\n", with: "")
      .replacingOccurrences(of: "\r", with: "")

    guard let data = Data(base64Encoded: base64),
          let certificate = SecCertificateCreateWithData(nil, data as CFData) else {
      throw NSError(domain: "CertificateModule", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to parse certificate"])
    }

    return certificate
  }

  // MARK: - PKCS#10 CSR Creation

  private func createPKCS10CSR(privateKey: SecKey, publicKey: SecKey, subject: String) throws -> Data {
    // Get public key data (X9.63 format for EC keys)
    guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
      throw NSError(domain: "CertificateModule", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to get public key data"])
    }

    // Build PKCS#10 CSR components using PKCS10Builder
    let subjectDN = try PKCS10Builder.buildSubjectDN(subject: subject)
    let publicKeyInfo = try PKCS10Builder.buildPublicKeyInfo(publicKeyData: publicKeyData)
    let certRequestInfo = try PKCS10Builder.buildCertificationRequestInfo(subject: subjectDN, publicKeyInfo: publicKeyInfo)

    // Sign the CertificationRequestInfo with SHA-384
    guard let signature = signData(data: certRequestInfo, privateKey: privateKey) else {
      throw NSError(domain: "CertificateModule", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to sign CSR"])
    }

    // Build signature algorithm identifier
    let signatureAlgorithm = PKCS10Builder.buildSignatureAlgorithm()

    // Build final PKCS#10 CSR
    let csr = try PKCS10Builder.buildPKCS10(certRequestInfo: certRequestInfo, signatureAlgorithm: signatureAlgorithm, signature: signature)

    return csr
  }

  private func signData(data: Data, privateKey: SecKey) -> Data? {
    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
      privateKey,
      .ecdsaSignatureMessageX962SHA384,
      data as CFData,
      &error
    ) as Data? else {
      if let err = error {
        NSLog("[CertificateModule] Signature error: \(err.takeRetainedValue())")
      }
      return nil
    }
    return signature
  }

  // MARK: - Helper Methods

  private func getDeviceInfo() -> [String: Any] {
    let deviceFingerprint = generateDeviceId()
    let deviceName = UIDevice.current.name

    return [
      "device_name": deviceName,
      "platform": "MOBILE",
      "os_type": "iOS",
      "os_version": UIDevice.current.systemVersion,
      "device_fingerprint": deviceFingerprint
    ]
  }

  private func generateDeviceId() -> String {
    let deviceIdSource = "\(UIDevice.current.name)-\(UIDevice.current.identifierForVendor?.uuidString ?? "unknown")"
    guard let data = deviceIdSource.data(using: .utf8) else {
      return "unknown"
    }

    var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    data.withUnsafeBytes {
      _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash)
    }

    return hash.map { String(format: "%02x", $0) }.joined().prefix(32).description
  }

  private func convertToPEM(data: Data, type: String) -> String {
    let base64 = data.base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed])
    let base64WithNewline = base64.hasSuffix("\n") ? base64 : base64 + "\n"
    return "-----BEGIN \(type)-----\n\(base64WithNewline)-----END \(type)-----\n"
  }

  private func getCertificateInfo(certificate: SecCertificate) -> [String: String]? {
    var info: [String: String] = [:]

    if let summary = SecCertificateCopySubjectSummary(certificate) as String? {
      info["subject"] = summary
    }

    return info.isEmpty ? nil : info
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  // MARK: - CA Loading
  private static func loadServerCaCertificate() -> SecCertificate? {
    let env = resolveEnv()
    let pem =
      env.contains("sandbox")
        ? kServerCaPemSandbox
        : kServerCaPemProd

    guard let data = pem.data(using: .utf8) else {
      NSLog("[CertificateModule] Failed to load trusted CA certificate from inline PEM")
      return nil
    }
    return SecCertificateCreateWithData(nil, data as CFData)
  }

  private static func resolveEnv() -> String {
    let envDict = ProcessInfo.processInfo.environment
    let rawEnv = envDict["APP_ENV"] ?? ""
    return rawEnv.lowercased()
  }
}

// MARK: - URLSession Delegate for mTLS
private class MtlsURLSessionDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
  private let identity: SecIdentity
  private let certificate: SecCertificate
  private let trustAll: Bool
  private let caCertificate: SecCertificate?

  init(identity: SecIdentity, certificate: SecCertificate, trustAll: Bool, caCertificate: SecCertificate?) {
    self.identity = identity
    self.certificate = certificate
    self.trustAll = trustAll
    self.caCertificate = caCertificate
    super.init()
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    guard let redirectURL = request.url,
          MtlsTransportPolicy.isApprovedHTTPURL(redirectURL.absoluteString) else {
      NSLog("[MtlsDelegate] Rejecting redirect outside the approved origin")
      completionHandler(nil)
      return
    }
    completionHandler(request)
  }

  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    guard let challengeURL = approvedChallengeURL(challenge.protectionSpace),
          MtlsTransportPolicy.isApprovedHTTPURL(challengeURL) else {
      completionHandler(.performDefaultHandling, nil)
      return
    }

    switch challenge.protectionSpace.authenticationMethod {
    case NSURLAuthenticationMethodClientCertificate:
      let credential = URLCredential(identity: identity, certificates: [certificate], persistence: .forSession)
      completionHandler(.useCredential, credential)

    case NSURLAuthenticationMethodServerTrust:
      guard let trust = challenge.protectionSpace.serverTrust else {
        completionHandler(.performDefaultHandling, nil)
        return
      }

      if trustAll {
        completionHandler(.useCredential, URLCredential(trust: trust))
        return
      }

      if let ca = caCertificate, evaluateServerTrust(trust, anchor: ca) {
        completionHandler(.useCredential, URLCredential(trust: trust))
        return
      }

      completionHandler(.performDefaultHandling, nil)

    default:
      completionHandler(.performDefaultHandling, nil)
    }
  }

  private func approvedChallengeURL(_ protectionSpace: URLProtectionSpace) -> String? {
    guard let scheme = protectionSpace.protocol?.lowercased(),
          let host = protectionSpace.host.nonEmpty else {
      return nil
    }
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    if protectionSpace.port > 0 {
      components.port = protectionSpace.port
    }
    return components.url?.absoluteString
  }

  private func evaluateServerTrust(_ serverTrust: SecTrust, anchor: SecCertificate) -> Bool {
    SecTrustSetAnchorCertificates(serverTrust, [anchor] as CFArray)
    SecTrustSetAnchorCertificatesOnly(serverTrust, true)
    var error: CFError?
    let ok = SecTrustEvaluateWithError(serverTrust, &error)
    if let error = error {
      NSLog("[MtlsDelegate] Server trust eval error: \(error)")
    }
    return ok
  }
}

private final class MtlsFileDownloadController: NSObject, URLSessionDelegate, URLSessionDownloadDelegate {
  private let identity: SecIdentity
  private let certificate: SecCertificate
  private let caCertificate: SecCertificate?
  private let destinationURL: URL
  private let originURL: URL
  private let resolve: RCTPromiseResolveBlock
  private let reject: RCTPromiseRejectBlock
  private var session: URLSession?
  private var selfRetain: MtlsFileDownloadController?
  private var settled = false
  private let lock = NSLock()

  init(
    identity: SecIdentity,
    certificate: SecCertificate,
    caCertificate: SecCertificate?,
    destinationURL: URL,
    originURL: URL,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    self.identity = identity
    self.certificate = certificate
    self.caCertificate = caCertificate
    self.destinationURL = destinationURL
    self.originURL = originURL
    self.resolve = resolve
    self.reject = reject
    super.init()
  }

  func start(request: URLRequest) {
    selfRetain = self
    let configuration = URLSessionConfiguration.default
    configuration.httpShouldSetCookies = true
    configuration.httpCookieAcceptPolicy = .always
    configuration.httpCookieStorage = HTTPCookieStorage.shared
    configuration.timeoutIntervalForRequest = 120
    configuration.timeoutIntervalForResource = 60 * 60 * 6
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    self.session = session
    session.downloadTask(with: request).resume()
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    guard let redirectURL = request.url,
          CertificateModule.isApprovedDownloadURL(redirectURL),
          Self.isSameOrigin(originURL, redirectURL),
          MtlsTransportPolicy.isApprovedHTTPURL(redirectURL.absoluteString) else {
      NSLog("[MtlsFileDownloadController] Rejecting redirect outside the approved origin")
      completionHandler(nil)
      return
    }

    var nextRequest = request
    if let originalURL = task.originalRequest?.url,
       !CertificateModule.sameDownloadOrigin(originalURL, redirectURL) {
      nextRequest.setValue(nil, forHTTPHeaderField: "Authorization")
      nextRequest.setValue(nil, forHTTPHeaderField: "Cookie")
    }
    completionHandler(nextRequest)
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard let challengeURL = approvedChallengeURL(challenge.protectionSpace),
          let challengeURLValue = URL(string: challengeURL),
          Self.isSameOrigin(originURL, challengeURLValue),
          MtlsTransportPolicy.isApprovedHTTPURL(challengeURL) else {
      completionHandler(.performDefaultHandling, nil)
      return
    }

    switch challenge.protectionSpace.authenticationMethod {
    case NSURLAuthenticationMethodClientCertificate:
      let credential = URLCredential(identity: identity, certificates: [certificate], persistence: .forSession)
      completionHandler(.useCredential, credential)
    case NSURLAuthenticationMethodServerTrust:
      guard let trust = challenge.protectionSpace.serverTrust else {
        completionHandler(.performDefaultHandling, nil)
        return
      }
      if let ca = caCertificate, evaluateServerTrust(trust, anchor: ca) {
        completionHandler(.useCredential, URLCredential(trust: trust))
        return
      }
      completionHandler(.performDefaultHandling, nil)
    default:
      completionHandler(.performDefaultHandling, nil)
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    let httpResponse = downloadTask.response as? HTTPURLResponse
    let statusCode = httpResponse?.statusCode ?? 0
    let headers = Self.normalizedHeaders(httpResponse)
    let mimeType = httpResponse?.mimeType
    let fileManager = FileManager.default

    if let httpResponse {
      let cookies = HTTPCookie.cookies(
        withResponseHeaderFields: httpResponse.allHeaderFields as? [String: String] ?? [:],
        for: httpResponse.url ?? destinationURL
      )
      cookies.forEach { HTTPCookieStorage.shared.setCookie($0) }
    }

    if statusCode < 200 || statusCode >= 300 {
      let preview = Self.readPrefix(from: location, limit: 16 * 1024)
      finish(result: [
        "status": statusCode,
        "ok": false,
        "uri": NSNull(),
        "size": 0,
        "mimeType": mimeType as Any,
        "errorBody": preview,
        "headers": headers,
      ])
      return
    }

    do {
      try fileManager.createDirectory(
        at: destinationURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      if fileManager.fileExists(atPath: destinationURL.path) {
        try fileManager.removeItem(at: destinationURL)
      }
      try fileManager.moveItem(at: location, to: destinationURL)
      let size = (try fileManager.attributesOfItem(atPath: destinationURL.path)[.size] as? NSNumber)?.int64Value ?? 0
      finish(result: [
        "status": statusCode,
        "ok": true,
        "uri": destinationURL.absoluteString,
        "size": size,
        "mimeType": mimeType as Any,
        "errorBody": "",
        "headers": headers,
      ])
    } catch {
      finish(errorCode: "MTLS_DOWNLOAD_ERROR", message: error.localizedDescription, error: error)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error {
      finish(errorCode: "MTLS_DOWNLOAD_ERROR", message: error.localizedDescription, error: error)
    }
    session.finishTasksAndInvalidate()
  }

  private func evaluateServerTrust(_ serverTrust: SecTrust, anchor: SecCertificate) -> Bool {
    SecTrustSetAnchorCertificates(serverTrust, [anchor] as CFArray)
    SecTrustSetAnchorCertificatesOnly(serverTrust, true)
    var error: CFError?
    return SecTrustEvaluateWithError(serverTrust, &error)
  }

  private func approvedChallengeURL(_ protectionSpace: URLProtectionSpace) -> String? {
    guard let scheme = protectionSpace.protocol?.lowercased(),
          let host = protectionSpace.host.nonEmpty else {
      return nil
    }
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    if protectionSpace.port > 0 {
      components.port = protectionSpace.port
    }
    return components.url?.absoluteString
  }

  private static func isSameOrigin(_ first: URL, _ second: URL) -> Bool {
    guard let firstComponents = URLComponents(url: first, resolvingAgainstBaseURL: false),
          let secondComponents = URLComponents(url: second, resolvingAgainstBaseURL: false),
          let firstScheme = firstComponents.scheme?.lowercased(),
          let secondScheme = secondComponents.scheme?.lowercased(),
          let firstHost = firstComponents.host?.lowercased(),
          let secondHost = secondComponents.host?.lowercased() else {
      return false
    }
    let firstPort = firstComponents.port ?? (firstScheme == "http" ? 80 : 443)
    let secondPort = secondComponents.port ?? (secondScheme == "http" ? 80 : 443)
    return firstScheme == secondScheme && firstHost == secondHost && firstPort == secondPort
  }

  private func finish(result: [String: Any]) {
    lock.lock()
    defer { lock.unlock() }
    guard !settled else { return }
    settled = true
    resolve(result)
    selfRetain = nil
  }

  private func finish(errorCode: String, message: String, error: Error) {
    lock.lock()
    defer { lock.unlock() }
    guard !settled else { return }
    settled = true
    reject(errorCode, message, error)
    selfRetain = nil
  }

  private static func normalizedHeaders(_ response: HTTPURLResponse?) -> [String: String] {
    guard let response else { return [:] }
    var headers: [String: String] = [:]
    response.allHeaderFields.forEach { key, value in
      guard let name = key as? String else { return }
      headers[name.lowercased()] = String(describing: value)
    }
    return headers
  }

  private static func readPrefix(from url: URL, limit: Int) -> String {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return "" }
    defer { try? handle.close() }
    let data = handle.readData(ofLength: limit)
    return String(data: data, encoding: .utf8) ?? ""
  }
}

private extension String {
  var nonEmpty: String? { isEmpty ? nil : self }
}
