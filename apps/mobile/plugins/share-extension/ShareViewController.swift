import UIKit
import UniformTypeIdentifiers

/// Passthrough share extension: copy payload → open host app → dismiss.
/// iOS requires this middle process; we keep the UI minimal so it feels closer to Android.
final class ShareViewController: UIViewController {
  private static let maxShareFileBytes: Int64 = 1024 * 1024 * 1024
  private static let maxShareFileCount = 10
  private static let copyBufferBytes = 64 * 1024

  private let appGroup = "__APP_GROUP__"
  private let urlScheme = "__URL_SCHEME__"
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let statusLabel = UILabel()
  private let openButton = UIButton(type: .system)
  private var didStart = false
  private var pendingOpenURL: URL?
  private var isErrorAcknowledgement = false

  override func viewDidLoad() {
    super.viewDidLoad()
    configureView()
    // Start ASAP — don't wait for viewDidAppear.
    startShareIfNeeded()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    startShareIfNeeded()
  }

  private func startShareIfNeeded() {
    guard !didStart else { return }
    didStart = true
    Task { await handleShare() }
  }

  private func handleShare() async {
    let shareId = UUID().uuidString
    do {
      setStatus("Opening Xyne Spaces…")
      let payload = try await collectPayload(shareId: shareId)
      let files = payload["files"] as? [[String: Any]] ?? []
      let text = (payload["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      // Don't open the host app with an empty handoff (failed file copy + no caption).
      if files.isEmpty && text.isEmpty {
        throw NSError(
          domain: "ShareExtension",
          code: 3,
          userInfo: [NSLocalizedDescriptionKey: "No shareable content"]
        )
      }
      try writePayload(payload, shareId: shareId)
      let opened = await openHostApp(shareId: shareId)
      if opened {
        completeAfterLaunch()
      } else {
        showOpenFallback(shareId: shareId)
      }
    } catch {
      let nsError = error as NSError
      if nsError.domain == "ShareExtension" && nsError.code == 7 {
        preferredContentSize = CGSize(width: UIScreen.main.bounds.width, height: 140)
        spinner.stopAnimating()
        setStatus(nsError.localizedDescription)
        pendingOpenURL = nil
        isErrorAcknowledgement = true
        openButton.setTitle("Done", for: .normal)
        openButton.isHidden = false
        return
      }
      setStatus("Could not prepare shared item.")
      extensionContext?.cancelRequest(withError: error)
    }
  }

  private func configureView() {
    // Compact sheet — avoids looking like a full secondary “preview app”.
    preferredContentSize = CGSize(width: UIScreen.main.bounds.width, height: 96)
    view.backgroundColor = .secondarySystemBackground

    spinner.translatesAutoresizingMaskIntoConstraints = false
    spinner.hidesWhenStopped = true
    spinner.startAnimating()

    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    statusLabel.text = "Opening Xyne Spaces…"
    statusLabel.textAlignment = .center
    statusLabel.textColor = .secondaryLabel
    statusLabel.numberOfLines = 2
    statusLabel.font = .preferredFont(forTextStyle: .footnote)

    openButton.translatesAutoresizingMaskIntoConstraints = false
    openButton.setTitle("Open Xyne Spaces", for: .normal)
    openButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    openButton.isHidden = true
    openButton.addTarget(self, action: #selector(openButtonTapped), for: .touchUpInside)

    let stack = UIStackView(arrangedSubviews: [spinner, statusLabel, openButton])
    stack.translatesAutoresizingMaskIntoConstraints = false
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 10

    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
  }

  private func setStatus(_ value: String) {
    statusLabel.text = value
  }

  private func collectPayload(shareId: String) async throws -> [String: Any] {
    var files: [[String: Any]] = []
    var texts: [String] = []
    var fileProviders: [NSItemProvider] = []

    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    for item in items {
      for provider in item.attachments ?? [] {
        // Remote links stay text. file:// is queued as a file so Files.app
        // paths are never inserted into the message body.
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           let url = try? await loadURL(provider) {
          if url.isFileURL {
            fileProviders.append(provider)
          } else {
            texts.append(url.absoluteString)
          }
          continue
        }

        if isConcreteFileProvider(provider) {
          fileProviders.append(provider)
          continue
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier),
           let text = try? await loadString(provider),
           !text.isEmpty,
           !isLocalFilePathText(text) {
          texts.append(text)
          continue
        }
      }
    }

    guard fileProviders.count <= Self.maxShareFileCount else {
      throw NSError(
        domain: "ShareExtension",
        code: 7,
        userInfo: [
          NSLocalizedDescriptionKey: "Select up to \(Self.maxShareFileCount) files to share at a time."
        ]
      )
    }

    for provider in fileProviders {
      // Files.app PDFs/docs often conform to public.url (file://) first.
      // Prefer a real file copy so we never send the path as message text.
      if let file = try? await copyFile(provider: provider, shareId: shareId) {
        files.append(file)
        continue
      }
      if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
         let url = try? await loadURL(provider),
         url.isFileURL,
         let file = try? await copySecurityScopedURL(url, shareId: shareId) {
        files.append(file)
      }
    }

    return [
      "id": shareId,
      "source": "ios",
      "receivedAt": Int64(Date().timeIntervalSince1970 * 1000),
      "text": texts.joined(separator: "\n"),
      "files": files
    ]
  }

  /// True when the provider advertises a payload other than a link or plain text.
  /// Conformance to public.data is not enough: text and URLs conform to it too.
  private func isConcreteFileProvider(_ provider: NSItemProvider) -> Bool {
    let skip: Set<String> = [
      UTType.url.identifier,
      UTType.fileURL.identifier,
      UTType.text.identifier,
      UTType.plainText.identifier,
      UTType.utf8PlainText.identifier,
    ]
    return provider.registeredTypeIdentifiers.contains { !skip.contains($0) }
  }

  /// Drop filesystem paths that Files.app sometimes also exposes as plain text.
  private func isLocalFilePathText(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("file:") { return true }
    if trimmed.hasPrefix("/") { return true }
    return false
  }

  private func loadURL(_ provider: NSItemProvider) async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, error in
        if let error { continuation.resume(throwing: error); return }
        if let url = item as? URL { continuation.resume(returning: url); return }
        if let str = item as? String, let url = URL(string: str) { continuation.resume(returning: url); return }
        continuation.resume(throwing: NSError(domain: "ShareExtension", code: 1))
      }
    }
  }

