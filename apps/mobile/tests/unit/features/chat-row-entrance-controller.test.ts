import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RowEntranceController } from '@/src/features/chat/v2/components/chat/chat-row-entrance-controller';

type Row = { id: string; type: 'message' | 'divider' };

const messages = (...ids: string[]): Row[] => ids.map(id => ({ id, type: 'message' }));

describe('RowEntranceController', (): void => {
  it('does not animate the rows present when the list is first revealed', (): void => {
    const controller = new RowEntranceController<Row>('open', { getId: (row): string => row.id });

    controller.onRevealed(messages('a', 'b'));

    assert.equal(controller.trackNewRows(messages('a', 'b')), false);
    assert.deepEqual([...controller.getPending()], []);
  });

  it('animates only messages appended after the previously known tail', (): void => {
    const controller = new RowEntranceController<Row>('open', { getId: (row): string => row.id });
    controller.onRevealed(messages('a', 'b'));

    assert.equal(controller.trackNewRows(messages('a', 'b', 'c')), true);
    assert.deepEqual([...controller.getPending()], ['c']);

    controller.flushPending();
    assert.equal(controller.trackNewRows(messages('a', 'b', 'c')), false);
  });

  it('does not animate older messages prepended during pagination', (): void => {
    const controller = new RowEntranceController<Row>('open', { getId: (row): string => row.id });
    controller.onRevealed(messages('b', 'c'));

    assert.equal(controller.trackNewRows(messages('a', 'b', 'c')), false);
    assert.deepEqual([...controller.getPending()], []);
  });

  it('does not animate when a cache window replacement removes the old tail', (): void => {
    const controller = new RowEntranceController<Row>('open', { getId: (row): string => row.id });
    controller.onRevealed(messages('a', 'b'));

    assert.equal(controller.trackNewRows(messages('c', 'd')), false);
    assert.deepEqual([...controller.getPending()], []);
  });
});
