/**
 * Extract X.509 `notAfter` from a PEM certificate without a crypto dependency.
 * Walks DER: Certificate → TBSCertificate → Validity → notAfter (UTCTime / GeneralizedTime).
 */

const PEM_BODY = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/;

function decodePemToDer(pem: string): Uint8Array | null {
  const match = PEM_BODY.exec(pem);
  if (!match?.[1]) return null;
  const b64 = match[1].replace(/\s+/g, '');
  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function readLength(
  buf: Uint8Array,
  offset: number,
): { length: number; headerSize: number } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset]!;
  if (first < 0x80) {
    return { length: first, headerSize: 1 };
  }
  const numBytes = first & 0x7f;
  if (numBytes === 0 || numBytes > 4 || offset + 1 + numBytes > buf.length) return null;
  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    length = (length << 8) | buf[offset + 1 + i]!;
  }
  return { length, headerSize: 1 + numBytes };
}

/** Returns the offset of the value, value length, and tag — or null. */
function readTlv(
  buf: Uint8Array,
  offset: number,
): { tag: number; valueOffset: number; valueLength: number; nextOffset: number } | null {
  if (offset >= buf.length) return null;
  const tag = buf[offset]!;
  const lenInfo = readLength(buf, offset + 1);
  if (!lenInfo) return null;
  const valueOffset = offset + 1 + lenInfo.headerSize;
  const nextOffset = valueOffset + lenInfo.length;
  if (nextOffset > buf.length) return null;
  return { tag, valueOffset, valueLength: lenInfo.length, nextOffset };
}

function parseAsn1Time(buf: Uint8Array, offset: number, length: number, tag: number): Date | null {
  const text = String.fromCharCode(...buf.subarray(offset, offset + length));
  // Strip fractional seconds / timezone variants; expect trailing Z for UTC.
  const normalized = text.replace(/\.\d+/, '');
  if (tag === 0x17) {
    // UTCTime: YYMMDDHHMMSSZ (or YYMMDDHHMMZ)
    const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(normalized);
    if (!m) return null;
    const yy = Number(m[1]);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    return new Date(
      Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)),
    );
  }
  if (tag === 0x18) {
    // GeneralizedTime: YYYYMMDDHHMMSSZ
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(normalized);
    if (!m) return null;
    return new Date(
      Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6] ?? 0),
      ),
    );
  }
  return null;
}

/**
 * Returns ISO-8601 UTC `notAfter`, or null if the PEM cannot be parsed.
 */
export function parseX509NotAfterFromPem(pem: string): string | null {
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

  // notAfter
  const notAfter = readTlv(der, notBefore.nextOffset);
  if (!notAfter) return null;
  if (notAfter.tag !== 0x17 && notAfter.tag !== 0x18) return null;

  const date = parseAsn1Time(der, notAfter.valueOffset, notAfter.valueLength, notAfter.tag);
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
