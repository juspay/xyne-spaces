//
//  Atomic.swift
//  BroadcastExtension
//
//  Thread-safe atomic wrapper
//

import Foundation

@propertyWrapper
final class Atomic<T> {
    private var value: T
    private let lock = NSLock()

    init(wrappedValue: T) {
        self.value = wrappedValue
    }

    var wrappedValue: T {
        get {
            lock.lock()
            defer { lock.unlock() }
            return value
        }
        set {
            lock.lock()
            defer { lock.unlock() }
            value = newValue
        }
    }
}