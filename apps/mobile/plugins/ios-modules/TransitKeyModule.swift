//
//  TransitKeyModule.swift
//  Lotus
//
//  The transit key on iOS, an ECDH P-256 key that needs no user authentication (so it never
//  prompts), created on first use:
//
//  - The Secure Enclave key: ECDH runs inside the Enclave. The Enclave hands out only an
//    encrypted handle to the key, usable by this phone's Enclave alone, which is kept in the
//    Keychain. Every iPhone that runs the app has a Secure Enclave.
//  - The Keychain key, whenever the Enclave key fails (and in the Simulator, which has no
//    Enclave): a key made in software whose private key is kept in the Keychain, encrypted by
//    iOS, and read back only for each ECDH.
//
//  Both are Keychain items in an access group of their own (not the one the notification
//  extension shares), usable after the first unlock since boot, never in backups and never
//  moved to another phone. Only the public key and ECDH results leave this module.
//

import CryptoKit
import CryptoTokenKit
import Foundation
import React
import Security

/// The transit key, whichever kind it is.
private protocol TransitKey {
  /// 0x04 ‖ X ‖ Y.
  var publicPoint: Data { get }
  var storage: String { get }
  /// ECDH: the 32-byte X coordinate, big-endian, as WebCrypto and Android give it.
  func agree(_ serverKey: P256.KeyAgreement.PublicKey) throws -> Data
}

