import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildWorkspaceScopedTicketPath,
  parseMessageDeepLinkCore,
  parseTicketDeepLinkCore,
  ticketDeepLinkRouteParams,
} from '@/src/utils/messageDeepLinkCore';

const TRUSTED_ORIGINS = new Set(['https://spaces.xyne.juspay.net']);

const TICKET_DETAIL_URL =
  'https://spaces.xyne.juspay.net/00000000-0000-4000-8000-000000000001' +
  '/chat/dir/cmmw4b63v0q6z575f2x8teulu/cms91mfbf058nx4zkjfe419tg/cms91mfbs058qx4zk9mimdz5h' +
  '?selectedTab=details';

describe('ticket deep-link contract', (): void => {
  it('parses a workspace-scoped dashboard ticket-detail URL', (): void => {
    const parsed = parseTicketDeepLinkCore(TICKET_DETAIL_URL, TRUSTED_ORIGINS);
    assert.deepEqual(parsed, {
      workspaceId: '00000000-0000-4000-8000-000000000001',
      channelId: 'cmmw4b63v0q6z575f2x8teulu',
      conversationId: 'cms91mfbf058nx4zkjfe419tg',
      ticketId: 'cms91mfbs058qx4zk9mimdz5h',
      selectedTab: 'overview',
    });
  });

  it('maps selectedTab=thread onto the native thread tab', (): void => {
    const parsed = parseTicketDeepLinkCore(
      'https://spaces.xyne.juspay.net/chat/dir/c1/v1/t1?selectedTab=thread',
      TRUSTED_ORIGINS,
    );
    assert.deepEqual(parsed, {
      channelId: 'c1',
      conversationId: 'v1',
      ticketId: 't1',
      selectedTab: 'thread',
    });
  });

  it('maps selectedTab=messages onto thread and defaults unknown tabs to overview', (): void => {
    assert.equal(
      parseTicketDeepLinkCore(
        'https://spaces.xyne.juspay.net/chat/dir/c1/v1/t1?selectedTab=messages',
        TRUSTED_ORIGINS,
      )?.selectedTab,
      'thread',
    );
    assert.equal(
      parseTicketDeepLinkCore(
        'https://spaces.xyne.juspay.net/chat/dir/c1/v1/t1?selectedTab=overview',
        TRUSTED_ORIGINS,
      )?.selectedTab,
      'overview',
    );
    assert.equal(
      parseTicketDeepLinkCore('https://spaces.xyne.juspay.net/chat/dir/c1/v1/t1', TRUSTED_ORIGINS)
        ?.selectedTab,
      'overview',
    );
  });

  it('accepts org + workspace scope and the custom app scheme', (): void => {
    assert.deepEqual(
      parseTicketDeepLinkCore(
        'https://spaces.xyne.juspay.net/org-9/ws-1/chat/dir/c1/v1/t1?selectedTab=details',
        TRUSTED_ORIGINS,
      ),
      {
        orgId: 'org-9',
        workspaceId: 'ws-1',
        channelId: 'c1',
        conversationId: 'v1',
        ticketId: 't1',
        selectedTab: 'overview',
      },
    );
    assert.equal(
      parseTicketDeepLinkCore(
        'xyne-spaces://chat/dir/c1/v1/t1?selectedTab=details',
        TRUSTED_ORIGINS,
      )?.ticketId,
      't1',
    );
  });

  it('does not steal message or call links, and rejects untrusted hosts', (): void => {
    assert.equal(
      parseTicketDeepLinkCore(
        'https://spaces.xyne.juspay.net/ws-1/chat/dir/channel-1/thread-1',
        TRUSTED_ORIGINS,
      ),
      null,
    );
    assert.equal(
      parseTicketDeepLinkCore('https://spaces.xyne.juspay.net/chat/dir/channel-1', TRUSTED_ORIGINS),
      null,
    );
    assert.equal(
      parseTicketDeepLinkCore('https://evil.example/chat/dir/c1/v1/t1', TRUSTED_ORIGINS),
      null,
    );
    assert.equal(
      parseTicketDeepLinkCore(
        'https://spaces.xyne.juspay.net/a/b/c/chat/dir/c1/v1/t1',
        TRUSTED_ORIGINS,
      ),
      null,
    );
    assert.equal(
      parseMessageDeepLinkCore(
        'https://spaces.xyne.juspay.net/ws-1/chat/dir/channel-1/thread-1',
        TRUSTED_ORIGINS,
      )?.threadId,
      'thread-1',
    );
  });

  it('builds native ticket route params from a parsed link', (): void => {
    const parsed = parseTicketDeepLinkCore(TICKET_DETAIL_URL, TRUSTED_ORIGINS);
    assert.ok(parsed);
    assert.deepEqual(ticketDeepLinkRouteParams(parsed), {
      ticketId: 'cms91mfbs058qx4zk9mimdz5h',
      selectedTab: 'overview',
      channelId: 'cmmw4b63v0q6z575f2x8teulu',
      threadId: 'cms91mfbf058nx4zkjfe419tg',
      from: 'deeplink',
      source: 'deeplink',
    });
  });

  it('round-trips a workspace-scoped share URL with details mapped to overview', (): void => {
    const payload = {
      workspaceId: '00000000-0000-4000-8000-000000000001',
      channelId: 'cmmw4b63v0q6z575f2x8teulu',
      conversationId: 'cms91mfbf058nx4zkjfe419tg',
      ticketId: 'cms91mfbs058qx4zk9mimdz5h',
      selectedTab: 'overview' as const,
    };
    const relative = buildWorkspaceScopedTicketPath(payload);
    assert.equal(
      relative,
      '00000000-0000-4000-8000-000000000001/chat/dir/cmmw4b63v0q6z575f2x8teulu/cms91mfbf058nx4zkjfe419tg/cms91mfbs058qx4zk9mimdz5h?selectedTab=details',
    );
    assert.deepEqual(
      parseTicketDeepLinkCore(`https://spaces.xyne.juspay.net/${relative}`, TRUSTED_ORIGINS),
      payload,
    );
  });
});
