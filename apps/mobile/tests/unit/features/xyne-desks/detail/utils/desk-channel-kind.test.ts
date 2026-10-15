import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getChatDeskReplyPath,
  getDeskChannelKind,
  isAppSourcedDeskTicket,
  shouldShowEmailHeaderChrome,
} from '@/src/features/xyne-desks/detail/utils/desk-channel-kind';

describe('getDeskChannelKind', () => {
  it('classifies mailbox desks as mailbox', () => {
    assert.equal(getDeskChannelKind('EMAIL'), 'mailbox');
    assert.equal(getDeskChannelKind('email'), 'mailbox');
  });

  it('classifies Slack and App desks as chat', () => {
    assert.equal(getDeskChannelKind('SLACK'), 'chat');
    assert.equal(getDeskChannelKind('APP'), 'chat');
    assert.equal(getDeskChannelKind('slack'), 'chat');
  });

  it('returns unknown for empty or unsupported types', () => {
    assert.equal(getDeskChannelKind(''), 'unknown');
    assert.equal(getDeskChannelKind(null), 'unknown');
    assert.equal(getDeskChannelKind('WHATSAPP'), 'unknown');
  });
});

describe('shouldShowEmailHeaderChrome', () => {
  it('shows From/To chrome only for mailbox EMAIL desks', () => {
    assert.equal(shouldShowEmailHeaderChrome('EMAIL'), true);
    assert.equal(shouldShowEmailHeaderChrome('email'), true);
  });

  it('hides From/To chrome for App and Slack desks', () => {
    assert.equal(shouldShowEmailHeaderChrome('APP'), false);
    assert.equal(shouldShowEmailHeaderChrome('SLACK'), false);
  });

  it('hides From/To chrome for app-sourced tickets on an EMAIL desk', () => {
    assert.equal(shouldShowEmailHeaderChrome('EMAIL', { type: 'app' }), false);
    assert.equal(shouldShowEmailHeaderChrome('EMAIL', { type: 'APP' }), false);
    // Intentional: channel kind stays mailbox (reply bar) even when chrome is hidden.
    assert.equal(getDeskChannelKind('EMAIL'), 'mailbox');
  });

  it('keeps chrome for EMAIL when deskSource is absent or non-app', () => {
    assert.equal(shouldShowEmailHeaderChrome('EMAIL', null), true);
    assert.equal(shouldShowEmailHeaderChrome('EMAIL', { type: 'email' }), true);
  });
});

describe('isAppSourcedDeskTicket', () => {
  it('detects app deskSource type case-insensitively', () => {
    assert.equal(isAppSourcedDeskTicket({ type: 'app' }), true);
    assert.equal(isAppSourcedDeskTicket({ type: ' App ' }), true);
    assert.equal(isAppSourcedDeskTicket({ type: 'email' }), false);
    assert.equal(isAppSourcedDeskTicket(null), false);
  });
});

describe('getChatDeskReplyPath', () => {
  it('routes Slack and App desks to their integration reply endpoints', () => {
    assert.equal(getChatDeskReplyPath('SLACK', 'conv-1'), '/integrations/slack-desk/conv-1/reply');
    assert.equal(getChatDeskReplyPath('app', 'conv-2'), '/integrations/app-desk/conv-2/reply');
  });

  it('does not use the email reply endpoint for Slack or App', () => {
    const slackPath = getChatDeskReplyPath('SLACK', 'conv-1');
    const appPath = getChatDeskReplyPath('APP', 'conv-1');
    assert.ok(slackPath && !slackPath.startsWith('/email/'));
    assert.ok(appPath && !appPath.startsWith('/email/'));
  });

  it('returns null for Email desks and missing conversation ids', () => {
    assert.equal(getChatDeskReplyPath('EMAIL', 'conv-1'), null);
    assert.equal(getChatDeskReplyPath('SLACK', ''), null);
  });
});
