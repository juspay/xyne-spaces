let utf8Decoder: TextDecoder | null = null;

function getUtf8Decoder(): TextDecoder {
  if (!utf8Decoder) {
    utf8Decoder = new TextDecoder('utf-8');
  }
  return utf8Decoder;
}

export function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function decodeBase64Utf8(value: string): string {
  return getUtf8Decoder().decode(decodeBase64Bytes(value));
}
