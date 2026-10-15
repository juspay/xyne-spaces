import Foundation
import Security

/// Shared by the app and NotificationService extension through the explicitly
/// provisioned keychain access group. This is intentionally separate from the
/// app-only SecureStore item: the extension must be able to read it while the
/// device is locked after first unlock.
enum SharedAuthTokenKeychain {
    private static let service = "net.juspay.xynespaces.background-auth"
    private static let account = "session"
    private static let accessGroup = "__KEYCHAIN_ACCESS_GROUP__"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    static func write(token: String) throws {
        guard !token.isEmpty else {
            throw NSError(
                domain: "SharedAuthTokenKeychain",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Auth token must not be empty"]
            )
        }

        let attributes: [String: Any] = [
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        // Replace in place so an extension reading during token refresh never
        // observes the delete/add gap. Only a genuinely absent item permits an
        // insert; other Keychain failures must propagate to auth cleanup.
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw NSError(
                domain: NSOSStatusErrorDomain,
                code: Int(updateStatus),
                userInfo: [NSLocalizedDescriptionKey: "Unable to replace shared auth token"]
            )
        }

        let query = baseQuery.merging(attributes) { _, replacement in replacement }
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(
                domain: NSOSStatusErrorDomain,
                code: Int(status),
                userInfo: [NSLocalizedDescriptionKey: "Unable to store shared auth token"]
            )
        }
    }

    static func read() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty
        else {
            return nil
        }
        return token
    }

    static func clear() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(
                domain: NSOSStatusErrorDomain,
                code: Int(status),
                userInfo: [NSLocalizedDescriptionKey: "Unable to clear shared auth token"]
            )
        }
    }
}
