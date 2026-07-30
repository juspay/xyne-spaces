/**
 * Repair filenames mangled by multer/busboy decoding the multipart filename header as latin1:
 * a UTF-8 name (e.g. macOS's U+202F narrow no-break space before AM/PM) arrives as mojibake.
 * We reinterpret the string's chars as the original wire bytes and, only when those bytes are
 * valid UTF-8 that round-trips exactly, return the repaired, NFKC-normalized name.
 *
 * Idempotent and corpus-safe: pure-ASCII names and genuine Latin-1 names don't round-trip as
 * valid UTF-8, so they're returned untouched — safe to run at ingest/backfill over every row.
 */
export function repairMojibakeFilename(name: string): string {
  if (!name) {
    return name;
  }
  // Only Latin-1-supplement chars (0x80-0xFF) can be UTF-8-as-latin1 mojibake; skip pure ASCII.
  const hasHighByte = [...name].some((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x80 && code <= 0xff;
  });
  if (!hasHighByte) {
    return name;
  }
  const wireBytes = Buffer.from(name, 'latin1'); // reverse busboy's latin1 decode -> original bytes
  const asUtf8 = wireBytes.toString('utf8');
  // Skip if decoding is a no-op (already-correct name) or the bytes aren't valid round-tripping
  // UTF-8 (a genuine lone Latin-1 char, not mojibake).
  if (asUtf8 === name || !Buffer.from(asUtf8, 'utf8').equals(wireBytes)) {
    return name;
  }
  // NFKC folds exotic whitespace (U+202F -> plain space) so the name tokenizes like a typed query.
  return asUtf8.normalize('NFKC');
}

/**
 * Filename for a fresh multipart upload: generate a fallback when the client sent none, then
 * repair any latin1 mojibake (see repairMojibakeFilename).
 */
export function decodeUploadFilename(originalname: string | undefined): string {
  if (!originalname || originalname.trim().length === 0) {
    return `upload-${Date.now()}`;
  }
  return repairMojibakeFilename(originalname);
}
