//
//  MtlsHTTPRequestHandler.swift
//  Lotus
//
//  RCTURLRequestHandler that uses mTLS (client certificate) for HTTPS requests
//  to the protected host (app.spaces.xyne.juspay.net).
//  Higher priority than RCTHTTPRequestHandler so it handles these requests first.
//

import Foundation
import React
import Security

private let kProtectedHost = "app.spaces.xyne.juspay.net"
private let kIdentityTag = "ClientIdentity"

private let kServerCaPemProd = """
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

@objc(MtlsHTTPRequestHandler)
class MtlsHTTPRequestHandler: NSObject, RCTURLRequestHandler, RCTInvalidating {

  @objc
  static func moduleName() -> String {
    "MtlsHTTPRequestHandler"
  }

  func invalidate() {
    // Per-request sessions are retained by their delegates; nothing to invalidate
  }

  func canHandle(_ request: URLRequest) -> Bool {
    guard let url = request.url else { return false }
    guard url.scheme?.lowercased() == "https" else { return false }
    guard let host = url.host?.lowercased(), host == kProtectedHost else { return false }
    return Self.getCertificateIdentity() != nil
  }

  func handlerPriority() -> Float {
    1
  }

  func send(_ request: URLRequest, with delegate: RCTURLRequestDelegate) -> Any {
    guard let identity = Self.getCertificateIdentity() else {
      let error = NSError(
        domain: "MtlsHTTPRequestHandler",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "No client certificate found"]
      )
      delegate.urlRequest(request as Any, didCompleteWithError: error)
      return request
    }

    var certificateRef: SecCertificate?
    let certStatus = SecIdentityCopyCertificate(identity, &certificateRef)
    guard certStatus == errSecSuccess, let certificate = certificateRef else {
      let error = NSError(
        domain: "MtlsHTTPRequestHandler",
        code: Int(certStatus),
        userInfo: [NSLocalizedDescriptionKey: "Failed to read client certificate"]
      )
      delegate.urlRequest(request as Any, didCompleteWithError: error)
      return request
    }

    let mtlsDelegate = MtlsHTTPDelegate(
      identity: identity,
      certificate: certificate,
      caCertificate: Self.loadServerCaCertificate(),
      rctDelegate: delegate
    )

    let config = URLSessionConfiguration.default
    config.httpShouldSetCookies = true
    config.httpCookieAcceptPolicy = .always
    config.httpCookieStorage = HTTPCookieStorage.shared

    let session = URLSession(configuration: config, delegate: mtlsDelegate, delegateQueue: nil)
    mtlsDelegate.session = session
    let task = session.dataTask(with: request)
    task.resume()
    return task
  }

  func cancelRequest(_ requestToken: Any) {
    (requestToken as? URLSessionDataTask)?.cancel()
  }

  private static func getCertificateIdentity() -> SecIdentity? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassIdentity,
      kSecAttrLabel as String: kIdentityTag,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnRef as String: true,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let item else { return nil }
    return unsafeBitCast(item, to: SecIdentity.self)
  }

  private static func loadServerCaCertificate() -> SecCertificate? {
    guard let data = kServerCaPemProd.data(using: .utf8) else { return nil }
    return SecCertificateCreateWithData(nil, data as CFData)
  }
}

private class MtlsHTTPDelegate: NSObject, URLSessionDataDelegate {
  private let identity: SecIdentity
  private let certificate: SecCertificate
  private let caCertificate: SecCertificate?
  private weak var rctDelegate: RCTURLRequestDelegate?
  var session: URLSession?

  init(identity: SecIdentity, certificate: SecCertificate, caCertificate: SecCertificate?, rctDelegate: RCTURLRequestDelegate) {
    self.identity = identity
    self.certificate = certificate
    self.caCertificate = caCertificate
    self.rctDelegate = rctDelegate
    super.init()
  }

  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
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
      } else {
        completionHandler(.performDefaultHandling, nil)
      }
    default:
      completionHandler(.performDefaultHandling, nil)
    }
  }

  private func evaluateServerTrust(_ serverTrust: SecTrust, anchor: SecCertificate) -> Bool {
    SecTrustSetAnchorCertificates(serverTrust, [anchor] as CFArray)
    SecTrustSetAnchorCertificatesOnly(serverTrust, true)
    var error: CFError?
    return SecTrustEvaluateWithError(serverTrust, &error)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    rctDelegate?.urlRequest(dataTask, didReceive: response)
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    rctDelegate?.urlRequest(dataTask, didReceive: data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    rctDelegate?.urlRequest(task, didSendDataWithProgress: totalBytesSent)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    rctDelegate?.urlRequest(task, didCompleteWithError: error as NSError?)
  }
}
