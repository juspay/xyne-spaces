//
//  MtlsDependencyProvider.swift
//  Lotus
//
//  React Native only consults URL request handlers that codegen finds in libraries,
//  so the app's own MtlsHTTPRequestHandler is registered here. Without it, fetch and
//  XHR requests to the API go out without the client certificate.
//

import React
import ReactAppDependencyProvider

final class MtlsDependencyProvider: RCTAppDependencyProvider {
  override func urlRequestHandlerClassNames() -> [String] {
    super.urlRequestHandlerClassNames() + ["MtlsHTTPRequestHandler"]
  }
}
