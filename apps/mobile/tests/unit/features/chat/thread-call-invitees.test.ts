import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  buildThreadCallInvitees,
  defaultThreadCallInvitees,
  parseCallInvitees,
} from '@/src/features/chat/thread-header/thread-call-invitees';

it('selects subscribers and engaged participants, excluding passive readers and self', () => {
  assert.deepEqual(
    defaultThreadCallInvitees(
      [
        { userId: 'self', isSubscribed: true },
        { userId: 'subscriber', isSubscribed: true, participationType: null },
        { userId: 'author', participationType: 'AUTHOR' },
        { userId: 'mentioned', participationType: 'MENTIONED' },
        { userId: 'reader', isSubscribed: false, participationType: null },
        { userId: 'subscriber', isSubscribed: true },
      ],
      'self',
    ),
    ['subscriber', 'author', 'mentioned'],
  );
});
it('retains only chosen invitees and the caller, never falling back to channel members', () => {
  assert.deepEqual(buildThreadCallInvitees(['extra', 'subscriber', 'extra', 'self'], 'self'), [
    'self',
    'extra',
    'subscriber',
  ]);
  assert.deepEqual(buildThreadCallInvitees([], 'self'), ['self']);
  assert.throws(() => buildThreadCallInvitees([], ''), /still loading/);
});
it('round trips explicit invitees and rejects malformed or empty route payloads', () => {
  const targets = buildThreadCallInvitees(['subscriber', 'extra'], 'self');
  assert.deepEqual(parseCallInvitees(JSON.stringify(targets)), targets);
  for (const value of [undefined, '', '[]', 'null', '{}', 'bad', '["valid", 2]', '[""]']) {
    assert.equal(parseCallInvitees(value), undefined);
  }
});
