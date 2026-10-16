import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyDashboardWebViewNavigation,
  resolveTrustedCanvasWebViewPath,
} from '@/src/utils/dashboardWebViewNavigation';

const DASHBOARD = 'https://app.spaces.xyne.juspay.net';
const TRUSTED = ['https://spaces.xyne.juspay.net', DASHBOARD];

describe('dashboard WebView navigation', () => {
  it('allows only same-origin dashboard documents inside the WebView', () => {
    assert.deepEqual(
      classifyDashboardWebViewNavigation(
        `${DASHBOARD}/ws1/chat/canvas`,
        DASHBOARD,
        TRUSTED,
        '/ws1/chat/canvas',
      ),
      { action: 'allow' },
    );
  });

  it('keeps a focused overlay within its selected canvas family', () => {
    assert.deepEqual(
      classifyDashboardWebViewNavigation(
        `${DASHBOARD}/ws1/chat/canvas/canvas-2`,
        DASHBOARD,
        TRUSTED,
        '/ws1/chat/canvas',
        'focused',
      ),
      { action: 'allow' },
    );
    assert.deepEqual(
      classifyDashboardWebViewNavigation(
        `${DASHBOARD}/ws1/settings`,
        DASHBOARD,
        TRUSTED,
        '/ws1/chat/canvas',
        'focused',
      ),
      { action: 'external', url: `${DASHBOARD}/ws1/settings` },
    );
  });

  it('allows same-origin routes in full mweb mode', () => {
    assert.deepEqual(
      classifyDashboardWebViewNavigation(
        `${DASHBOARD}/ws1/settings`,
        DASHBOARD,
        TRUSTED,
        '/ws1',
        'full',
      ),
      { action: 'allow' },
    );
  });

  it('normalizes a trusted public canvas link into the current WebView workspace', () => {
    assert.deepEqual(
      classifyDashboardWebViewNavigation(
        'https://spaces.xyne.juspay.net/chat/canvas/canvas-1?mode=view#block-2',
        DASHBOARD,
        TRUSTED,
        '/ws1/chat/canvas',
      ),
      {
        action: 'navigate',
        path: '/ws1/chat/canvas/canvas-1?mode=view#block-2',
      },
    );
  });

  it('keeps the native-selected workspace for a trusted canvas link', () => {
    assert.equal(
      resolveTrustedCanvasWebViewPath(
        'https://spaces.xyne.juspay.net/ws2/chat/canvas/canvas-2',
        DASHBOARD,
        TRUSTED,
        '/ws1/chat/canvas',
      ),
      '/ws1/chat/canvas/canvas-2',
    );
  });

  it('hands ordinary HTTPS destinations to the OS and blocks unsafe schemes', () => {
    assert.deepEqual(
      classifyDashboardWebViewNavigation(
        'https://example.com/help',
        DASHBOARD,
        TRUSTED,
        '/ws1/chat/canvas',
      ),
      { action: 'external', url: 'https://example.com/help' },
    );
    assert.deepEqual(
      classifyDashboardWebViewNavigation(
        'javascript:alert(1)',
        DASHBOARD,
        TRUSTED,
        '/ws1/chat/canvas',
      ),
      { action: 'block' },
    );
  });

  it('does not treat a lookalike host as trusted', () => {
    assert.deepEqual(
      classifyDashboardWebViewNavigation(
        'https://spaces.xyne.juspay.net.attacker.test/chat/canvas/canvas-1',
        DASHBOARD,
        TRUSTED,
        '/ws1/chat/canvas',
      ),
      {
        action: 'external',
        url: 'https://spaces.xyne.juspay.net.attacker.test/chat/canvas/canvas-1',
      },
    );
  });
});
