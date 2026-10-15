import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createActor } from 'xstate';

import { attachmentsMachine, type AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';

const item = (id: string): AttachmentsViewerItem => ({ id, mimetype: 'image/png' });

const startActor = (): ReturnType<typeof createActor<typeof attachmentsMachine>> => {
  const actor = createActor(attachmentsMachine);
  actor.start();
  return actor;
};

describe('attachmentsMachine', () => {
  it('starts idle with an empty context', () => {
    const actor = startActor();
    const snap = actor.getSnapshot();
    assert.equal(snap.value, 'idle');
    assert.deepEqual(snap.context.attachments, []);
    assert.equal(snap.context.currentIndex, 0);
    assert.equal(snap.context.source, null);
    actor.stop();
  });

  it('opens with clamped index and provided source', () => {
    const actor = startActor();
    actor.send({
      type: 'OPEN',
      attachments: [item('a'), item('b'), item('c')],
      initialIndex: 5,
      source: { kind: 'message', id: 'm1' },
    });
    const snap = actor.getSnapshot();
    assert.equal(snap.value, 'open');
    assert.equal(snap.context.currentIndex, 2);
    assert.deepEqual(snap.context.source, { kind: 'message', id: 'm1' });
    actor.stop();
  });

  it('clamps a negative initial index to 0 and defaults source to null', () => {
    const actor = startActor();
    actor.send({ type: 'OPEN', attachments: [item('a'), item('b')], initialIndex: -3 });
    const snap = actor.getSnapshot();
    assert.equal(snap.context.currentIndex, 0);
    assert.equal(snap.context.source, null);
    actor.stop();
  });

  it('keeps index 0 when opening with no attachments', () => {
    const actor = startActor();
    actor.send({ type: 'OPEN', attachments: [], initialIndex: 4 });
    const snap = actor.getSnapshot();
    assert.equal(snap.value, 'open');
    assert.equal(snap.context.currentIndex, 0);
    actor.stop();
  });

  it('clamps SET_INDEX within bounds while open', () => {
    const actor = startActor();
    actor.send({ type: 'OPEN', attachments: [item('a'), item('b'), item('c')] });
    actor.send({ type: 'SET_INDEX', index: 99 });
    assert.equal(actor.getSnapshot().context.currentIndex, 2);
    actor.send({ type: 'SET_INDEX', index: -5 });
    assert.equal(actor.getSnapshot().context.currentIndex, 0);
    actor.send({ type: 'SET_INDEX', index: 1 });
    assert.equal(actor.getSnapshot().context.currentIndex, 1);
    actor.stop();
  });

  it('re-opens with fresh context while already open', () => {
    const actor = startActor();
    actor.send({ type: 'OPEN', attachments: [item('a')], source: { kind: 'ticket', id: 't1' } });
    actor.send({
      type: 'OPEN',
      attachments: [item('x'), item('y')],
      initialIndex: 1,
      source: { kind: 'search', id: 's1' },
    });
    const snap = actor.getSnapshot();
    assert.equal(snap.value, 'open');
    assert.equal(snap.context.attachments.length, 2);
    assert.equal(snap.context.currentIndex, 1);
    assert.deepEqual(snap.context.source, { kind: 'search', id: 's1' });
    actor.stop();
  });

  it('resets to idle with initial context on CLOSE', () => {
    const actor = startActor();
    actor.send({ type: 'OPEN', attachments: [item('a'), item('b')], initialIndex: 1 });
    actor.send({ type: 'CLOSE' });
    const snap = actor.getSnapshot();
    assert.equal(snap.value, 'idle');
    assert.deepEqual(snap.context.attachments, []);
    assert.equal(snap.context.currentIndex, 0);
    assert.equal(snap.context.source, null);
    actor.stop();
  });

  it('ignores OPEN-only events while idle without SET_INDEX effect', () => {
    const actor = startActor();
    actor.send({ type: 'SET_INDEX', index: 3 });
    const snap = actor.getSnapshot();
    assert.equal(snap.value, 'idle');
    assert.equal(snap.context.currentIndex, 0);
    actor.stop();
  });
});