  private func loadString(_ provider: NSItemProvider) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: UTType.text.identifier, options: nil) { item, error in
        if let error { continuation.resume(throwing: error); return }
        continuation.resume(returning: (item as? String) ?? "")
      }
    }
  }

  /// Prefer a concrete content type over public.url / public.text (Files.app order).
  private func preferredFileTypeIdentifier(for provider: NSItemProvider) -> String {
    let skip: Set<String> = [
      UTType.url.identifier,
      UTType.fileURL.identifier,
      UTType.text.identifier,
      UTType.plainText.identifier,
      UTType.utf8PlainText.identifier,
    ]
    if let concrete = provider.registeredTypeIdentifiers.first(where: { !skip.contains($0) }) {
      return concrete
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
      return UTType.data.identifier
    }
    return provider.registeredTypeIdentifiers.first ?? UTType.data.identifier
  }

  private func copyFile(provider: NSItemProvider, shareId: String) async throws -> [String: Any] {
    let typeId = preferredFileTypeIdentifier(for: provider)
    let mimeType = UTType(typeId)?.preferredMIMEType ?? "application/octet-stream"
    return try await withCheckedThrowingContinuation { continuation in
      provider.loadFileRepresentation(forTypeIdentifier: typeId) { url, error in
        do {
          if let error { throw error }
          guard let url else { throw NSError(domain: "ShareExtension", code: 2) }
          let file = try self.storeSharedFile(at: url, shareId: shareId, mimeType: mimeType)
          continuation.resume(returning: file)
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func copySecurityScopedURL(_ url: URL, shareId: String) async throws -> [String: Any] {
    let accessed = url.startAccessingSecurityScopedResource()
    defer {
      if accessed {
        url.stopAccessingSecurityScopedResource()
      }
    }
    let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
      ?? "application/octet-stream"
    return try storeSharedFile(at: url, shareId: shareId, mimeType: mimeType)
  }

  private func storeSharedFile(
    at url: URL,
    shareId: String,
    mimeType: String
  ) throws -> [String: Any] {
    var destination: URL?
    do {
      guard !self.isAppPrivateSource(url) else {
        throw NSError(domain: "ShareExtension", code: 4, userInfo: [
          NSLocalizedDescriptionKey: "Private app files cannot be shared through this extension"
        ])
      }
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: self.appGroup)!
      let dir = container.appendingPathComponent("share-target/\(shareId)", isDirectory: true)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let displayName = url.lastPathComponent.isEmpty ? "shared-file" : url.lastPathComponent
      let storageName = self.sanitizeFileName(displayName)
      let dst = self.uniqueDestination(in: dir, name: storageName)
      destination = dst
      let size = try self.copyBoundedFile(from: url, to: dst)
      return [
        "uri": dst.absoluteString,
        "originalUri": url.absoluteString,
        "name": displayName,
        "type": mimeType,
        "size": size
      ]
    } catch {
      if let destination {
        try? FileManager.default.removeItem(at: destination)
      }
      throw error
    }
  }

  private func isAppPrivateSource(_ url: URL) -> Bool {
    let candidate = url.standardizedFileURL.resolvingSymlinksInPath().path
    let roots = [
      Bundle.main.bundleURL,
      FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
      FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
      FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first,
      FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
    ].compactMap { $0?.standardizedFileURL.resolvingSymlinksInPath().path }

    return roots.contains { root in
      candidate == root || candidate.hasPrefix("\(root)/")
    }
  }

  private func copyBoundedFile(from source: URL, to destination: URL) throws -> Int64 {
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }

    guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
      throw NSError(domain: "ShareExtension", code: 5, userInfo: [
        NSLocalizedDescriptionKey: "Unable to create shared-file cache entry"
      ])
    }
    let output = try FileHandle(forWritingTo: destination)
    defer { try? output.close() }

    var totalBytes: Int64 = 0
    while true {
      let chunk = try input.read(upToCount: Self.copyBufferBytes) ?? Data()
      if chunk.isEmpty { return totalBytes }
      totalBytes += Int64(chunk.count)
      if totalBytes > Self.maxShareFileBytes {
        throw NSError(domain: "ShareExtension", code: 6, userInfo: [
          NSLocalizedDescriptionKey: "Shared file exceeds the upload size limit"
        ])
      }
      try output.write(contentsOf: chunk)
    }
  }

  private func sanitizeFileName(_ value: String) -> String {
    let sanitized = value.replacingOccurrences(
      of: "[^A-Za-z0-9._ -]",
      with: "_",
      options: .regularExpression
    )
    guard !sanitized.isEmpty else { return "shared-file" }
    let maxLength = 180
    guard sanitized.count > maxLength else { return sanitized }

    let nsName = sanitized as NSString
    let extensionPart = nsName.pathExtension.isEmpty ? "" : ".\(nsName.pathExtension)"
    guard extensionPart.count < maxLength else {
      return String(sanitized.prefix(maxLength))
    }
    let base = nsName.deletingPathExtension
    let baseLength = max(1, maxLength - extensionPart.count)
    return "\(String(base.prefix(baseLength)))\(extensionPart)"
  }

  private func uniqueDestination(in directory: URL, name: String) -> URL {
    var candidate = directory.appendingPathComponent(name)
    if !FileManager.default.fileExists(atPath: candidate.path) {
      return candidate
    }

    let nsName = name as NSString
    let base = nsName.deletingPathExtension
    let extensionPart = nsName.pathExtension.isEmpty ? "" : ".\(nsName.pathExtension)"
    var index = 1
    repeat {
      candidate = directory.appendingPathComponent("\(base)_\(index)\(extensionPart)")
      index += 1
    } while FileManager.default.fileExists(atPath: candidate.path)
    return candidate
  }

  private func writePayload(_ payload: [String: Any], shareId: String) throws {
    let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)!
    let dir = container.appendingPathComponent("share-target/pending", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let data = try JSONSerialization.data(withJSONObject: payload, options: [])
    try data.write(to: dir.appendingPathComponent("\(shareId).json"), options: .atomic)
    try shareId.data(using: .utf8)?.write(to: dir.appendingPathComponent("latest.txt"), options: .atomic)
  }

  private func openHostApp(shareId: String) async -> Bool {
    guard let url = URL(string: "\(urlScheme)://share-target?id=\(shareId)") else { return false }
    pendingOpenURL = url

    return await openURLViaResponderChain(url)
  }

  @MainActor
  private func openURLViaResponderChain(_ url: URL) async -> Bool {
    let selector = NSSelectorFromString("openURL:")
    var responder: UIResponder? = self

    while let current = responder {
      if let application = current as? UIApplication {
        if #available(iOS 18.0, *) {
          return await withCheckedContinuation { continuation in
            application.open(url, options: [:]) { success in
              continuation.resume(returning: success)
            }
          }
        } else {
          return application.perform(selector, with: url) != nil
        }
      }
      responder = current.next
    }

    return false
  }

  private func completeAfterLaunch() {
    // Brief beat so the host URL open can start before the extension tears down.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: nil)
    }
  }

  private func showOpenFallback(shareId: String) {
    pendingOpenURL = URL(string: "\(urlScheme)://share-target?id=\(shareId)")
    preferredContentSize = CGSize(width: UIScreen.main.bounds.width, height: 140)
    spinner.stopAnimating()
    setStatus("Tap to open Xyne Spaces.")
    openButton.isHidden = false
  }

  @objc private func openButtonTapped() {
    if isErrorAcknowledgement {
      extensionContext?.completeRequest(returningItems: nil)
      return
    }

    guard let pendingOpenURL else { return }
    Task { @MainActor in
      spinner.startAnimating()
      openButton.isHidden = true
      setStatus("Opening Xyne Spaces…")
      if await openURLViaResponderChain(pendingOpenURL) {
        completeAfterLaunch()
      } else {
        spinner.stopAnimating()
        openButton.isHidden = false
        setStatus("Open Xyne Spaces manually to finish sharing.")
      }
    }
  }
}
