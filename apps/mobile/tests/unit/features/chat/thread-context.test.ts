import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  buildThreadContextMessage,
  contextItemFromResult,
} from '@/src/features/chat/thread-header/thread-context';
import { resolveThreadContextLink } from '@/src/utils/threadContextLink';
import type { DisplaySearchResult } from '@/src/types/search';
const result = (overrides: Partial<DisplaySearchResult>): DisplaySearchResult => ({
  id: 'id',
  type: 'conversation',
  title: 'Title',
  subtitle: '',
  metadata: {},
  relevanceScore: 0,
  ...overrides,
});
it('links replies to the original message and tickets to Details using desktop routes', () => {
  assert.equal(
    contextItemFromResult(
      result({
        searchContext: { channelId: 'c', conversationId: 't', messageId: 'm', replyCount: 2 },
      }),
    )?.url,
    '/chat/dir/c/t#origin=t&messageId=m',
  );
  assert.equal(
    contextItemFromResult(
      result({
        type: 'ticket',
        searchContext: { channelId: 'c', conversationId: 't', ticketId: 'ticket' },
      }),
    )?.url,
    '/chat/dir/c/t/ticket?selectedTab=details',
  );
  assert.equal(contextItemFromResult(result({})), null);
});
it('does not post unsafe attachment URLs', () => {
  for (const url of ['javascript:alert(1)', '//evil.test', 'data:text/html,bad']) {
    assert.equal(
      contextItemFromResult(result({ type: 'attachment', searchContext: { internalUrl: url } })),
      null,
    );
  }
});
it('groups selected items and escapes titles and link attributes', () => {
  const html = buildThreadContextMessage([
    { id: '1', type: 'channel', title: '<img src=x> & "A"', url: '/chat/dir/a?x="&y=1' },
    { id: '2', type: 'user', title: 'Person', url: '/chat/dir/user/u' },
  ]);
  assert.ok(html.includes('<strong>Relevant Contexts:</strong>'));
  assert.ok(html.includes('<strong>Channels:</strong>'));
  assert.ok(html.includes('<strong>Users:</strong>'));
  assert.ok(html.includes('&lt;img src=x&gt; &amp; &quot;A&quot;'));
  assert.ok(html.includes('href="/chat/dir/a?x=&quot;&amp;y=1"'));
});
it('opens relative desktop context links through native message and person handlers', () => {
  assert.equal(
    resolveThreadContextLink('/chat/dir/c/t#origin=t', 'https://example.test', 'user:'),
    'https://example.test/chat/dir/c/t#origin=t',
  );
  assert.equal(
    resolveThreadContextLink('/chat/dir/user/u', 'https://example.test', 'user:'),
    'user:u',
  );
  assert.equal(
    resolveThreadContextLink('https://evil.test/chat/dir/user/u', 'https://example.test', 'user:'),
    'https://evil.test/chat/dir/user/u',
  );
});
