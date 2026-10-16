import { describe, it, expect } from 'vitest';
import {
  previewFrameMode,
  IFRAME_SANDBOX,
  SANDBOX_PREVIEW_IFRAME_SANDBOX,
  SANDBOX_PREVIEW_ALLOW,
} from './previewFrame';

const DASHBOARD = 'https://app.spaces.xyne.juspay.net';
const PREVIEW = 'https://sandbox.spaces.xyne.juspay.net';
const PREVIEW_PATHS = ['/claw-preview/sbx-1/', '/claw-code/sbx-1', '/claw-term/sbx-1/'];

describe('previewFrameMode', () => {
  it('frames a preview on the configured preview origin with allow-same-origin', () => {
    expect(previewFrameMode(`${PREVIEW}/claw-preview/sbx-1/`, DASHBOARD, PREVIEW)).toEqual({
      kind: 'frame',
      sandbox: SANDBOX_PREVIEW_IFRAME_SANDBOX,
      allow: SANDBOX_PREVIEW_ALLOW,
    });
  });

  it('does not let a preview escape the sandbox through popups or read the clipboard', () => {
    expect(SANDBOX_PREVIEW_IFRAME_SANDBOX).not.toContain('allow-popups-to-escape-sandbox');
    expect(SANDBOX_PREVIEW_ALLOW).not.toContain('clipboard-read');
    expect(SANDBOX_PREVIEW_ALLOW).toContain('clipboard-write');
  });

  it.each(PREVIEW_PATHS)('treats %s on the preview origin as a sandbox preview', path => {
    const mode = previewFrameMode(`${PREVIEW}${path}`, DASHBOARD, PREVIEW);
    expect(mode.kind === 'frame' && mode.sandbox).toContain('allow-same-origin');
  });

  it.each(PREVIEW_PATHS)('refuses to frame %s when served from the dashboard origin', path => {
    expect(previewFrameMode(`${DASHBOARD}${path}`, DASHBOARD, PREVIEW)).toEqual({
      kind: 'shares-dashboard-origin',
    });
  });

  it('never grants allow-same-origin to anything on the dashboard origin', () => {
    const sameOrigin = [
      ...PREVIEW_PATHS.map(path => `${DASHBOARD}${path}`),
      `${DASHBOARD}/anything/else`,
      '/claw-preview/sbx-1/',
      '/relative/path',
    ];
    for (const url of sameOrigin) {
      const mode = previewFrameMode(url, DASHBOARD, PREVIEW);
      if (mode.kind === 'frame') expect(mode.sandbox).not.toContain('allow-same-origin');
    }
  });

  it('grants nothing while no preview origin is configured', () => {
    for (const path of PREVIEW_PATHS) {
      expect(previewFrameMode(`${PREVIEW}${path}`, DASHBOARD, '')).toEqual({
        kind: 'frame',
        sandbox: IFRAME_SANDBOX,
      });
    }
  });

  it('does not trust a preview path on some other host', () => {
    expect(
      previewFrameMode('https://evil.example/claw-preview/sbx-1/', DASHBOARD, PREVIEW),
    ).toEqual({ kind: 'frame', sandbox: IFRAME_SANDBOX });
  });

  it('does not treat a preview prefix buried mid-path as a sandbox preview', () => {
    expect(previewFrameMode(`${PREVIEW}/x/claw-preview/sbx-1/`, DASHBOARD, PREVIEW)).toEqual({
      kind: 'frame',
      sandbox: IFRAME_SANDBOX,
    });
  });

  it('leaves ordinary pages on the default sandbox', () => {
    expect(previewFrameMode('https://example.com/docs', DASHBOARD, PREVIEW)).toEqual({
      kind: 'frame',
      sandbox: IFRAME_SANDBOX,
    });
  });

  it('falls back to the default sandbox for an unparseable url', () => {
    expect(previewFrameMode('http://[', DASHBOARD, PREVIEW)).toEqual({
      kind: 'frame',
      sandbox: IFRAME_SANDBOX,
    });
  });
});
