import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractTarget, looksLikeCommand } from '@/src/features/xyne-ai/navigation/command';

describe('looksLikeCommand', () => {
  it('accepts short commands and bare screen names', () => {
    for (const text of [
      'open #general',
      'Open my settings',
      'go to bookmarks',
      'goto threads',
      'show me my drafts',
      'take me to notification settings',
      'navigate to xyne desks',
      'message Priya',
      'dm Sam Lee',
      'chat with Ada',
      'view ticket ABC-123',
      'settings',
      'Bookmarks',
      'my threads',
      'drafts & sent',
      'open calls',
      'go to activity',
      'show my profile',
      'my profile',
      'me',
      'open theme settings',
      'invite people',
      'create a channel',
      'new message',
      'manage members',
      'open help',
    ]) {
      assert.equal(looksLikeCommand(text), true, text);
    }
  });

  it('rejects questions and requests for answers', () => {
    for (const text of [
      'what did Ann say in #general?',
      'summarise #general',
      'how do I open settings',
      'how do I change my notification settings?',
      'find the doc about onboarding',
      'call me when the build is done',
      'did anyone message Priya?',
      'open the pull request and explain what changed in the diff and why it was needed today',
      'show me what changed?',
      'show me what Priya said yesterday?',
      'show me what Priya said yesterday',
      'open the doc where we planned the launch',
      'what is the plan for the launch',
      'invite people who are interested in the new design system to a call tomorrow',
      'open',
      '',
    ]) {
      assert.equal(looksLikeCommand(text), false, text);
    }
  });

  it('rejects very long input however few words it has', () => {
    assert.equal(looksLikeCommand(`open ${'a'.repeat(300)}`), false);
  });
});

describe('extractTarget', () => {
  it('keeps the channel with its #', () => {
    assert.equal(extractTarget('channel', 'open #general'), '#general');
    assert.equal(extractTarget('channel', 'go to the #dev-ops channel'), '#dev-ops');
  });

  it('takes a channel name written without #', () => {
    assert.equal(extractTarget('channel', 'open the design channel'), 'design');
  });

  it('takes a ticket key in any case', () => {
    assert.equal(extractTarget('ticket', 'open ticket abc-123'), 'ABC-123');
    assert.equal(extractTarget('ticket', 'show XYZ-42 please'), 'XYZ-42');
    assert.equal(extractTarget('ticket', 'open the ticket'), '');
  });

  it('strips command words and filler around a person', () => {
    assert.equal(extractTarget('dm', 'message Priya'), 'Priya');
    assert.equal(extractTarget('dm', 'dm Sam Lee'), 'Sam Lee');
    assert.equal(extractTarget('dm', 'chat with Ada Lovelace'), 'Ada Lovelace');
    assert.equal(extractTarget('dm', 'open my chat with Ann'), 'Ann');
    assert.equal(extractTarget('dm', 'open the DM with Ann'), 'Ann');
  });

  it('drops the possessive and the noun after it', () => {
    assert.equal(extractTarget('profile', "open Ann's profile"), 'Ann');
    assert.equal(extractTarget('profile', 'show profile of Sam'), 'Sam');
    assert.equal(extractTarget('profile', 'show the profile for Sam Lee'), 'Sam Lee');
  });

  it('is empty when the command names no one', () => {
    assert.equal(extractTarget('profile', 'open my profile'), '');
    assert.equal(extractTarget('dm', 'message'), '');
  });
});
