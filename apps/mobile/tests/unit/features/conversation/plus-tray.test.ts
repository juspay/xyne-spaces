import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  openPlusTray,
  plusTrayExitFocus,
  plusTraySections,
  type PlusTrayComposer,
  type PlusTrayRow,
} from '@/src/features/conversation/model/plus-tray';

const OPEN: PlusTrayComposer = {
  attachmentSlotsLeft: 10,
  picking: false,
  canSchedule: true,
  offline: false,
  formattingVisible: false,
};

const rowsOf = (state: PlusTrayComposer): readonly PlusTrayRow[] =>
  plusTraySections(state).flatMap(section => section.rows);

const rowById = (state: PlusTrayComposer, id: PlusTrayRow['id']): PlusTrayRow => {
  const row = rowsOf(state).find(candidate => candidate.id === id);
  assert.ok(row, `missing row ${id}`);
  return row;
};

describe('plusTraySections', () => {
  it('groups attachments before the message tools, in Figma order', () => {
    const sections = plusTraySections(OPEN);
    assert.deepEqual(
      sections.map(section => [section.id, section.rows.map(row => row.id)]),
      [
        ['attach', ['photos', 'camera', 'files']],
        ['compose', ['emoji', 'formatting', 'schedule']],
      ],
    );
  });

  it('enables every row when there is room, nothing is picking and there is a message', () => {
    assert.ok(rowsOf(OPEN).every(row => !row.disabled));
  });

  it('turns the pickers off while one is open', () => {
    const state = { ...OPEN, picking: true };
    for (const id of ['photos', 'camera', 'files'] as const) {
      assert.equal(rowById(state, id).disabled, true);
    }
    assert.equal(rowById(state, 'emoji').disabled, false);
  });

  it('turns the pickers off and says why once the attachment limit is reached', () => {
    const state = { ...OPEN, attachmentSlotsLeft: 0 };
    for (const id of ['photos', 'camera', 'files'] as const) {
      const row = rowById(state, id);
      assert.equal(row.disabled, true);
      assert.equal(row.subtitle, 'Attachment limit reached');
    }
  });

  it('turns scheduling off while offline, saying why', () => {
    const row = rowById({ ...OPEN, offline: true }, 'schedule');
    assert.equal(row.disabled, true);
    assert.equal(row.subtitle, "You're offline");
  });

  it('needs something to send before scheduling', () => {
    const row = rowById({ ...OPEN, canSchedule: false }, 'schedule');
    assert.equal(row.disabled, true);
    assert.equal(row.subtitle, 'Write a message first');
  });

  it('offers to hide the formatting bar once it is showing', () => {
    assert.equal(
      rowById({ ...OPEN, formattingVisible: true }, 'formatting').subtitle,
      'Hide the formatting bar',
    );
    assert.equal(rowById(OPEN, 'formatting').subtitle, 'Bold, lists, code and links');
  });
});

describe('plus tray state', () => {
  it('remembers whether it put the keyboard away as it opened', () => {
    assert.deepEqual(openPlusTray(true), { open: true, heldKeyboard: true });
    assert.deepEqual(openPlusTray(false), { open: true, heldKeyboard: false });
  });
});

describe('plusTrayExitFocus', () => {
  it('brings a held keyboard back when the tray is put away, and leaves a closed one', () => {
    assert.equal(plusTrayExitFocus(true, 'dismiss'), 'restore');
    assert.equal(plusTrayExitFocus(false, 'dismiss'), 'none');
  });

  it('always returns to the field for the formatting strip', () => {
    assert.equal(plusTrayExitFocus(true, 'formatting'), 'restore');
    assert.equal(plusTrayExitFocus(false, 'formatting'), 'focus');
  });

  it('lets go of a held focus for a surface that takes over', () => {
    assert.equal(plusTrayExitFocus(true, 'handoff'), 'release');
    assert.equal(plusTrayExitFocus(false, 'handoff'), 'none');
  });
});
