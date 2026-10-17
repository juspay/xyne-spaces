import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  absolutizeDashboardLinks,
  buildMentionResolver,
  linkMentions,
} from '@/src/features/xyne-ai/model/answerLinks';

const users = [
  { id: 'u1', name: 'Ada Lovelace', email: 'ada@x.dev' },
  { id: 'u2', name: 'Sam Lee', displayName: 'Sam', email: 'sam.lee@x.dev' },
  { id: 'u3', name: 'Sam Roe', displayName: 'Sam', email: 'sam.roe@x.dev' },
];
const resolve = buildMentionResolver(
  { '<Grace Hopper>': { name: 'Grace Hopper', userId: 'u9' } },
  users,
);

describe('buildMentionResolver', () => {
  it('resolves by name, email handle and userTags, case-insensitively', () => {
    assert.equal(resolve('ada lovelace'), 'u1');
    assert.equal(resolve('sam.lee'), 'u2');
    assert.equal(resolve('Grace Hopper'), 'u9');
  });

  it('refuses a name shared by two people', () => {
    assert.equal(resolve('Sam'), undefined);
  });
});

describe('linkMentions', () => {
  it('links @mentions, tagging the longest leading run that resolves', () => {
    assert.equal(
      linkMentions('Ask @Ada Lovelace about it, or @sam.lee.', resolve),
      'Ask [@Ada Lovelace](xyne://user/u1) about it, or [@sam.lee](xyne://user/u2).',
    );
    assert.equal(
      linkMentions('@Ada Lovelace reviewed', resolve),
      '[@Ada Lovelace](xyne://user/u1) reviewed',
    );
    assert.equal(
      linkMentions('@Ada Lovelace and @Grace Hopper', resolve),
      '[@Ada Lovelace](xyne://user/u1) and [@Grace Hopper](xyne://user/u9)',
    );
  });

  it('links <Full Name> and escapes an unresolved one so it is not dropped as HTML', () => {
    assert.equal(
      linkMentions('<Ada Lovelace> and <Nobody Known>', resolve),
      '[@Ada Lovelace](xyne://user/u1) and \\<Nobody Known>',
    );
  });

  it('leaves code untouched', () => {
    const text = 'Use `<View>` then\n```tsx\n<Ada Lovelace /> @Ada Lovelace\n```\n';
    assert.equal(linkMentions(text, resolve), text);
  });

  it('leaves unresolved handles, emails and autolinks alone', () => {
    const text = '@nobody mail ada@x.dev <https://x.dev> <br>';
    assert.equal(linkMentions(text, resolve), text);
  });
});

describe('absolutizeDashboardLinks', () => {
  const origins = { app: 'https://app.example/', dashboard: 'https://dash.example' };

  it('resolves app-relative links, sending canvases to the dashboard origin', () => {
    assert.equal(
      absolutizeDashboardLinks(
        '[a](/chat/dir/c1#origin=t&messageId=m) [b](/chat/canvas/v1)',
        origins,
      ),
      '[a](https://app.example/chat/dir/c1#origin=t&messageId=m) [b](https://dash.example/chat/canvas/v1)',
    );
  });

  it('leaves absolute and protocol-relative links alone', () => {
    const text = '[a](https://x.dev/a) [b](//x.dev/b) [c](xyne://user/u1)';
    assert.equal(absolutizeDashboardLinks(text, origins), text);
  });
});
