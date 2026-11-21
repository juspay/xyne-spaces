import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  areDashboardSessionCookiesSynchronized,
  hasDashboardRefreshCookie,
  isDashboardSessionCookieName,
  selectDashboardSessionCookies,
} from '@/src/utils/dashboardWebViewCookiePolicy';

describe('dashboard WebView cookie policy', () => {
  it('copies the refresh cookie, workspace JWTs and the last-workspace pointer only', () => {
    const selected = selectDashboardSessionCookies({
      xs: { value: 'refresh', path: '/api/auth/refresh-session', httpOnly: true },
      xyne_ws_ws1_token: { value: 'jwt-1', path: '/' },
      xyne_last_workspace: { value: 'ws1' },
      xyne_pending_auth: { value: 'must-not-copy' },
      google_access_token: { value: 'must-not-copy' },
      xyne_session: { value: 'legacy-must-not-copy' },
    });

    assert.deepEqual(
      selected.map(cookie => cookie['name']),
      ['xs', 'xyne_last_workspace', 'xyne_ws_ws1_token'],
    );
    assert.deepEqual(selected[0], {
      value: 'refresh',
      path: '/api/auth/refresh-session',
      httpOnly: true,
      name: 'xs',
    });
  });

  it('recognises only well-formed workspace token names', () => {
    assert.equal(isDashboardSessionCookieName('xyne_ws_cmwf2b8ph0027e3hy79cdzvxf_token'), true);
    assert.equal(isDashboardSessionCookieName('xyne_ws__token'), false);
    assert.equal(isDashboardSessionCookieName('xyne_ws_a;b_token'), false);
    assert.equal(isDashboardSessionCookieName('xyne_pending_auth'), false);
  });

  it('rejects malformed values and normalizes mismatched cookie names', () => {
    const selected = selectDashboardSessionCookies({
      xs: 'raw-string-cookie',
      xyne_ws_ws1_token: { value: 'jwt-1', name: 'attacker-controlled-name' },
      xyne_last_workspace: { path: '/' },
    });

    assert.deepEqual(selected, [{ value: 'jwt-1', name: 'xyne_ws_ws1_token' }]);
  });

  it('treats the dashboard as signed in only when the refresh cookie is there', () => {
    assert.equal(
      hasDashboardRefreshCookie(selectDashboardSessionCookies({ xs: { value: 'refresh' } })),
      true,
    );
    assert.equal(
      hasDashboardRefreshCookie(
        selectDashboardSessionCookies({ xyne_ws_ws1_token: { value: 'jwt-1' } }),
      ),
      false,
    );
  });

  it('verifies every selected cookie in the destination store', () => {
    const selected = selectDashboardSessionCookies({
      xs: { value: 'refresh' },
      xyne_ws_ws1_token: { value: 'jwt-1' },
    });

    assert.equal(
      areDashboardSessionCookiesSynchronized(
        { xs: { value: 'refresh' }, xyne_ws_ws1_token: { value: 'jwt-1' } },
        selected,
      ),
      true,
    );
    assert.equal(
      areDashboardSessionCookiesSynchronized({ xs: { value: 'refresh' } }, selected),
      false,
    );
    assert.equal(
      areDashboardSessionCookiesSynchronized(
        { xs: { value: 'refresh-from-another-user' }, xyne_ws_ws1_token: { value: 'jwt-1' } },
        selected,
      ),
      false,
    );
  });
});
