import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isAllowedDashboardRoute,
  isAllowedDashboardNavigation,
  createFocusedRouteLockScript,
  isAllowedPdfNavigation,
  isSafeExternalUrl,
  isSafeExternalWebViewUrl,
  isTrustedWebViewOrigin,
  updateTrustedWebViewNavigation,
} from '@/src/utils/webViewSecurity';

describe('WebView security policies', (): void => {
  const dashboardOrigin = 'https://app.spaces.xyne.juspay.net';

  it('accepts only the exact dashboard origin, including its effective port', (): void => {
    assert.equal(isTrustedWebViewOrigin(`${dashboardOrigin}/workspace/1`, dashboardOrigin), true);
    assert.equal(
      isTrustedWebViewOrigin(
        'https://app.spaces.xyne.juspay.net.evil.example/workspace/1',
        dashboardOrigin,
      ),
      false,
    );
    assert.equal(
      isTrustedWebViewOrigin('https://app.spaces.xyne.juspay.net:444/workspace/1', dashboardOrigin),
      false,
    );
    assert.equal(
      isTrustedWebViewOrigin(
        'https://user:pass@app.spaces.xyne.juspay.net/workspace/1',
        dashboardOrigin,
      ),
      false,
    );
    assert.equal(isTrustedWebViewOrigin('javascript:alert(1)', dashboardOrigin), false);
  });

  it('keeps top-level navigation on the dashboard while allowing embedded canvas frames', (): void => {
    assert.equal(
      isAllowedDashboardNavigation('https://evil.example/canvas', dashboardOrigin, false),
      true,
    );
    assert.equal(
      isAllowedDashboardNavigation('https://evil.example/canvas', dashboardOrigin, true),
      false,
    );
    assert.equal(
      isAllowedDashboardNavigation(`${dashboardOrigin}/recordings`, dashboardOrigin, true),
      true,
    );
  });

  it('locks top-level navigation to the native-selected focused route', (): void => {
    const selectedPath = '/workspace-1/chat/canvas/canvas-42';
    assert.equal(
      isAllowedDashboardRoute(`${dashboardOrigin}${selectedPath}`, dashboardOrigin, selectedPath),
      true,
    );
    assert.equal(
      isAllowedDashboardRoute(
        `${dashboardOrigin}${selectedPath}#section=2`,
        dashboardOrigin,
        selectedPath,
      ),
      true,
    );
    assert.equal(
      isAllowedDashboardRoute(
        `${dashboardOrigin}/workspace-1/settings`,
        dashboardOrigin,
        selectedPath,
      ),
      false,
    );
    assert.equal(
      isAllowedDashboardRoute(`${dashboardOrigin}/`, dashboardOrigin, selectedPath),
      false,
    );
    assert.equal(
      isAllowedDashboardNavigation(
        'https://recording-canvas.example/frame',
        dashboardOrigin,
        false,
        selectedPath,
      ),
      true,
    );
  });

  it('keeps a focused canvas within its own workspace canvas family', (): void => {
    const selectedPath = '/workspace-1/chat/canvas/canvas-42';
    assert.equal(
      isAllowedDashboardRoute(
        `${dashboardOrigin}/workspace-1/chat/canvas/canvas-7`,
        dashboardOrigin,
        selectedPath,
      ),
      true,
    );
    assert.equal(
      isAllowedDashboardRoute(
        `${dashboardOrigin}/workspace-2/chat/canvas/canvas-7`,
        dashboardOrigin,
        selectedPath,
      ),
      false,
    );
    assert.equal(
      isAllowedDashboardRoute(`${dashboardOrigin}/workspace-1/chat`, dashboardOrigin, selectedPath),
      false,
    );
    assert.equal(
      isAllowedDashboardRoute(
        'https://evil.example/workspace-1/chat/canvas/canvas-7',
        dashboardOrigin,
        selectedPath,
      ),
      false,
    );
  });

  it('supports each focused WebView route without permitting dashboard siblings', (): void => {
    const focusedRoutes = [
      '/workspace-1/chat/canvas/canvas-42',
      '/workspace-1/chat/dir/channel-7?tab=canvas',
      '/workspace-1/rca?messageId=message-9',
      '/call/call-11?type=VIDEO',
    ];

    for (const focusedPath of focusedRoutes) {
      assert.equal(
        isAllowedDashboardRoute(`${dashboardOrigin}${focusedPath}`, dashboardOrigin, focusedPath),
        true,
      );
    }

    assert.equal(
      isAllowedDashboardRoute(
        `${dashboardOrigin}/workspace-1/chat/dir/channel-7?tab=messages`,
        dashboardOrigin,
        '/workspace-1/chat/dir/channel-7?tab=canvas',
      ),
      false,
    );
    assert.equal(
      isAllowedDashboardRoute(
        `${dashboardOrigin}/workspace-1/chat/dir/channel-7?tab=messages&tab=canvas`,
        dashboardOrigin,
        '/workspace-1/chat/dir/channel-7?tab=canvas',
      ),
      false,
    );
    assert.equal(
      isAllowedDashboardRoute(
        `${dashboardOrigin}/workspace-1/rca/other-report`,
        dashboardOrigin,
        '/workspace-1/rca?messageId=message-9',
      ),
      false,
    );
  });

  it('guards client-side history transitions for the selected route', (): void => {
    const script = createFocusedRouteLockScript('/workspace-1/chat/canvas/canvas-42');
    assert.match(script, /history\.pushState/);
    assert.match(script, /history\.replaceState/);
    assert.match(script, /canvas\/canvas-42/);
    assert.equal(createFocusedRouteLockScript(null), 'true;');
  });

  it('allows the current PDF and fragment changes only', (): void => {
    const pdf = 'file:///var/mobile/Containers/Data/Application/abc/Library/Caches/report.pdf';
    assert.equal(isAllowedPdfNavigation(pdf, pdf), true);
    assert.equal(isAllowedPdfNavigation(`${pdf}#page=4`, pdf), true);
    assert.equal(isAllowedPdfNavigation('about:blank', pdf), true);
    assert.equal(
      isAllowedPdfNavigation(
        'file:///var/mobile/Containers/Data/Application/abc/Library/Caches/other.pdf',
        pdf,
      ),
      false,
    );
    assert.equal(isAllowedPdfNavigation('https://example.com/report.pdf', pdf), false);
  });

  it('only permits ordinary HTTP(S) links from a WebView popup', (): void => {
    assert.equal(isSafeExternalWebViewUrl('https://example.com/docs'), true);
    assert.equal(isSafeExternalWebViewUrl('http://example.com/docs'), true);
    assert.equal(isSafeExternalWebViewUrl('mailto:security@example.com'), false);
    assert.equal(isSafeExternalWebViewUrl('tel:+15551212'), false);
    assert.equal(isSafeExternalWebViewUrl('xyne-spaces://auth/callback'), false);
    assert.equal(isSafeExternalWebViewUrl('https://user:pass@example.com/docs'), false);
  });

  it('allows chat OS handoff for HTTP(S), mailto, and tel only', (): void => {
    assert.equal(isSafeExternalUrl('https://example.com/docs'), true);
    assert.equal(isSafeExternalUrl('mailto:security@example.com'), true);
    assert.equal(isSafeExternalUrl('mailto:security@example.com?subject=Hello'), true);
    assert.equal(isSafeExternalUrl('tel:+15551212'), true);
    assert.equal(isSafeExternalUrl('mailto://evil'), false);
    assert.equal(isSafeExternalUrl('tel://15551212'), false);
    assert.equal(isSafeExternalUrl('tel:javascript:alert(1)'), false);
    assert.equal(isSafeExternalUrl('xyne-spaces://auth/callback'), false);
    assert.equal(isSafeExternalUrl('intent://scan/#Intent;end'), false);
  });

  it('rejects malformed or whitespace-padded external links before OS handoff', (): void => {
    assert.equal(isSafeExternalUrl(''), false);
    assert.equal(isSafeExternalUrl(' https://example.com/docs'), false);
    assert.equal(isSafeExternalUrl('https://example.com/docs '), false);
    assert.equal(isSafeExternalUrl('https://'), false);
    assert.equal(isSafeExternalUrl('https://example.com/%zz'), false);
    assert.equal(isSafeExternalUrl('file:///private/secret.txt'), false);
    assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  });

  it('does not invalidate an async reply when load-finish repeats the same URL', (): void => {
    const readyUrl = `${dashboardOrigin}/workspace/1`;
    const initial = { url: null, generation: 0 };
    const loadStart = updateTrustedWebViewNavigation(initial, readyUrl, dashboardOrigin);
    const loadFinish = updateTrustedWebViewNavigation(loadStart, readyUrl, dashboardOrigin);
    const routeChange = updateTrustedWebViewNavigation(
      loadFinish,
      `${dashboardOrigin}/workspace/2`,
      dashboardOrigin,
    );

    assert.equal(loadStart.generation, 1);
    assert.deepEqual(loadFinish, loadStart);
    assert.equal(routeChange.generation, 2);
  });
});
