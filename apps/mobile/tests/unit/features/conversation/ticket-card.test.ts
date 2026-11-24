import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TicketPreview } from '@/src/features/chat/v2/paint/chatPaint.types';
import {
  dayMonthLabel,
  ticketCardHeight,
  ticketCardModel,
} from '@/src/features/conversation/model/ticket-card';

const preview: TicketPreview = {
  ticketId: 'XYN-241',
  title: 'Make the payment ID once',
  description: null,
  statusLabel: 'In progress',
  priority: 'CRITICAL',
};

describe('ticketCardModel', () => {
  it('reads the number, title, status and priority', () => {
    const model = ticketCardModel(preview, { statusV2: 'STARTED' });
    assert.equal(model.number, 'XYN-241');
    assert.equal(model.title, 'Make the payment ID once');
    assert.deepEqual(model.status, { label: 'In progress', glyph: 'inProgress' });
    assert.deepEqual(model.priority, { label: 'Urgent', lit: 3, isUrgent: true });
    assert.equal(model.dueLabel, null);
  });

  it('lights one bar per priority step', () => {
    const lit = (priority: string): number | undefined =>
      ticketCardModel({ ...preview, priority }, null).priority?.lit;
    assert.equal(lit('LOW'), 1);
    assert.equal(lit('MEDIUM'), 2);
    assert.equal(lit('HIGH'), 3);
  });

  it('leaves an unknown priority off and reads an unknown status as to-do', () => {
    const model = ticketCardModel({ ...preview, priority: null }, null);
    assert.equal(model.priority, null);
    assert.equal(model.status.glyph, 'todo');
  });

  it('marks finished and stopped tickets', () => {
    assert.equal(ticketCardModel(preview, { statusV2: 'COMPLETED' }).status.glyph, 'done');
    assert.equal(ticketCardModel(preview, { statusV2: 'PAUSED' }).status.glyph, 'blocked');
    assert.equal(ticketCardModel(preview, { statusV2: 'CANCELLED' }).status.glyph, 'blocked');
  });

  it('shows the ETA as a date', () => {
    const eta = new Date(2026, 9, 15, 12).getTime();
    assert.equal(ticketCardModel(preview, { eta }).dueLabel, '15 Oct');
  });
});

describe('dayMonthLabel', () => {
  it('takes milliseconds or seconds', () => {
    const ms = new Date(2026, 0, 3, 12).getTime();
    assert.equal(dayMonthLabel(ms), '3 Jan');
    assert.equal(dayMonthLabel(Math.floor(ms / 1000)), '3 Jan');
  });

  it('is empty without a time', () => {
    assert.equal(dayMonthLabel(null), '');
    assert.equal(dayMonthLabel(0), '');
  });
});

describe('ticketCardHeight', () => {
  it('matches Figma for one and two title lines, and caps at two', () => {
    assert.equal(ticketCardHeight(1), 118);
    assert.equal(ticketCardHeight(2), 138);
    assert.equal(ticketCardHeight(5), 138);
    assert.equal(ticketCardHeight(0), 118);
  });
});
