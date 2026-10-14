//
//  MtlsProxyModule.swift
//  Lotus
//
//  React Native module for managing the local mTLS HTTP proxy server.
//

import Foundation
import React

@objc(MtlsProxy)
class MtlsProxyModule: NSObject {

    override init() {
        super.init()
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    func constantsToExport() -> [String: Any]! {
        return ["isAvailable": true]
    }

    /// Start the proxy server
    @objc(getProxySecurityVersion:reject:)
    func getProxySecurityVersion(
        _ resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(2)
    }

    @objc(start:apiBaseUrl:resolve:reject:)
    func start(
        port: NSNumber,
        apiBaseUrl: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        let portValue = port.uint16Value

        MtlsProxyServer.shared.start(on: portValue, allowedBaseURL: apiBaseUrl) { success, actualPort, error in
            if success {
                resolve(NSNumber(value: actualPort))
            } else {
                let errorMessage = error?.localizedDescription ?? "Unknown error"
                reject("START_ERROR", errorMessage, error)
            }
        }
    }

    /// Stop the proxy server
    @objc(stop:reject:)
    func stop(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        MtlsProxyServer.shared.stop()
        resolve(nil)
    }

    @objc(setAuthToken:resolve:reject:)
    func setAuthToken(
        _ token: String?,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock
    ) {
        MtlsProxyServer.shared.setAuthToken(token)
        resolve(nil)
    }

    /// Get the current proxy port
    @objc(getPort:reject:)
    func getPort(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let port = MtlsProxyServer.shared.getPort()
        resolve(NSNumber(value: port))
    }

    /// Get a proxied URL for a backend URL
    @objc(getProxiedUrl:resolve:reject:)
    func getProxiedUrl(backendUrl: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let proxiedUrl = MtlsProxyServer.shared.getProxiedUrl(backendUrl) else {
            reject("URL_ERROR", "Failed to create proxied URL. Is the proxy running?", nil)
            return
        }
        resolve(proxiedUrl)
    }
}
