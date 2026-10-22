import { describe, expect, it } from 'vitest';
import { ClawApiError } from '../../../services/claw/clawRequest';
import type { ChannelAccountView } from '../../../services/claw/clawMessagingTypes';
import {
  channelAccessFromError,
  formatNumber,
  groupAccountsByAgent,
  isCompleteCode,
  keepCodeStepAfter,
  linkErrorText,
  mergeMyNumbers,
} from './messagingChannels';

const account = (
  id: string,
  agent: ChannelAccountView['agent'],
  channel: ChannelAccountView['channel'] = 'whatsapp',
): ChannelAccountView => ({
  id,
  channel,
  label: id,
  connState: 'connected',
  agent,
  scope: channel === 'whatsapp' ? 'user' : 'org',
});

describe('formatNumber', () => {
  it('normalises a sender id to +digits', () => {
    expect(formatNumber('15550001111@s.whatsapp.net')).toBe('+15550001111');
    expect(formatNumber('+1 555 000 1111')).toBe('+15550001111');
  });

  it('keeps an id with no digits as-is', () => {
    expect(formatNumber('abc')).toBe('abc');
  });
});

describe('mergeMyNumbers', () => {
  it('shows a number linked on two channels once, unverified if either link is', () => {
    const merged = mergeMyNumbers([
      {
        channel: 'whatsapp-cloud',
        numbers: [{ senderId: '15550001111', linkedAt: '', lastSeenAt: null, verified: true }],
      },
      {
        channel: 'whatsapp',
        numbers: [
          {
            senderId: '15550001111@s.whatsapp.net',
            linkedAt: '',
            lastSeenAt: null,
            verified: false,
          },
        ],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.display).toBe('+15550001111');
    expect(merged[0]?.verified).toBe(false);
    expect(merged[0]?.entries.map(entry => entry.channel)).toEqual(['whatsapp-cloud', 'whatsapp']);
  });
});

describe('channelAccessFromError', () => {
  it('reads 404 as a channel this deployment does not run', () => {
    expect(channelAccessFromError('teams', new ClawApiError(404, 'Unknown channel'))).toEqual({
      kind: 'unavailable',
      channel: 'teams',
    });
  });

  it('reads 403 as admin-only', () => {
    expect(channelAccessFromError('whatsapp-cloud', new ClawApiError(403, 'x')).kind).toBe(
      'forbidden',
    );
  });

  it('rethrows anything else so a failed load never reads as "none"', () => {
    expect(() => channelAccessFromError('whatsapp', new ClawApiError(500, 'boom'))).toThrow('boom');
  });
});

describe('groupAccountsByAgent', () => {
  it('groups by agent, sorted by name, with unbound accounts last', () => {
    const groups = groupAccountsByAgent([
      account('a', null),
      account('b', { slug: 'zed', name: 'Zed' }),
      account('c', { slug: 'amy', name: 'Amy' }, 'whatsapp-cloud'),
      account('d', { slug: 'zed', name: 'Zed' }, 'whatsapp-cloud'),
    ]);
    expect(groups.map(group => group.agent?.slug ?? null)).toEqual(['amy', 'zed', null]);
    expect(groups[1]?.accounts.map(row => row.id)).toEqual(['b', 'd']);
  });
});

describe('linkErrorText', () => {
  it('shows the server message when there is one', () => {
    const error = new ClawApiError(400, 'That code isn’t right. 2 tries left.');
    expect(linkErrorText(error, 'confirm')).toBe('That code isn’t right. 2 tries left.');
  });

  it('falls back to status copy for a bare failure', () => {
    expect(linkErrorText(new ClawApiError(503, 'Request failed: 503'), 'send')).toMatch(
      /in a minute/,
    );
    expect(linkErrorText(new ClawApiError(410, ''), 'confirm')).toMatch(/expired/);
  });

  it('uses a generic message for non-errors', () => {
    expect(linkErrorText('nope', 'send')).toBe('Could not send a code. Please try again.');
  });
});

describe('keepCodeStepAfter', () => {
  it('leaves the code step only when the number was claimed by someone else', () => {
    expect(keepCodeStepAfter(new ClawApiError(409, 'x'))).toBe(false);
    expect(keepCodeStepAfter(new ClawApiError(410, 'x'))).toBe(true);
    expect(keepCodeStepAfter(new ClawApiError(429, 'x'))).toBe(true);
    expect(keepCodeStepAfter(new ClawApiError(400, 'x'))).toBe(true);
  });
});

describe('isCompleteCode', () => {
  it('accepts six digits, ignoring spaces', () => {
    expect(isCompleteCode('123 456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
    expect(isCompleteCode('12345a')).toBe(false);
  });
});