@objc(LotusTransitKey)
class TransitKeyModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  /// Resolves `{ publicKey: base64 65-byte point, storage: "secure_enclave" | "keychain" }`.
  @objc
  func getPublicKey(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Self.queue.async {
      do {
        let key = try Self.checkedKey()
        resolve(["publicKey": key.publicPoint.base64EncodedString(), "storage": key.storage])
      } catch {
        reject(Self.errorCode, Self.describe(error), error)
      }
    }
  }

  /// ECDH with a server's base64 uncompressed P-256 point; resolves the base64 32-byte secret.
  @objc
  func deriveSharedSecret(
    _ serverPoint: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Self.queue.async {
      do {
        guard let point = Data(base64Encoded: serverPoint) else {
          throw TransitKeyError.badServerPoint
        }
        var secret = try Self.checkedKey().agree(Self.serverPublicKey(point))
        defer { secret.resetBytes(in: 0..<secret.count) }
        resolve(secret.base64EncodedString())
      } catch {
        reject(Self.errorCode, Self.describe(error), error)
      }
    }
  }

  // MARK: - Keys

  private enum TransitKeyError: Error, CustomStringConvertible {
    case badServerPoint
    case noSecureEnclave
    case corruptItem
    case selfCheckFailed
    case keychain(OSStatus)

    var description: String {
      switch self {
      case .badServerPoint:
        return "serverPoint must be a base64 65-byte uncompressed P-256 point"
      case .noSecureEnclave: return "No Secure Enclave on this device"
      case .corruptItem: return "Stored transit key is corrupt"
      case .selfCheckFailed: return "Transit key agreement self-check failed"
      case .keychain(let status): return "Keychain error \(status)"
      }
    }
  }

  /// The Secure Enclave key, which runs the ECDH itself.
  private struct EnclaveKey: TransitKey {
    let privateKey: SecureEnclave.P256.KeyAgreement.PrivateKey
    var publicPoint: Data { privateKey.publicKey.x963Representation }
    let storage = "secure_enclave"

    func agree(_ serverKey: P256.KeyAgreement.PublicKey) throws -> Data {
      try privateKey.sharedSecretFromKeyAgreement(with: serverKey).withUnsafeBytes { Data($0) }
    }
  }

  /// A software key kept in the Keychain, read back for each ECDH.
  private struct KeychainKey: TransitKey {
    let publicPoint: Data
    let storage = "keychain"

    func agree(_ serverKey: P256.KeyAgreement.PublicKey) throws -> Data {
      let stored = try TransitKeyModule.readItem(account: TransitKeyModule.keychainAccount)
      guard var raw = stored else { throw TransitKeyError.corruptItem }
      defer { raw.resetBytes(in: 0..<raw.count) }
      let privateKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: raw)
      guard privateKey.publicKey.x963Representation == publicPoint else {
        throw TransitKeyError.corruptItem
      }
      return try privateKey.sharedSecretFromKeyAgreement(with: serverKey)
        .withUnsafeBytes { Data($0) }
    }
  }

  private static let errorCode = "TRANSIT_KEY_ERROR"
  private static let service = "net.juspay.xynespaces.transit-key"
  private static let enclaveAccount = "secure-enclave"
  private static let keychainAccount = "keychain"
  /// This app's own group, `<team>.<bundle id>.transit-key`, filled in at prebuild.
  private static let accessGroup = "__TRANSIT_KEY_ACCESS_GROUP__"

  /// One queue for every key call, so two calls never create the key twice.
  private static let queue = DispatchQueue(label: "net.juspay.xynespaces.transit-key")

  /// The key, checked once per process; used only on `queue`.
  private static var cached: TransitKey?

  private static func checkedKey() throws -> TransitKey {
    if let cached { return cached }
    // The Enclave key whenever it works; the Keychain key whenever it does not.
    let key: TransitKey
    do {
      key = try enclaveKey()
    } catch {
      NSLog(
        "[TransitKey] Secure Enclave key unavailable; using a Keychain key: %@", describe(error))
      key = try keychainKey()
    }
    cached = key
    return key
  }

  /// The key failed itself (unreadable, corrupt or wrong), not the Keychain around it: only
  /// then is it replaced. A Keychain error (say, before the first unlock) never deletes a key.
  private static func isKeyFailure(_ error: Error) -> Bool {
    if error is CryptoKitError { return true }
    // The Enclave refusing a stored handle (from another device, or after an Enclave reset).
    if let error = error as? TKError {
      return [.corruptedData, .objectNotFound, .badParameter].contains(error.code)
    }
    if let error = error as? TransitKeyError {
      switch error {
      case .corruptItem, .selfCheckFailed: return true
      default: return false
      }
    }
    return false
  }

  /// Runs ECDH once with a throwaway software key and checks both sides agree, so a key that
  /// cannot do key agreement is caught here, not by the server.
  private static func selfChecked(_ key: TransitKey) throws -> TransitKey {
    let probe = P256.KeyAgreement.PrivateKey()
    var ours = try key.agree(probe.publicKey)
    var theirs = try probe.sharedSecretFromKeyAgreement(with: serverPublicKey(key.publicPoint))
      .withUnsafeBytes { Data($0) }
    let matches = ours == theirs
    ours.resetBytes(in: 0..<ours.count)
    theirs.resetBytes(in: 0..<theirs.count)
    guard matches else { throw TransitKeyError.selfCheckFailed }
    return key
  }

  private static func enclaveKey() throws -> TransitKey {
    guard SecureEnclave.isAvailable else { throw TransitKeyError.noSecureEnclave }
    if let handle = try readItem(account: enclaveAccount) {
      do {
        let privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: handle)
        return try selfChecked(EnclaveKey(privateKey: privateKey))
      } catch where isKeyFailure(error) {
        NSLog(
          "[TransitKey] Stored Secure Enclave key is unusable; creating a new one: %@",
          describe(error))
        try deleteItem(account: enclaveAccount)
      }
    }
    // No access control: the key is usable without Face ID or the passcode, so it never prompts.
    let privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey()
    let key = try selfChecked(EnclaveKey(privateKey: privateKey))
    // Kept only once it has passed, so a bad key is never stored for later launches.
    try writeItem(account: enclaveAccount, data: privateKey.dataRepresentation)
    return key
  }

  private static func keychainKey() throws -> TransitKey {
    if var raw = try readItem(account: keychainAccount) {
      defer { raw.resetBytes(in: 0..<raw.count) }
      do {
        let privateKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: raw)
        let publicPoint = privateKey.publicKey.x963Representation
        return try selfChecked(KeychainKey(publicPoint: publicPoint))
      } catch where isKeyFailure(error) {
        NSLog(
          "[TransitKey] Stored Keychain key is unusable; creating a new one: %@", describe(error))
        try deleteItem(account: keychainAccount)
      }
    }
    let privateKey = P256.KeyAgreement.PrivateKey()
    var raw = privateKey.rawRepresentation
    defer { raw.resetBytes(in: 0..<raw.count) }
    try writeItem(account: keychainAccount, data: raw)
    return try selfChecked(KeychainKey(publicPoint: privateKey.publicKey.x963Representation))
  }

  // MARK: - Keychain

  private static func baseQuery(account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: accessGroup,
    ]
  }

  fileprivate static func readItem(account: String) throws -> Data? {
    var query = baseQuery(account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw TransitKeyError.keychain(status) }
    guard let data = result as? Data else { throw TransitKeyError.corruptItem }
    return data
  }

  private static func writeItem(account: String, data: Data) throws {
    try deleteItem(account: account)
    var query = baseQuery(account: account)
    query[kSecValueData as String] = data
    // After the first unlock since boot, so background work can use it; never in backups and
    // never moved to another phone.
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw TransitKeyError.keychain(status) }
  }

  private static func deleteItem(account: String) throws {
    let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw TransitKeyError.keychain(status)
    }
  }

  // MARK: - Encoding

  /// A server's 65-byte uncompressed point (0x04 ‖ X ‖ Y); one off the curve is refused.
  private static func serverPublicKey(_ point: Data) throws -> P256.KeyAgreement.PublicKey {
    guard point.count == 65, point.first == 0x04 else { throw TransitKeyError.badServerPoint }
    return try P256.KeyAgreement.PublicKey(x963Representation: point)
  }

  private static func describe(_ error: Error) -> String {
    String(describing: error)
  }
}
