import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DASHBOARD_WEBVIEW_ROUTES,
  prefixPathForDashboardWebview,
  resolveDashboardWebViewTarget,
} from '@/src/utils/webview';

describe('prefixPathForDashboardWebview', () => {
  it('returns the path unchanged when no workspaceId is provided', () => {
    assert.equal(prefixPathForDashboardWebview('/chat/canvas', null), '/chat/canvas');
    assert.equal(prefixPathForDashboardWebview('/chat/canvas', undefined), '/chat/canvas');
    assert.equal(prefixPathForDashboardWebview('/chat/canvas', ''), '/chat/canvas');
  });

  it('prefixes the workspace id and normalizes a missing leading slash', () => {
    assert.equal(prefixPathForDashboardWebview('/chat/canvas', 'ws1'), '/ws1/chat/canvas');
    assert.equal(prefixPathForDashboardWebview('chat/canvas', 'ws1'), '/ws1/chat/canvas');
  });

  it('does not double-prefix a path already scoped to the workspace', () => {
    assert.equal(prefixPathForDashboardWebview('/ws1', 'ws1'), '/ws1');
    assert.equal(prefixPathForDashboardWebview('/ws1/chat', 'ws1'), '/ws1/chat');
  });

  it('leaves reserved top-level routes unscoped', () => {
    assert.equal(prefixPathForDashboardWebview('/call', 'ws1'), '/call');
    assert.equal(prefixPathForDashboardWebview('/call/123', 'ws1'), '/call/123');
    assert.equal(prefixPathForDashboardWebview('/calls', 'ws1'), '/calls');
    assert.equal(prefixPathForDashboardWebview('/redirected', 'ws1'), '/redirected');
    assert.equal(prefixPathForDashboardWebview('/auth/login', 'ws1'), '/auth/login');
  });
});

describe('resolveDashboardWebViewTarget', () => {
  it('is not visible when no segment maps to a dashboard route', () => {
    assert.deepEqual(resolveDashboardWebViewTarget([]), {
      visible: false,
      path: null,
      segment: null,
    });
    assert.deepEqual(resolveDashboardWebViewTarget(['home', 'settings']), {
      visible: false,
      path: null,
      segment: null,
    });
  });

  it('resolves a plain route and appends non-excluded query params', () => {
    assert.deepEqual(resolveDashboardWebViewTarget(['rca'], {}, 'ws1'), {
      visible: true,
      path: '/ws1/rca',
      segment: 'rca',
    });
    assert.deepEqual(resolveDashboardWebViewTarget(['rca'], { rcaId: 'r1' }, null), {
      visible: true,
      path: '/rca?rcaId=r1',
      segment: 'rca',
    });
  });

  it('builds the canvas path from canvasId and excludes it from the query', () => {
    assert.deepEqual(
      resolveDashboardWebViewTarget(['canvas'], { canvasId: 'c1', foo: 'bar' }, 'ws1'),
      {
        visible: true,
        path: '/ws1/chat/canvas/c1?foo=bar',
        segment: 'canvas',
      },
    );
  });

  it('substitutes a dynamic child param and keeps reserved routes unscoped', () => {
    assert.deepEqual(
      resolveDashboardWebViewTarget(['call', '[callId]'], { callId: '123' }, 'ws1'),
      {
        visible: true,
        path: '/call/123',
        segment: 'call',
      },
    );
  });

  it('builds the channel-canvas deep link with tab=canvas', () => {
    assert.deepEqual(
      resolveDashboardWebViewTarget(['channel-canvas'], { channelId: 'ch1', extra: 'e' }, 'ws1'),
      {
        visible: true,
        path: '/ws1/chat/dir/ch1?tab=canvas&extra=e',
        segment: 'channel-canvas',
      },
    );
  });

  it('walks from the leaf inward so the focused screen wins', () => {
    assert.deepEqual(resolveDashboardWebViewTarget(['rca', 'canvas'], { canvasId: 'c1' }, 'ws1'), {
      visible: true,
      path: '/ws1/chat/canvas/c1',
      segment: 'canvas',
    });
  });

  it('exposes the route table for the supported segments', () => {
    assert.equal(DASHBOARD_WEBVIEW_ROUTES.canvas, '/chat/canvas');
    assert.equal(DASHBOARD_WEBVIEW_ROUTES.rca, '/rca');
    assert.equal(DASHBOARD_WEBVIEW_ROUTES['channel-canvas'], '/chat/dir');
  });
});
