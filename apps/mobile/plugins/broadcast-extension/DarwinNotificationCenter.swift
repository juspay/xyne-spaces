//
//  DarwinNotificationCenter.swift
//  Broadcast Extension
//

import Foundation

enum DarwinNotification: String {
    case broadcastStarted = "group.net.juspay.xynespaces.broadcast.started"
    case broadcastStopped = "group.net.juspay.xynespaces.broadcast.stopped"
}

class DarwinNotificationCenter {

    static let shared = DarwinNotificationCenter()

    private let notificationCenter: CFNotificationCenter

    init() {
        notificationCenter = CFNotificationCenterGetDarwinNotifyCenter()
    }

    func postNotification(_ name: DarwinNotification) {
        CFNotificationCenterPostNotification(notificationCenter, CFNotificationName(rawValue: name.rawValue as CFString), nil, nil, true)
    }
}