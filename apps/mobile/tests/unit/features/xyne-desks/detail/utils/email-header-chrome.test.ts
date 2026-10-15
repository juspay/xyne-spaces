import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TicketDetailSnapshot } from '@/src/features/xyne-desks/detail/types';
import { shouldShowEmailHeaderChrome } from '@/src/features/xyne-desks/detail/utils/desk-channel-kind';
import { mapTicketDetail } from '@/src/features/xyne-desks/detail/utils/map-ticket-detail';

/**
 * Shape written by public App Desk inbound (ticketController ticketMetadata)
 * and stored on tickets.metadata (Zero json() → object at read time).
 */
const APP_DESK_INBOUND_METADATA = {
  deskSource: {
    type: 'app',
    installedAppId: 'installed-app-1',
    appName: 'HR Portal',
  },
  fromEmailAddress: 'Ada Lovelace <ada@example.com>',
  reporterEmail: 'ada@example.com',
} as const;

function expectDetail(row: unknown): TicketDetailSnapshot {
  const detail = mapTicketDetail(row);
  if (detail === null) {
    assert.fail('expected mapTicketDetail to return a snapshot');
  }
  return detail;
}

describe('email header chrome (mapTicketDetail → shouldShowEmailHeaderChrome)', () => {
  it('hides Gmail From/To chrome for app-sourced tickets on an EMAIL desk', () => {
    const detail = expectDetail({
      id: 'ticket-1',
      channelId: 'email-desk-1',
      metadata: APP_DESK_INBOUND_METADATA,
    });
    assert.deepEqual(detail.deskSource, { type: 'app' });
    assert.equal(shouldShowEmailHeaderChrome('EMAIL', detail.deskSource), false);
  });

  it('keeps Gmail From/To chrome for normal EMAIL desk tickets', () => {
    const detail = expectDetail({
      id: 'ticket-2',
      channelId: 'email-desk-1',
      metadata: { fromEmailAddress: 'bob@example.com' },
    });
    assert.equal(detail.deskSource, null);
    assert.equal(shouldShowEmailHeaderChrome('EMAIL', detail.deskSource), true);
  });

  it('hides chrome on APP/SLACK desks regardless of deskSource', () => {
    const detail = expectDetail({ id: 'ticket-3' });
    assert.equal(shouldShowEmailHeaderChrome('APP', detail.deskSource), false);
    assert.equal(shouldShowEmailHeaderChrome('SLACK', detail.deskSource), false);
  });

  it('treats Zero metadata as an object — serialized JSON strings are ignored', () => {
    const detail = expectDetail({
      id: 'ticket-4',
      metadata: JSON.stringify(APP_DESK_INBOUND_METADATA),
    });
    assert.equal(detail.deskSource, null);
    assert.equal(shouldShowEmailHeaderChrome('EMAIL', detail.deskSource), true);
  });

  it('trims deskSource.type and ignores producer-only fields', () => {
    const detail = expectDetail({
      id: 'ticket-5',
      metadata: {
        deskSource: {
          type: '  app  ',
          installedAppId: 'x',
          appName: 'Y',
          extra: true,
        },
      },
    });
    assert.deepEqual(detail.deskSource, { type: 'app' });
    assert.equal(shouldShowEmailHeaderChrome('EMAIL', detail.deskSource), false);
  });
});
