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
//  moved to another phone; the Enclave key itself is usable on the same terms. Once a tier is
//  chosen it is kept, so the public key changes only when the key itself is broken. Only the
//  public key and ECDH results leave this module.
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
    case noAccessGroup

    var description: String {
      switch self {
      case .badServerPoint:
        return "serverPoint must be a base64 65-byte uncompressed P-256 point"
      case .noSecureEnclave: return "No Secure Enclave on this device"
      case .corruptItem: return "Stored transit key is corrupt"
      case .selfCheckFailed: return "Transit key agreement self-check failed"
      case .keychain(let status): return "Keychain error \(status)"
      case .noAccessGroup: return "Cannot read this app's Keychain access group"
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
  /// The end of this app's own group, `<bundle id>.transit-key`, filled in at prebuild; the app id
  /// prefix in front of it is read at runtime (see transitKeyGroup).
  private static let groupSuffix = "__TRANSIT_KEY_GROUP_SUFFIX__"

  /// One queue for every key call, so two calls never create the key twice.
  private static let queue = DispatchQueue(label: "net.juspay.xynespaces.transit-key")

  /// The key, checked once per process; used only on `queue`.
  private static var cached: TransitKey?

  /// The full access group once resolved; used only on `queue`.
  private static var accessGroup: String?

  private static func checkedKey() throws -> TransitKey {
    if let cached { return cached }
    let key = try selectKey()
    cached = key
    return key
  }

  /// The tier is kept across launches, so the public key never changes unless the key is broken:
  /// - A Keychain key, once one exists, is used for good.
  /// - No Secure Enclave (the Simulator): the Keychain key.
  /// - Otherwise the stored Enclave key. Any failure other than the key being broken (a locked
  ///   phone, a Keychain error) fails this call with nothing cached, so the next call retries it.
  /// - With no usable Enclave key (none yet, or a broken one now deleted): a new one, else the
  ///   Keychain key, which then stays.
  private static func selectKey() throws -> TransitKey {
    if try itemExists(account: keychainAccount) || !SecureEnclave.isAvailable {
      return try keychainKey()
    }
    if let key = try storedEnclaveKey() { return key }
    do {
      return try newEnclaveKey()
    } catch {
      NSLog(
        "[TransitKey] The Secure Enclave cannot make a transit key; using a Keychain key: %@",
        describe(error))
      return try keychainKey()
    }
  }

  /// The Enclave says the key object is corrupt or gone, or agreement worked but gave the wrong
  /// secret. Never any other error from agreement: that is the phone (say, locked), not the key.
  private static func isBrokenEnclaveKey(_ error: Error) -> Bool {
    if let error = error as? TKError {
      return [.corruptedData, .objectNotFound].contains(error.code)
    }
    if case TransitKeyError.selfCheckFailed = error { return true }
    return false
  }

  /// The stored Keychain key's bytes are unreadable, or it gives the wrong secret. Its agreement
  /// runs in software, so a locked phone cannot cause either; a Keychain error never counts.
  private static func isBrokenKeychainKey(_ error: Error) -> Bool {
    if error is CryptoKitError { return true }
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

  /// The stored Enclave key once it passes the self-check; nil when there is none, or when the
  /// Enclave rejects it as broken (it is then deleted). Any other failure is thrown and the key
  /// is kept: an error from key agreement (say, on a locked phone) never deletes it.
  private static func storedEnclaveKey() throws -> TransitKey? {
    guard let handle = try readItem(account: enclaveAccount) else { return nil }
    let privateKey: SecureEnclave.P256.KeyAgreement.PrivateKey
    do {
      privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: handle)
    } catch {
      // The Enclave cannot open this handle: from another phone, or after an Enclave reset.
      NSLog(
        "[TransitKey] The Secure Enclave rejected the stored key; replacing it: %@",
        describe(error))
      try deleteItem(account: enclaveAccount)
      return nil
    }
    do {
      return try selfChecked(EnclaveKey(privateKey: privateKey))
    } catch where isBrokenEnclaveKey(error) {
      NSLog("[TransitKey] Stored Secure Enclave key is broken; replacing it: %@", describe(error))
      try deleteItem(account: enclaveAccount)
      return nil
    }
  }

  private static func newEnclaveKey() throws -> TransitKey {
    // Usable after the first unlock since boot, like the Keychain items, so a push or VoIP wake on
    // a locked phone can use it (CryptoKit's default allows only an unlocked phone). No user
    // presence, so it never prompts.
    var accessError: Unmanaged<CFError>?
    guard
      let access = SecAccessControlCreateWithFlags(
        nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, .privateKeyUsage, &accessError)
    else {
      throw accessError.map { $0.takeRetainedValue() as Error } ?? TransitKeyError.noSecureEnclave
    }
    let privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
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
      } catch where isBrokenKeychainKey(error) {
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

  /// This app's own group, `<app id prefix>.<bundle id>.transit-key`. The prefix is read at
  /// runtime: it is that of whichever team signed this build (an enterprise or CI profile too),
  /// which a team ID fixed at prebuild may not match, and every call would then fail.
  private static func transitKeyGroup() throws -> String {
    if let accessGroup { return accessGroup }
    let group = "\(try appIdentifierPrefix()).\(groupSuffix)"
    accessGroup = group
    return group
  }

  /// The app id prefix, from the group iOS gives an item saved without one: the app's default
  /// group, `<prefix>.<bundle id>`, first in its keychain-access-groups. The probe item holds no
  /// data.
  private static func appIdentifierPrefix() throws -> String {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "\(service).probe",
      kSecAttrAccount as String: "app-identifier-prefix",
      kSecReturnAttributes as String: true,
    ]
    var result: AnyObject?
    var status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound {
      query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      status = SecItemAdd(query as CFDictionary, &result)
    }
    guard status == errSecSuccess else { throw TransitKeyError.keychain(status) }
    guard let attributes = result as? [String: Any],
      let group = attributes[kSecAttrAccessGroup as String] as? String,
      let prefix = group.split(separator: ".").first
    else { throw TransitKeyError.noAccessGroup }
    return String(prefix)
  }

  private static func baseQuery(account: String) throws -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: try transitKeyGroup(),
    ]
  }

  fileprivate static func readItem(account: String) throws -> Data? {
    var query = try baseQuery(account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw TransitKeyError.keychain(status) }
    guard let data = result as? Data else { throw TransitKeyError.corruptItem }
    return data
  }

  /// Whether the item exists, without reading its data.
  private static func itemExists(account: String) throws -> Bool {
    let status = SecItemCopyMatching(try baseQuery(account: account) as CFDictionary, nil)
    if status == errSecItemNotFound { return false }
    guard status == errSecSuccess else { throw TransitKeyError.keychain(status) }
    return true
  }

  /// Replaces the item in one step when it exists, else adds it: the stored value is never
  /// deleted first, so a failed write or a killed app cannot lose it.
  private static func writeItem(account: String, data: Data) throws {
    let query = try baseQuery(account: account)
    // After the first unlock since boot, so background work can use it; never in backups and
    // never moved to another phone.
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
      // Added in between: update it instead.
      if status == errSecDuplicateItem {
        status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
      }
    }
    guard status == errSecSuccess else { throw TransitKeyError.keychain(status) }
  }

  private static func deleteItem(account: String) throws {
    let status = SecItemDelete(try baseQuery(account: account) as CFDictionary)
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
