import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IFRAME_SANDBOX, iframeSandboxFor } from './iframeSandbox';

describe('iframeSandboxFor', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows same origin for sandbox live previews', () => {
    expect(iframeSandboxFor('https://app.example/claw-preview/sbx_1/')).toBe(
      `${IFRAME_SANDBOX} allow-same-origin`,
    );
  });

  it('allows same origin for sandbox code previews', () => {
    expect(iframeSandboxFor('/claw-code/sbx_1')).toBe(`${IFRAME_SANDBOX} allow-same-origin`);
  });

  it('keeps arbitrary content in an opaque origin', () => {
    expect(iframeSandboxFor('https://example.com/page')).toBe(IFRAME_SANDBOX);
    expect(iframeSandboxFor('https://example.com/x/claw-preview/sbx_1/')).toBe(IFRAME_SANDBOX);
    expect(iframeSandboxFor('/claw-previewer/sbx_1/')).toBe(IFRAME_SANDBOX);
  });

  it('keeps the default for an unparseable url', () => {
    expect(iframeSandboxFor('http://')).toBe(IFRAME_SANDBOX);
  });
});
