import Foundation
import React

@objc(AuthContextModule)
final class SharedAuthTokenModule: NSObject {
    @objc
    static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(getAuthContextStorageVersion:reject:)
    func getAuthContextStorageVersion(
        _ resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(2)
    }

    @objc(setAuthContext:apiBaseUrl:resolve:reject:)
    func setAuthContext(
        _ authToken: String,
        apiBaseUrl: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        do {
            try SharedAuthTokenKeychain.write(token: authToken)
            resolve(true)
        } catch {
            reject("SHARED_AUTH_WRITE_FAILED", error.localizedDescription, error)
        }
    }

    @objc(clearAuthContext:reject:)
    func clearAuthContext(
        _ resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        do {
            try SharedAuthTokenKeychain.clear()
            resolve(true)
        } catch {
            reject("SHARED_AUTH_CLEAR_FAILED", error.localizedDescription, error)
        }
    }
}
