import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMessageDeepLinkPath,
  buildWorkspaceScopedMessagePath,
  messageDeepLinkScopeSegments,
  parseMessageDeepLinkCore,
  type MessageDeepLinkPayload,
} from '@/src/utils/messageDeepLinkCore';

const TRUSTED_ORIGINS = new Set(['https://spaces.xyne.juspay.net']);

describe('message deep-link contract', (): void => {
  it('round-trips the complete exact-message tuple', (): void => {
    const relative = buildMessageDeepLinkPath({
      channelId: 'channel 1',
      origin: 'conversation-1',
      messageId: 'message-1',
      createdAt: 123,
      surface: 'dms',
      scopeType: 'DM',
    });
    const parsed = parseMessageDeepLinkCore(
      `https://spaces.xyne.juspay.net/${relative}`,
      TRUSTED_ORIGINS,
    );

    assert.deepEqual(parsed, {
      channelId: 'channel 1',
      origin: 'conversation-1',
      messageId: 'message-1',
      createdAt: 123,
      surface: 'dms',
      scopeType: 'DM',
    });
  });

  it('accepts only the current app URL scheme', (): void => {
    assert.equal(
      parseMessageDeepLinkCore('xyne-spaces://chat/dir/channel-1/thread-1', TRUSTED_ORIGINS)
        ?.threadId,
      'thread-1',
    );
    assert.equal(
      parseMessageDeepLinkCore('lotus://chat/dir/channel-1/thread-1', TRUSTED_ORIGINS),
      null,
    );
  });

  it('accepts a workspace-scoped message link and preserves the exact-message tuple', (): void => {
    const parsed = parseMessageDeepLinkCore(
      'https://spaces.xyne.juspay.net/00000000-0000-4000-8000-000000000001' +
        '/chat/dir/cmshc9yum2p3ewsrh5rzihf6w/b454579d-9134-4ea7-846e-79da94c32041' +
        '#origin=b454579d-9134-4ea7-846e-79da94c32041&messageId=cmt05zbah060q14kxan5oydxc',
      TRUSTED_ORIGINS,
    );

    assert.deepEqual(parsed, {
      channelId: 'cmshc9yum2p3ewsrh5rzihf6w',
      workspaceId: '00000000-0000-4000-8000-000000000001',
      threadId: 'b454579d-9134-4ea7-846e-79da94c32041',
      origin: 'b454579d-9134-4ea7-846e-79da94c32041',
      messageId: 'cmt05zbah060q14kxan5oydxc',
    });
  });

  it('round-trips a workspace-scoped web link and preserves the workspace + tuple', (): void => {
    const payload = {
      channelId: 'cmshc9yum2p3ewsrh5rzihf6w',
      workspaceId: '00000000-0000-4000-8000-000000000001',
      threadId: 'thread-1',
      origin: 'thread-1',
      messageId: 'message-1',
    } as const;
    const relative = buildWorkspaceScopedMessagePath(payload);
    assert.ok(
      relative.startsWith('00000000-0000-4000-8000-000000000001/chat/dir/'),
      'workspace segment should lead the path',
    );
    const parsed = parseMessageDeepLinkCore(
      `https://spaces.xyne.juspay.net/${relative}`,
      TRUSTED_ORIGINS,
    );
    assert.deepEqual(parsed, payload);
  });

  it('reads the workspace from the scope segment adjacent to the path', (): void => {
    // The org+workspace and workspace-only links below address the same channel, so
    // the segment they share (`cmove…`) is the workspace and the uuid above it is the
    // organization. Getting this backwards would ask the switch to enter an org id.
    const scoped = parseMessageDeepLinkCore(
      'https://spaces.xyne.juspay.net/00000000-0000-4000-8000-000000000001' +
        '/cmove4qwc00rwd8fujw25xgnf/chat/dir/cmqb57emo02xmh4qh14wrqs5y' +
        '#origin=282a528a-ffa0-430d-8b3b-8b2004cfe648',
      TRUSTED_ORIGINS,
    );
    assert.deepEqual(scoped, {
      channelId: 'cmqb57emo02xmh4qh14wrqs5y',
      orgId: '00000000-0000-4000-8000-000000000001',
      workspaceId: 'cmove4qwc00rwd8fujw25xgnf',
      origin: '282a528a-ffa0-430d-8b3b-8b2004cfe648',
    });

    const workspaceOnly = parseMessageDeepLinkCore(
      'https://spaces.xyne.juspay.net/cmove4qwc00rwd8fujw25xgnf' +
        '/chat/dir/cmqb57emo02xmh4qh14wrqs5y' +
        '#origin=282a528a-ffa0-430d-8b3b-8b2004cfe648',
      TRUSTED_ORIGINS,
    );
    assert.equal(workspaceOnly?.workspaceId, 'cmove4qwc00rwd8fujw25xgnf');
    assert.equal(workspaceOnly?.orgId, undefined);
  });

  it('exposes scope segments in path order, workspace last', (): void => {
    const parsed = parseMessageDeepLinkCore(
      'https://spaces.xyne.juspay.net/org-9/ws-1/chat/dir/channel-1',
      TRUSTED_ORIGINS,
    );
    assert.ok(parsed);
    assert.deepEqual(messageDeepLinkScopeSegments(parsed), ['org-9', 'ws-1']);
    const unscoped: MessageDeepLinkPayload = { channelId: 'channel-1' };
    assert.deepEqual(messageDeepLinkScopeSegments(unscoped), []);
  });

  it('round-trips an org + workspace scoped path', (): void => {
    const payload = {
      channelId: 'channel-1',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      threadId: 'thread-1',
    } as const;
    const relative = buildWorkspaceScopedMessagePath(payload);
    assert.equal(relative, 'org-1/ws-1/chat/dir/channel-1/thread-1');
    assert.deepEqual(
      parseMessageDeepLinkCore(`https://spaces.xyne.juspay.net/${relative}`, TRUSTED_ORIGINS),
      payload,
    );
  });

  it('omits the org segment when the payload carries no org', (): void => {
    assert.equal(
      buildWorkspaceScopedMessagePath({ channelId: 'channel-1', workspaceId: 'ws-1' }),
      'ws-1/chat/dir/channel-1',
    );
  });

  it('omits the workspace segment when no workspace is provided', (): void => {
    const relative = buildWorkspaceScopedMessagePath({ channelId: 'channel-1' });
    assert.equal(relative, 'chat/dir/channel-1');
  });

  it('rejects untrusted, partial, conflicting, and unsafe paths', (): void => {
    assert.equal(
      parseMessageDeepLinkCore('http://spaces.xyne.juspay.net/chat/dir/channel-1', TRUSTED_ORIGINS),
      null,
    );
    assert.equal(
      parseMessageDeepLinkCore('https://evil.example/chat/dir/channel-1', TRUSTED_ORIGINS),
      null,
    );
    assert.equal(
      parseMessageDeepLinkCore(
        // One leading segment is the workspace, two are workspace + project; three or
        // more stay rejected.
        'https://spaces.xyne.juspay.net/ws/project/extra/chat/dir/channel-1',
        TRUSTED_ORIGINS,
      ),
      null,
    );
    assert.equal(
      parseMessageDeepLinkCore(
        'https://spaces.xyne.juspay.net/chat/dir/channel-1?messageId=a#messageId=b',
        TRUSTED_ORIGINS,
      ),
      null,
    );
    assert.equal(
      parseMessageDeepLinkCore(
        'https://spaces.xyne.juspay.net/chat/dir/channel%2Fescape',
        TRUSTED_ORIGINS,
      ),
      null,
    );
    // Ticket-detail URLs have a third post-chat/dir segment; they are not message links.
    assert.equal(
      parseMessageDeepLinkCore(
        'https://spaces.xyne.juspay.net/00000000-0000-4000-8000-000000000001' +
          '/chat/dir/cmmw4b63v0q6z575f2x8teulu/cms91mfbf058nx4zkjfe419tg/cms91mfbs058qx4zk9mimdz5h' +
          '?selectedTab=details',
        TRUSTED_ORIGINS,
      ),
      null,
    );
  });
});
