// Transit key helper: an ECDH P-256 key generated inside the Secure Enclave. The private key
// never leaves the chip; the app keeps only the Enclave's encrypted handle to it
// (`dataRepresentation`), which works on this Mac alone. No user presence is required, so it
// never shows a prompt.
//
//   transit-key create   → {"blob": b64}
//   transit-key agree    stdin {"blob": b64, "serverPoint": b64}
//                        → {"secret": b64 (32 bytes), "publicKey": b64 (65-byte uncompressed point)}
//
// Inputs come on stdin, never argv (visible in `ps`). Each command prints one JSON line;
// a failure prints {"error": "..."} and exits 1.

import CryptoKit
import Foundation

struct Failure: Error {
  let message: String
}

func respond(_ object: [String: String]) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(object["error"] == nil ? 0 : 1)
}

func readInput() throws -> [String: String] {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: String] else {
    throw Failure(message: "input must be a JSON object of strings")
  }
  return object
}

func bytes(_ input: [String: String], _ name: String) throws -> Data {
  guard let value = input[name], let data = Data(base64Encoded: value) else {
    throw Failure(message: "\(name) must be base64")
  }
  return data
}

do {
  guard SecureEnclave.isAvailable else { throw Failure(message: "Secure Enclave unavailable") }
  switch CommandLine.arguments.dropFirst().first {
  case "create":
    let key = try SecureEnclave.P256.KeyAgreement.PrivateKey()
    respond(["blob": key.dataRepresentation.base64EncodedString()])
  case "agree":
    let input = try readInput()
    let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(
      dataRepresentation: try bytes(input, "blob"))
    let server = try P256.KeyAgreement.PublicKey(
      x963Representation: try bytes(input, "serverPoint"))
    let secret = try key.sharedSecretFromKeyAgreement(with: server).withUnsafeBytes { Data($0) }
    respond([
      "secret": secret.base64EncodedString(),
      "publicKey": key.publicKey.x963Representation.base64EncodedString(),
    ])
  default:
    throw Failure(message: "usage: transit-key create | agree")
  }
} catch let failure as Failure {
  respond(["error": failure.message])
} catch {
  respond(["error": String(describing: error)])
}
