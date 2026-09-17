const EBML_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/** A standalone WebM file starts with the EBML header, unlike a timeslice fragment. */
export function isStandaloneWebm(buffer: Buffer): boolean {
  return (
    buffer.length >= EBML_HEADER.length &&
    buffer.subarray(0, EBML_HEADER.length).equals(EBML_HEADER)
  );
}
