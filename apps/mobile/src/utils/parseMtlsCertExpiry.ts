/**
 * Read the mTLS client certificate expiry date from a PEM string
 * (no crypto library). Walks DER validity → expiry (UTCTime / GeneralizedTime).
 */

const PEM_BODY = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/;

function decodePemToDer(pem: string): Uint8Array | null {
  const match = PEM_BODY.exec(pem);
  if (!match?.[1]) return null;
  const b64 = match[1].replace(/\s+/g, '');
  try {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Returns the offset of the value, value length, and tag — or null. */
function readTlv(
  buf: Uint8Array,
  offset: number,
): { tag: number; valueOffset: number; valueLength: number; nextOffset: number } | null {
  if (offset + 1 >= buf.length) return null;
  const tag = buf[offset]!;
  const first = buf[offset + 1]!;
  let length: number;
  let lengthHeaderSize: number;
  if (first < 0x80) {
    length = first;
    lengthHeaderSize = 1;
  } else {
    const numBytes = first & 0x7f;
    if (numBytes === 0 || numBytes > 4 || offset + 2 + numBytes > buf.length) return null;
    length = 0;
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | buf[offset + 2 + i]!;
    }
    lengthHeaderSize = 1 + numBytes;
  }
  const valueOffset = offset + 1 + lengthHeaderSize;
  const nextOffset = valueOffset + length;
  if (nextOffset > buf.length) return null;
  return { tag, valueOffset, valueLength: length, nextOffset };
}

/**
 * RFC 5280 §4.1.2.5: UTCTime / GeneralizedTime with seconds and trailing Z, no fractions.
 * Returns ISO-8601 UTC, or null.
 */
function parseAsn1Time(
  buf: Uint8Array,
  offset: number,
  length: number,
  tag: number,
): string | null {
  const text = String.fromCharCode(...buf.subarray(offset, offset + length));
  let yyyymmddhhmmssZ: string;
  if (tag === 0x17) {
    // UTCTime: YYMMDDHHMMSSZ
    if (!/^\d{12}Z$/.test(text)) return null;
    const yy = Number(text.slice(0, 2));
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    yyyymmddhhmmssZ = `${year}${text.slice(2)}`;
  } else if (tag === 0x18) {
    // GeneralizedTime: YYYYMMDDHHMMSSZ
    if (!/^\d{14}Z$/.test(text)) return null;
    yyyymmddhhmmssZ = text;
  } else {
    return null;
  }

  return (
    `${yyyymmddhhmmssZ.slice(0, 4)}-${yyyymmddhhmmssZ.slice(4, 6)}-${yyyymmddhhmmssZ.slice(6, 8)}` +
    `T${yyyymmddhhmmssZ.slice(8, 10)}:${yyyymmddhhmmssZ.slice(10, 12)}:${yyyymmddhhmmssZ.slice(12, 14)}.000Z`
  );
}

/**
 * Returns the certificate expiry as ISO-8601 UTC, or null if the PEM cannot be parsed.
 */
export function parseMtlsCertExpiryFromPem(pem: string): string | null {
  const der = decodePemToDer(pem);
  if (!der) return null;

  // Certificate SEQUENCE
  const cert = readTlv(der, 0);
  if (!cert || cert.tag !== 0x30) return null;

  // TBSCertificate SEQUENCE
  const tbs = readTlv(der, cert.valueOffset);
  if (!tbs || tbs.tag !== 0x30) return null;

  let cursor = tbs.valueOffset;
  const tbsEnd = tbs.valueOffset + tbs.valueLength;

  // Optional version [0]
  const first = readTlv(der, cursor);
  if (!first || first.nextOffset > tbsEnd) return null;
  if (first.tag === 0xa0) {
    cursor = first.nextOffset;
  }

  // serialNumber, signature, issuer — skip three TLVs
  for (let i = 0; i < 3; i++) {
    const field = readTlv(der, cursor);
    if (!field || field.nextOffset > tbsEnd) return null;
    cursor = field.nextOffset;
  }

  // Validity SEQUENCE
  const validity = readTlv(der, cursor);
  if (!validity || validity.tag !== 0x30) return null;

  // notBefore
  const notBefore = readTlv(der, validity.valueOffset);
  if (!notBefore) return null;

  // notAfter (expiry)
  const notAfter = readTlv(der, notBefore.nextOffset);
  if (!notAfter) return null;
  if (notAfter.tag !== 0x17 && notAfter.tag !== 0x18) return null;

  return parseAsn1Time(der, notAfter.valueOffset, notAfter.valueLength, notAfter.tag);
}
