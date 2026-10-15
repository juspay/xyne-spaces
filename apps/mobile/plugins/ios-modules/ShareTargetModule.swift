import Foundation

@objc(LotusShareTargetModule)
final class LotusShareTargetModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  private static let shareIdPattern = try! NSRegularExpression(
    pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
  )

  private var appGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "AppGroupIdentifier") as? String
  }

  private func pendingDir() throws -> URL {
    guard
      let appGroup,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    else {
      throw NSError(domain: "LotusShareTarget", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing App Group"])
    }
    return container.appendingPathComponent("share-target/pending", isDirectory: true)
  }

  private func isValidShareId(_ value: String) -> Bool {
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return Self.shareIdPattern.firstMatch(in: value, options: [], range: range) != nil
  }

  private func clearShareFiles(_ shareId: String? = nil) throws {
    let dir = try pendingDir()
    let root = dir.deletingLastPathComponent()
    let target = shareId.map { root.appendingPathComponent($0, isDirectory: true) } ?? root
    if FileManager.default.fileExists(atPath: target.path) {
      try FileManager.default.removeItem(at: target)
    }
  }

  @objc(getInitialShare:resolver:rejecter:)
  func getInitialShare(_ shareId: String?, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    do {
      let dir = try pendingDir()
      let id: String
      if let shareId, !shareId.isEmpty {
        guard isValidShareId(shareId) else {
          resolve(nil)
          return
        }
        id = shareId
      } else {
        let latest = dir.appendingPathComponent("latest.txt")
        guard let data = FileManager.default.contents(atPath: latest.path),
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else {
          resolve(nil)
          return
        }
        guard isValidShareId(value) else {
          resolve(nil)
          return
        }
        id = value
      }

      let file = dir.appendingPathComponent("\(id).json")
      guard let data = FileManager.default.contents(atPath: file.path) else {
        resolve(nil)
        return
      }
      let json = try JSONSerialization.jsonObject(with: data, options: [])
      resolve(json)
    } catch {
      reject("SHARE_READ_FAILED", error.localizedDescription, error)
    }
  }

  @objc(clearShare:resolver:rejecter:)
  func clearShare(_ shareId: String?, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    do {
      guard let shareId, !shareId.isEmpty else {
        resolve(true)
        return
      }
      guard isValidShareId(shareId) else {
        resolve(false)
        return
      }
      let dir = try pendingDir()
      try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(shareId).json"))
      try? clearShareFiles(shareId)

      let latest = dir.appendingPathComponent("latest.txt")
      if let data = FileManager.default.contents(atPath: latest.path),
         let latestId = String(data: data, encoding: .utf8),
         latestId == shareId {
        try? FileManager.default.removeItem(at: latest)
      }
      resolve(true)
    } catch {
      reject("SHARE_CLEAR_FAILED", error.localizedDescription, error)
    }
  }

  @objc(clearAllPendingShares:rejecter:)
  func clearAllPendingShares(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    do {
      try clearShareFiles()
      resolve(true)
    } catch {
      reject("SHARE_CLEAR_ALL_FAILED", error.localizedDescription, error)
    }
  }
}
