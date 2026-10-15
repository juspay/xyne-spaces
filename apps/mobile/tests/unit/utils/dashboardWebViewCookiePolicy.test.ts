import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DASHBOARD_SESSION_COOKIE_NAMES,
  areDashboardSessionCookiesSynchronized,
  selectDashboardSessionCookies,
} from '@/src/utils/dashboardWebViewCookiePolicy';

describe('dashboard WebView cookie policy', () => {
  it('copies only the approved session cookies', () => {
    const selected = selectDashboardSessionCookies({
      xyne_session: { value: 'session-a', path: '/', secure: true },
      user_session_id: { value: 'session-b', path: '/', secure: true },
      google_access_token: { value: 'must-not-copy' },
      xyne_last_workspace: { value: 'workspace-a' },
    });

    assert.deepEqual(selected, [
      { value: 'session-a', path: '/', secure: true, name: 'xyne_session' },
      { value: 'session-b', path: '/', secure: true, name: 'user_session_id' },
    ]);
  });

  it('rejects malformed values and normalizes mismatched cookie names', () => {
    const selected = selectDashboardSessionCookies({
      xyne_session: 'raw-string-cookie',
      user_session_id: { value: 'session-b', name: 'attacker-controlled-name' },
      empty_session: { path: '/' },
    });

    assert.deepEqual(selected, [{ value: 'session-b', name: 'user_session_id' }]);
    assert.deepEqual(DASHBOARD_SESSION_COOKIE_NAMES, ['xyne_session', 'user_session_id']);
  });

  it('verifies every selected cookie in the destination store', () => {
    const selected = selectDashboardSessionCookies({
      xyne_session: { value: 'session-a' },
      user_session_id: { value: 'session-b' },
    });

    assert.equal(
      areDashboardSessionCookiesSynchronized(
        {
          xyne_session: { value: 'session-a' },
          user_session_id: { value: 'session-b' },
        },
        selected,
      ),
      true,
    );
    assert.equal(
      areDashboardSessionCookiesSynchronized({ xyne_session: { value: 'session-a' } }, selected),
      false,
    );
    assert.equal(
      areDashboardSessionCookiesSynchronized(
        {
          xyne_session: { value: 'session-a' },
          user_session_id: { value: 'session-from-another-user' },
        },
        selected,
      ),
      false,
    );
  });
});
