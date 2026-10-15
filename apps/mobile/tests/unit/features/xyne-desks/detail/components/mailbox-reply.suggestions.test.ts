import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildContactPool,
  buildSuggestions,
} from '@/src/features/xyne-desks/detail/components/mailbox-reply/mailbox-reply.suggestions';

describe('buildContactPool', () => {
  it('prefers org over desk for the same email and excludes the desk alias', () => {
    const pool = buildContactPool(
      [{ id: 'u1', email: 'ada@x.com', name: 'Ada Org' }],
      [
        { email: 'ada@x.com', name: 'Ada Desk' },
        { email: 'bob@x.com', name: 'Bob' },
      ],
      [{ from: 'Ada Org <ada@x.com>' }],
      ['desk@xyne.com'],
    );

    const ada = pool.find(item => item.email === 'ada@x.com');
    const bob = pool.find(item => item.email === 'bob@x.com');
    assert.equal(ada?.source, 'org');
    assert.equal(ada?.name, 'Ada Org');
    assert.equal(bob?.source, 'desk');
    assert.equal(
      pool.some(item => item.email === 'desk@xyne.com'),
      false,
    );
  });
});

describe('buildSuggestions', () => {
  const pool = [
    { email: 'ada@x.com', name: 'Ada Lovelace', source: 'org' as const },
    { email: 'bob@x.com', name: 'Bob', source: 'desk' as const },
    { email: 'cara@x.com', name: 'Cara', source: 'thread' as const },
  ];

  it('returns nothing for an empty query', () => {
    assert.deepEqual(buildSuggestions(pool, '  ', []), []);
  });

  it('matches name or email substrings and hides chips already in the field', () => {
    const matches = buildSuggestions(pool, 'ada', ['bob@x.com']);
    assert.deepEqual(
      matches.map(item => item.email),
      ['ada@x.com'],
    );
  });

  it('ranks org before desk and thread', () => {
    const mixed = [
      { email: 'z@x.com', name: 'Zed Thread', source: 'thread' as const },
      { email: 'a@x.com', name: 'Ann Desk', source: 'desk' as const },
      { email: 'm@x.com', name: 'Mo Org', source: 'org' as const },
    ];
    assert.deepEqual(
      buildSuggestions(mixed, 'x.com', []).map(item => item.source),
      ['org', 'desk', 'thread'],
    );
  });
});
