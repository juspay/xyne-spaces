/**
 * DOMException Polyfill for React Native
 *
 * DOMException is a browser API that's not available in React Native.
 * LiveKit client SDK uses it, so we need to polyfill it globally.
 */

if (typeof globalThis.DOMException === 'undefined') {
  class DOMExceptionPolyfill extends Error {
    code: number;
    constructor(message?: string, name?: string) {
      super(message);
      this.name = name ?? 'Error';
      this.code = 0;
    }
  }
  (globalThis as unknown as { DOMException: typeof DOMExceptionPolyfill }).DOMException =
    DOMExceptionPolyfill;
}

export {};
