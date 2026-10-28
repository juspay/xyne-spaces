import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizePublicDeepLink } from '@/src/utils/publicDeepLink';

const PUBLIC_ORIGIN = 'https://example.org';
const DASHBOARD_ORIGIN = 'https://app.example.org';
// A retired public origin (LEGACY_PUBLIC_DEEP_LINK_ORIGINS) whose links must still open in-app.
const RETIRED_ORIGIN = 'https://public.example.org';

const canonicalize = (value: string, publicOrigin = PUBLIC_ORIGIN) =>
  canonicalizePublicDeepLink(value, publicOrigin, [DASHBOARD_ORIGIN, RETIRED_ORIGIN]);

test('uses the configured public origin when normalizing a retired link', () => {
  assert.equal(
    canonicalize(
      'https://public.example.org/chat/dir/channel-1',
      'https://sandbox.example.org',
    ),
    'https://sandbox.example.org/chat/dir/channel-1',
  );
});

test('canonicalizes retired HTTPS call and message links while preserving suffixes', () => {
  assert.equal(
    canonicalize(
      `${RETIRED_ORIGIN}/chat/dir/channel-1/thread-2?source=notification#messageId=message-3`,
    ),
    'https://example.org/chat/dir/channel-1/thread-2?source=notification#messageId=message-3',
  );
  assert.equal(
    canonicalize('https://app.example.org/call/call-1'),
    'https://example.org/call/call-1',
  );
});

test('canonicalizes workspace-scoped deep links while preserving the workspace, ids, query, and hash', () => {
  // Workspace-prefixed call link on a retired origin (the shape that previously
  // slipped past the `startsWith('/call/')` gate and failed to open in-app).
  assert.equal(
    canonicalize(
      'https://app.example.org/ws-42/call/call-9?type=VIDEO#src=notif',
    ),
    'https://example.org/ws-42/call/call-9?type=VIDEO#src=notif',
  );
  // Workspace-prefixed chat link, honoring the configured target origin.
  assert.equal(
    canonicalize(
      'https://public.example.org/ws-42/chat/dir/channel-1/thread-2#messageId=m-3',
      'https://sandbox.example.org',
    ),
    'https://sandbox.example.org/ws-42/chat/dir/channel-1/thread-2#messageId=m-3',
  );
});

test('canonicalizes the workspace + project scoped link shape the web app emits', () => {
  assert.equal(
    canonicalize(
      'https://app.example.org/00000000-0000-4000-8000-000000000001' +
        '/cmove4qwc00rwd8fujw25xgnf/chat/dir/cmqb57emo02xmh4qh14wrqs5y' +
        '#origin=282a528a-ffa0-430d-8b3b-8b2004cfe648',
    ),
    'https://example.org/00000000-0000-4000-8000-000000000001' +
      '/cmove4qwc00rwd8fujw25xgnf/chat/dir/cmqb57emo02xmh4qh14wrqs5y' +
      '#origin=282a528a-ffa0-430d-8b3b-8b2004cfe648',
  );
  assert.equal(
    canonicalize('https://app.example.org/ws-42/project-7/call/call-9'),
    'https://example.org/ws-42/project-7/call/call-9',
  );
});

test('does not reintroduce the retired custom scheme or rewrite unrelated URLs', () => {
  assert.equal(
    canonicalize('lotus://chat/dir/channel-1'),
    'lotus://chat/dir/channel-1',
  );
  assert.equal(
    canonicalize('https://app.example.org/apps/downloads'),
    'https://app.example.org/apps/downloads',
  );
  // A workspace-prefixed but non-deep-link path must stay untouched.
  assert.equal(
    canonicalize('https://app.example.org/ws-42/apps/downloads'),
    'https://app.example.org/ws-42/apps/downloads',
  );
  // A non-Xyne host is never rewritten, even on a known deep-link path.
  assert.equal(
    canonicalize('https://evil.example/ws-42/call/call-9'),
    'https://evil.example/ws-42/call/call-9',
  );
  // Three or more leading segments are past the workspace + project shape.
  assert.equal(
    canonicalize('https://app.example.org/a/b/c/chat/dir/channel-1'),
    'https://app.example.org/a/b/c/chat/dir/channel-1',
  );
});
