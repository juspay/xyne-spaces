import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  clearTicketDetailPaintCache,
  getTicketDetailPaintCache,
  setTicketDetailPaintCache,
} from '@/src/features/xyne-desks/detail/utils/ticket-detail-paint-cache';

type Snapshot = Parameters<typeof setTicketDetailPaintCache>[3];

const snapshot = (marker: string): Snapshot => ({ marker }) as unknown as Snapshot;

describe('ticket-detail-paint-cache', () => {
  beforeEach(() => {
    clearTicketDetailPaintCache();
  });

  it('returns null before anything is cached', () => {
    assert.equal(getTicketDetailPaintCache('s1', 'c1', 't1'), null);
  });

  it('stores and returns the exact snapshot reference', () => {
    const snap = snapshot('A');
    setTicketDetailPaintCache('s1', 'c1', 't1', snap);
    assert.equal(getTicketDetailPaintCache('s1', 'c1', 't1'), snap);
  });

  it('keeps stable identity for legacy snapshots that omit deskSource', () => {
    const snap = {
      id: 't1',
      xyneId: 'T-1',
      emails: [{ id: 'e1', attachments: [], attachmentCount: 0 }],
    } as unknown as Snapshot;
    setTicketDetailPaintCache('s1', 'c1', 't1', snap);
    assert.equal(getTicketDetailPaintCache('s1', 'c1', 't1'), snap);
    assert.equal('deskSource' in (snap as object), false);
  });

  it('keys entries independently by session, channel and ticket', () => {
    const a = snapshot('A');
    const b = snapshot('B');
    setTicketDetailPaintCache('s1', 'c1', 't1', a);
    setTicketDetailPaintCache('s1', 'c1', 't2', b);
    assert.equal(getTicketDetailPaintCache('s1', 'c1', 't1'), a);
    assert.equal(getTicketDetailPaintCache('s1', 'c1', 't2'), b);
  });

  it('ignores reads and writes with any empty key part', () => {
    setTicketDetailPaintCache('', 'c1', 't1', snapshot('A'));
    setTicketDetailPaintCache('s1', '', 't1', snapshot('B'));
    setTicketDetailPaintCache('s1', 'c1', '', snapshot('C'));
    assert.equal(getTicketDetailPaintCache('', 'c1', 't1'), null);
    assert.equal(getTicketDetailPaintCache('s1', '', 't1'), null);
    assert.equal(getTicketDetailPaintCache('s1', 'c1', ''), null);
  });

  it('clears everything when called with no arguments', () => {
    setTicketDetailPaintCache('s1', 'c1', 't1', snapshot('A'));
    setTicketDetailPaintCache('s2', 'c2', 't2', snapshot('B'));
    clearTicketDetailPaintCache();
    assert.equal(getTicketDetailPaintCache('s1', 'c1', 't1'), null);
    assert.equal(getTicketDetailPaintCache('s2', 'c2', 't2'), null);
  });

  it('deletes a single entry when session, channel and ticket are all given', () => {
    setTicketDetailPaintCache('s1', 'c1', 't1', snapshot('A'));
    setTicketDetailPaintCache('s1', 'c1', 't2', snapshot('B'));
    clearTicketDetailPaintCache('s1', 'c1', 't1');
    assert.equal(getTicketDetailPaintCache('s1', 'c1', 't1'), null);
    assert.notEqual(getTicketDetailPaintCache('s1', 'c1', 't2'), null);
  });

  it('clears a whole session by prefix', () => {
    setTicketDetailPaintCache('s1', 'c1', 't1', snapshot('A'));
    setTicketDetailPaintCache('s1', 'c2', 't2', snapshot('B'));
    setTicketDetailPaintCache('s2', 'c1', 't1', snapshot('C'));
    clearTicketDetailPaintCache('s1');
    assert.equal(getTicketDetailPaintCache('s1', 'c1', 't1'), null);
    assert.equal(getTicketDetailPaintCache('s1', 'c2', 't2'), null);
    assert.notEqual(getTicketDetailPaintCache('s2', 'c1', 't1'), null);
  });

  it('clears a single channel within a session by prefix', () => {
    setTicketDetailPaintCache('s1', 'c1', 't1', snapshot('A'));
    setTicketDetailPaintCache('s1', 'c2', 't2', snapshot('B'));
    clearTicketDetailPaintCache('s1', 'c1');
    assert.equal(getTicketDetailPaintCache('s1', 'c1', 't1'), null);
    assert.notEqual(getTicketDetailPaintCache('s1', 'c2', 't2'), null);
  });

  it('fills missing attachments arrays on cached emails', () => {
    const snap = {
      id: 't1',
      emails: [{ id: 'e1', attachmentCount: 2 }],
    } as unknown as Snapshot;
    setTicketDetailPaintCache('s1', 'c1', 't1', snap);
    const read = getTicketDetailPaintCache('s1', 'c1', 't1');
    assert.deepEqual(read?.emails[0]?.attachments, []);
    assert.equal(read?.emails[0]?.attachmentCount, 2);
  });
});
