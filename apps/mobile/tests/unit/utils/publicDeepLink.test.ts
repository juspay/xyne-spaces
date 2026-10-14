import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizePublicDeepLink } from '@/src/utils/publicDeepLink';

test('uses the configured public origin when normalizing a retired link', () => {
  assert.equal(
    canonicalizePublicDeepLink(
      'https://xyne-spaces.web.app/chat/dir/channel-1',
      'https://sandbox.spaces.example',
    ),
    'https://sandbox.spaces.example/chat/dir/channel-1',
  );
});

test('canonicalizes retired HTTPS call and message links while preserving suffixes', () => {
  assert.equal(
    canonicalizePublicDeepLink(
      'https://xyne-spaces.web.app/chat/dir/channel-1/thread-2?source=notification#messageId=message-3',
    ),
    'https://spaces.xyne.juspay.net/chat/dir/channel-1/thread-2?source=notification#messageId=message-3',
  );
  assert.equal(
    canonicalizePublicDeepLink('https://app.spaces.xyne.juspay.net/call/call-1'),
    'https://spaces.xyne.juspay.net/call/call-1',
  );
});

test('canonicalizes workspace-scoped deep links while preserving the workspace, ids, query, and hash', () => {
  // Workspace-prefixed call link on a retired origin (the shape that previously
  // slipped past the `startsWith('/call/')` gate and failed to open in-app).
  assert.equal(
    canonicalizePublicDeepLink(
      'https://app.spaces.xyne.juspay.net/ws-42/call/call-9?type=VIDEO#src=notif',
    ),
    'https://spaces.xyne.juspay.net/ws-42/call/call-9?type=VIDEO#src=notif',
  );
  // Workspace-prefixed chat link, honoring the configured target origin.
  assert.equal(
    canonicalizePublicDeepLink(
      'https://xyne-spaces.web.app/ws-42/chat/dir/channel-1/thread-2#messageId=m-3',
      'https://spaces.sandbox.xyne.juspay.net',
    ),
    'https://spaces.sandbox.xyne.juspay.net/ws-42/chat/dir/channel-1/thread-2#messageId=m-3',
  );
});

test('canonicalizes the workspace + project scoped link shape the web app emits', () => {
  assert.equal(
    canonicalizePublicDeepLink(
      'https://app.spaces.xyne.juspay.net/00000000-0000-4000-8000-000000000001' +
        '/cmove4qwc00rwd8fujw25xgnf/chat/dir/cmqb57emo02xmh4qh14wrqs5y' +
        '#origin=282a528a-ffa0-430d-8b3b-8b2004cfe648',
    ),
    'https://spaces.xyne.juspay.net/00000000-0000-4000-8000-000000000001' +
      '/cmove4qwc00rwd8fujw25xgnf/chat/dir/cmqb57emo02xmh4qh14wrqs5y' +
      '#origin=282a528a-ffa0-430d-8b3b-8b2004cfe648',
  );
  assert.equal(
    canonicalizePublicDeepLink('https://app.spaces.xyne.juspay.net/ws-42/project-7/call/call-9'),
    'https://spaces.xyne.juspay.net/ws-42/project-7/call/call-9',
  );
});

test('does not reintroduce the retired custom scheme or rewrite unrelated URLs', () => {
  assert.equal(
    canonicalizePublicDeepLink('lotus://chat/dir/channel-1'),
    'lotus://chat/dir/channel-1',
  );
  assert.equal(
    canonicalizePublicDeepLink('https://app.spaces.xyne.juspay.net/apps/downloads'),
    'https://app.spaces.xyne.juspay.net/apps/downloads',
  );
  // A workspace-prefixed but non-deep-link path must stay untouched.
  assert.equal(
    canonicalizePublicDeepLink('https://app.spaces.xyne.juspay.net/ws-42/apps/downloads'),
    'https://app.spaces.xyne.juspay.net/ws-42/apps/downloads',
  );
  // A non-Xyne host is never rewritten, even on a known deep-link path.
  assert.equal(
    canonicalizePublicDeepLink('https://evil.example/ws-42/call/call-9'),
    'https://evil.example/ws-42/call/call-9',
  );
  // Three or more leading segments are past the workspace + project shape.
  assert.equal(
    canonicalizePublicDeepLink('https://app.spaces.xyne.juspay.net/a/b/c/chat/dir/channel-1'),
    'https://app.spaces.xyne.juspay.net/a/b/c/chat/dir/channel-1',
  );
});
