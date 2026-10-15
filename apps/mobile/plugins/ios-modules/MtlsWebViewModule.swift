//
//  MtlsWebViewModule.swift
//  Lotus
//
//  mTLS WebView Configuration Module for iOS
//

import Foundation
import WebKit
import React

@objc(MtlsWebViewModule)
class MtlsWebViewModule: NSObject {

  private static let kPrivateKeyTag = "ClientIdentity"
  private static let kCertificateTag = "ClientIdentity"

  private static var clientIdentity: SecIdentity?
  private static var isConfigured = false

  override init() {
    super.init()
  }

  // MARK: - React Native Methods

  @objc(enableMtls:reject:)
  func enableMtls(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let privateKey = self.getPrivateKeyFromKeychain() else {
        reject("NO_PRIVATE_KEY", "Private key not found. Please generate CSR first.", nil)
        return
      }

      guard let certificate = self.getCertificateFromKeychain(tag: Self.kCertificateTag) else {
        reject("NO_CERTIFICATE", "Certificate not found. Please complete enrollment first.", nil)
        return
      }

      guard let identity = self.createIdentity(privateKey: privateKey, certificate: certificate) else {
        reject("IDENTITY_ERROR", "Failed to create identity from key and certificate", nil)
        return
      }

      var certRef: SecCertificate?
      let certStatus = SecIdentityCopyCertificate(identity, &certRef)
      if certStatus != errSecSuccess {
        NSLog("[MtlsWebViewModule] Failed to copy certificate from identity (status: \(certStatus))")
      }
      let credential = URLCredential(
        identity: identity,
        certificates: certRef != nil ? [certRef!] : nil,
        persistence: .forSession
      )
      RNCWebViewImpl.setClientAuthenticationCredential(credential)

      Self.clientIdentity = identity
      Self.isConfigured = true
      resolve(true)
    }
  }

  @objc(disableMtls:reject:)
  func disableMtls(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    RNCWebViewImpl.setClientAuthenticationCredential(nil)
    Self.clientIdentity = nil
    Self.isConfigured = false
    resolve(true)
  }

  @objc(isMtlsEnabled:reject:)
  func isMtlsEnabled(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve(Self.isConfigured)
  }

  // MARK: - Private Methods

  private func getPrivateKeyFromKeychain() -> SecKey? {
    let tag = Self.kPrivateKeyTag.data(using: .utf8)!
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    guard status == errSecSuccess else {
      return nil
    }

    return (item as! SecKey)
  }

  private func getCertificateFromKeychain(tag: String) -> SecCertificate? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassCertificate,
      kSecAttrLabel as String: tag,
      kSecReturnRef as String: true
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    guard status == errSecSuccess else {
      return nil
    }

    return (item as! SecCertificate)
  }

  private func createIdentity(privateKey: SecKey, certificate: SecCertificate) -> SecIdentity? {
    let tempLabel = "temp_webview_mtls_\(UUID().uuidString)"
    let certData = SecCertificateCopyData(certificate) as Data

    let addCertQuery: [String: Any] = [
      kSecClass as String: kSecClassCertificate,
      kSecValueData as String: certData,
      kSecAttrLabel as String: tempLabel,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
    ]

    let deleteCertQuery: [String: Any] = [
      kSecClass as String: kSecClassCertificate,
      kSecAttrLabel as String: tempLabel
    ]
    SecItemDelete(deleteCertQuery as CFDictionary)

    var status = SecItemAdd(addCertQuery as CFDictionary, nil)
    guard status == errSecSuccess || status == errSecDuplicateItem else {
      NSLog("[MtlsWebViewModule] Failed to add temp certificate: \(status)")
      SecItemDelete(deleteCertQuery as CFDictionary)
      return nil
    }

    let identityQuery: [String: Any] = [
      kSecClass as String: kSecClassIdentity,
      kSecReturnRef as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]

    var item: CFTypeRef?
    status = SecItemCopyMatching(identityQuery as CFDictionary, &item)

    SecItemDelete(deleteCertQuery as CFDictionary)

    if status == errSecSuccess, let identity = item as! SecIdentity? {
      return identity
    }

    NSLog("[MtlsWebViewModule] Could not find identity, status: \(status)")
    return nil
  }

  // MARK: - Static Methods for WKNavigationDelegate

  @objc
  static func handleAuthenticationChallenge(
    _ challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    switch challenge.protectionSpace.authenticationMethod {
    case NSURLAuthenticationMethodClientCertificate:
      guard isConfigured, let identity = clientIdentity else {
        completionHandler(.performDefaultHandling, nil)
        return
      }

      var certificate: SecCertificate?
      SecIdentityCopyCertificate(identity, &certificate)
      let credential = URLCredential(
        identity: identity,
        certificates: certificate != nil ? [certificate!] : nil,
        persistence: .forSession
      )
      completionHandler(.useCredential, credential)

    case NSURLAuthenticationMethodServerTrust:
      completionHandler(.performDefaultHandling, nil)

    default:
      completionHandler(.performDefaultHandling, nil)
    }
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }
}
