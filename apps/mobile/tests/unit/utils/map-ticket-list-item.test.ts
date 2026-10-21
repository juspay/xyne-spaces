import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mapTicketListItem } from '@/src/features/xyne-desks/tickets/utils/map-ticket-list-item';

describe('mapTicketListItem', () => {
  it('maps a fully populated row verbatim (trimming text fields)', () => {
    const item = mapTicketListItem({
      id: 'ticket-1',
      xyneId: '  UPI-42  ',
      title: '  Payment failed  ',
      stageName: 'Open',
      emailCount: 3,
      lastEmailAt: 1700,
      isUnread: true,
      senderName: '  Alice  ',
      snippet: '  card declined  ',
    });

    assert.deepEqual(item, {
      id: 'ticket-1',
      xyneId: 'UPI-42',
      title: 'Payment failed',
      stageName: 'Open',
      emailCount: 3,
      lastEmailAt: 1700,
      isUnread: true,
      isStarred: false,
      senderName: 'Alice',
      snippet: 'card declined',
    });
  });

  it('falls back xyneId to id and title to "(No subject)"', () => {
    const item = mapTicketListItem({ id: 'raw-id', xyneId: '   ', title: '' });
    assert.equal(item.xyneId, 'raw-id');
    assert.equal(item.title, '(No subject)');
  });

  it('falls back senderName to the resolved xyneId when absent', () => {
    const item = mapTicketListItem({ id: 'raw-id', xyneId: 'HUMAN-1', senderName: '  ' });
    assert.equal(item.senderName, 'HUMAN-1');
  });

  it('builds a snippet from stage + email count when no snippet is given', () => {
    const item = mapTicketListItem({ id: 't', stageName: 'Triage', emailCount: 2 });
    assert.equal(item.snippet, 'Triage · 2 emails');
  });

  it('singularizes the email-count fragment', () => {
    const item = mapTicketListItem({ id: 't', stageName: 'Triage', emailCount: 1 });
    assert.equal(item.snippet, 'Triage · 1 email');
  });

  it('omits the email fragment when count is zero', () => {
    const item = mapTicketListItem({ id: 't', stageName: 'Triage', emailCount: 0 });
    assert.equal(item.snippet, 'Triage');
  });

  it('falls back snippet to "No preview" when nothing is available', () => {
    const item = mapTicketListItem({ id: 't' });
    assert.equal(item.snippet, 'No preview');
    assert.equal(item.stageName, null);
    assert.equal(item.emailCount, 0);
    assert.equal(item.lastEmailAt, 0);
    assert.equal(item.isUnread, false);
    assert.equal(item.isStarred, false);
  });

  it('maps isStarred when provided', () => {
    const item = mapTicketListItem({ id: 't', isStarred: true });
    assert.equal(item.isStarred, true);
  });
});
