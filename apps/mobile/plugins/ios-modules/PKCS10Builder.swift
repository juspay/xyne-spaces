//
//  PKCS10Builder.swift
//  Lotus
//
//  ASN.1 DER encoding utilities for PKCS#10 CSR generation
//

import Foundation
import Security

class PKCS10Builder {

  // MARK: - ASN.1 DER Encoding Utilities

  static func encodeLength(_ length: Int) -> Data {
    if length < 128 {
      return Data([UInt8(length)])
    }

    var lengthBytes = Data()
    var len = length
    while len > 0 {
      lengthBytes.insert(UInt8(len & 0xFF), at: 0)
      len >>= 8
    }

    let firstByte = UInt8(0x80 | lengthBytes.count)
    lengthBytes.insert(firstByte, at: 0)
    return lengthBytes
  }

  static func wrapWithTag(_ tag: UInt8, _ data: Data) -> Data {
    var result = Data()
    result.append(tag)
    result.append(contentsOf: encodeLength(data.count))
    result.append(data)
    return result
  }

  static func encodeOID(_ oid: [UInt8]) -> Data {
    return wrapWithTag(0x06, Data(oid))
  }

  static func encodeUTF8String(_ string: String) -> Data {
    guard let stringData = string.data(using: .utf8) else {
      return Data()
    }
    return wrapWithTag(0x0C, stringData)
  }

  static func encodePrintableString(_ string: String) -> Data {
    guard let stringData = string.data(using: .ascii) else {
      return Data()
    }
    return wrapWithTag(0x13, stringData)
  }

  static func encodeInteger(_ value: Int) -> Data {
    var bytes = Data()
    var val = value
    if val == 0 {
      bytes.append(0)
    } else {
      while val > 0 {
        bytes.insert(UInt8(val & 0xFF), at: 0)
        val >>= 8
      }
      if bytes[0] & 0x80 != 0 {
        bytes.insert(0, at: 0)
      }
    }
    return wrapWithTag(0x02, bytes)
  }

  static func encodeBitString(_ data: Data) -> Data {
    var bitStringData = Data()
    bitStringData.append(0x00)
    bitStringData.append(data)
    return wrapWithTag(0x03, bitStringData)
  }

  static func encodeNull() -> Data {
    return Data([0x05, 0x00])
  }

  // MARK: - PKCS#10 Specific Builders

  static func buildSubjectDN(subject: String) throws -> Data {
    var rdnSequence = Data()

    let pairs = subject.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
    for pair in pairs {
      let parts = pair.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
      guard parts.count == 2 else { continue }

      let attribute = String(parts[0])
      let value = String(parts[1])

      let oid: [UInt8]
      let valueEncoded: Data

      switch attribute {
      case "CN":
        oid = [0x55, 0x04, 0x03]
        valueEncoded = encodeUTF8String(value)
      case "O":
        oid = [0x55, 0x04, 0x0A]
        valueEncoded = encodeUTF8String(value)
      case "OU":
        oid = [0x55, 0x04, 0x0B]
        valueEncoded = encodeUTF8String(value)
      case "C":
        oid = [0x55, 0x04, 0x06]
        valueEncoded = encodePrintableString(value)
      default:
        continue
      }

      var atav = Data()
      atav.append(encodeOID(oid))
      atav.append(valueEncoded)
      let atavSeq = wrapWithTag(0x30, atav)

      let set = wrapWithTag(0x31, atavSeq)
      rdnSequence.append(set)
    }

    return wrapWithTag(0x30, rdnSequence)
  }

  static func buildPublicKeyInfo(publicKeyData: Data) throws -> Data {
    let ecPublicKeyOID: [UInt8] = [0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01]
    let secp384r1OID: [UInt8] = [0x2B, 0x81, 0x04, 0x00, 0x22]

    var algorithmIdentifier = Data()
    algorithmIdentifier.append(encodeOID(ecPublicKeyOID))
    algorithmIdentifier.append(encodeOID(secp384r1OID))
    let algSeq = wrapWithTag(0x30, algorithmIdentifier)

    let pubKeyBitString = encodeBitString(publicKeyData)

    var spki = Data()
    spki.append(algSeq)
    spki.append(pubKeyBitString)

    return wrapWithTag(0x30, spki)
  }

  static func buildCertificationRequestInfo(subject: Data, publicKeyInfo: Data) throws -> Data {
    var certRequestInfo = Data()

    certRequestInfo.append(encodeInteger(0))
    certRequestInfo.append(subject)
    certRequestInfo.append(publicKeyInfo)

    let emptyAttributes = wrapWithTag(0xA0, Data())
    certRequestInfo.append(emptyAttributes)

    return wrapWithTag(0x30, certRequestInfo)
  }

  static func buildSignatureAlgorithm() -> Data {
    let ecdsaWithSHA384OID: [UInt8] = [0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x04, 0x03, 0x03]

    var algIdentifier = Data()
    algIdentifier.append(encodeOID(ecdsaWithSHA384OID))

    return wrapWithTag(0x30, algIdentifier)
  }

  static func buildPKCS10(certRequestInfo: Data, signatureAlgorithm: Data, signature: Data) throws -> Data {
    var csr = Data()
    csr.append(certRequestInfo)
    csr.append(signatureAlgorithm)

    let derSignature = try convertECDSASignatureToDER(signature)
    csr.append(encodeBitString(derSignature))

    return wrapWithTag(0x30, csr)
  }

  static func convertECDSASignatureToDER(_ signature: Data) throws -> Data {
    if signature.count > 0 && signature[0] == 0x30 {
      return signature
    }

    guard signature.count == 96 else {
      throw NSError(domain: "PKCS10Builder", code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid signature length: expected 96 bytes (raw) or DER format, got \(signature.count) bytes"])
    }

    let r = signature.subdata(in: 0..<48)
    let s = signature.subdata(in: 48..<96)

    var derSig = Data()
    derSig.append(encodeInteger(r))
    derSig.append(encodeInteger(s))

    return wrapWithTag(0x30, derSig)
  }

  static func encodeInteger(_ data: Data) -> Data {
    var intData = data

    while intData.count > 1 && intData[0] == 0 {
      intData.removeFirst()
    }

    if intData[0] & 0x80 != 0 {
      intData.insert(0, at: 0)
    }

    return wrapWithTag(0x02, intData)
  }
}