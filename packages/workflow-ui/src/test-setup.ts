import '@testing-library/jest-dom/vitest';

// React Flow (the conversational-flow map) measures nodes and reads the viewport
// transform through browser APIs jsdom doesn't implement.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
if (typeof (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly === 'undefined') {
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = class {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
      this.m22 = scale ? Number(scale) : 1;
    }
  };
}
