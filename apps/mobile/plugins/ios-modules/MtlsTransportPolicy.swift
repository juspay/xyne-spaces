import Foundation

/// Native transport allowlist shared by the HTTP and WebSocket bridges.
enum MtlsTransportPolicy {
  private struct Origin {
    let scheme: String
    let host: String
    let port: Int
  }

  private static let configuredApiOrigin: Origin? = {
    guard let raw = Bundle.main.object(forInfoDictionaryKey: "LotusApiOrigin") as? String else {
      return nil
    }
    return parseOrigin(raw)
  }()

  static func isApprovedHTTPURL(_ rawURL: String) -> Bool {
    guard let url = URL(string: rawURL),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.user == nil,
          components.password == nil,
          components.fragment == nil,
          let scheme = components.scheme?.lowercased(),
          let host = components.host?.lowercased() else {
      return false
    }

    if isLoopbackHost(host) {
      return scheme == "http" || scheme == "https"
    }
    return scheme == "https" && sameOrigin(components, expected: configuredApiOrigin)
  }

  static func isApprovedWebSocketURL(_ rawURL: String) -> Bool {
    guard let url = URL(string: rawURL),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.user == nil,
          components.password == nil,
          components.fragment == nil,
          let scheme = components.scheme?.lowercased(),
          let host = components.host?.lowercased() else {
      return false
    }

    if isLoopbackHost(host) {
      return scheme == "ws" || scheme == "wss"
    }
    return scheme == "wss" && sameOrigin(components, expected: configuredApiOrigin)
  }

  private static func parseOrigin(_ raw: String) -> Origin? {
    guard let url = URL(string: raw),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.user == nil,
          components.password == nil,
          components.query == nil,
          components.fragment == nil,
          let scheme = components.scheme?.lowercased(),
          let host = components.host?.lowercased(),
          (scheme == "http" || scheme == "https") else {
      return nil
    }
    return Origin(scheme: scheme, host: host, port: effectivePort(components, scheme: scheme))
  }

  private static func sameOrigin(_ components: URLComponents, expected: Origin?) -> Bool {
    guard let expected,
          let scheme = components.scheme?.lowercased(),
          let host = components.host?.lowercased() else {
      return false
    }
    let originScheme: String
    switch scheme {
    case "ws":
      originScheme = "http"
    case "wss":
      originScheme = "https"
    default:
      originScheme = scheme
    }
    return originScheme == expected.scheme &&
      host == expected.host &&
      effectivePort(components, scheme: scheme) == expected.port
  }

  private static func effectivePort(_ components: URLComponents, scheme: String) -> Int {
    if let port = components.port {
      return port
    }
    return scheme == "http" || scheme == "ws" ? 80 : 443
  }

  private static func isLoopbackHost(_ host: String) -> Bool {
    let normalized = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased()
    return normalized == "localhost" || normalized == "127.0.0.1" || normalized == "::1"
  }
}
