declare module 'heic-decode' {
  interface HeicDecodeResult {
    width: number;
    height: number;
    /** Raw RGBA pixel data (4 bytes per pixel). */
    data: Buffer;
  }

  interface HeicDecodeOptions {
    buffer: Buffer;
  }

  /**
   * Decode a HEIC/HEIF image to raw RGBA pixels (libheif compiled to WASM).
   * Rejects on undecodable input.
   */
  function decode(options: HeicDecodeOptions): Promise<HeicDecodeResult>;
  export default decode;
}
