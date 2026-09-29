import { describe, expect, it } from 'vitest';
import { avatarUrl, etaState, fieldSave, parseOptions, parseValues, resolveFields, closeMove, doneMove, stageMove, stageOptions, stageEtaState } from '../lib/ticketPanel';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const st = (id: string, name: string, seq: number, over: object = {}) => ({ id, name, sequenceNumber: seq, eta: 8, defaultTicketStatusV2: 'STARTED', requestApprovalOnEntry: false, ...over });
const STAGES = [st('s2', 'IN DEV', 2), st('s1', 'OPEN', 1, { defaultTicketStatusV2: 'TODO' }), st('s3', 'REVIEW', 3, { requestApprovalOnEntry: true }), st('s4', 'DONE', 4, { defaultTicketStatusV2: 'COMPLETED', eta: 0 })];

describe('stageOptions', () => {
  it('orders stages, numbers them and marks the current one (linear board)', () => {
    const o = stageOptions('IN DEV', STAGES, [], false);
    expect(o.map(s => [s.name, s.label, s.current])).toEqual([['OPEN', '1/4', false], ['IN DEV', '2/4', true], ['REVIEW', '3/4', false], ['DONE', '4/4', false]]);
    expect(o.filter(s => s.allowed).map(s => s.name)).toEqual(['OPEN', 'REVIEW', 'DONE']);
    expect(o.find(s => s.name === 'REVIEW')!.gate).toBe('approval');
  });

  it('on a non-linear board only allows stages with a transition from the current one, and flags forms', () => {
    const tr = [
      { fromStageId: 's2', toStageId: 's3' },
      { fromStageId: 's2', toStageId: 's4', formId: 'f1' },
      { toStageId: 's1' },
    ];
    const o = stageOptions('IN DEV', STAGES, tr, true);
    expect(o.filter(s => s.allowed).map(s => s.name)).toEqual(['OPEN', 'REVIEW', 'DONE']);
    expect(o.find(s => s.name === 'DONE')!.gate).toBe('form');
    expect(o.find(s => s.name === 'OPEN')!.gate).toBe(null);
  });
});

describe('stageMove', () => {
  it('updates stage and status on linear boards, transitions on non-linear ones', () => {
    expect(stageMove(STAGES[3] as never, false)).toEqual({ kind: 'update', data: { stageName: 'DONE', statusV2: 'COMPLETED' } });
    expect(stageMove(STAGES[3] as never, true)).toEqual({ kind: 'transition', toStageName: 'DONE' });
  });
});

describe('field values', () => {
  it('parses stored values and options in their several shapes', () => {
    expect(parseValues('F2')).toEqual(['F2']);
    expect(parseValues('["Android","iOS"]')).toEqual(['Android', 'iOS']);
    expect(parseValues(['Web'])).toEqual(['Web']);
    expect(parseValues(null)).toEqual([]);
    expect(parseValues('')).toEqual([]);
    expect(parseValues(true)).toEqual(['true']);
    expect(parseOptions('[{"id":"a","value":"F1"},{"id":"b","value":"F2"}]')).toEqual(['F1', 'F2']);
    expect(parseOptions('["Yes","No"]')).toEqual(['Yes', 'No']);
    expect(parseOptions(null)).toEqual([]);
  });

  const mapping = {
    formId: 'board-form',
    formFields: [
      { id: 'm1', globalFieldId: 'g-track', globalField: { fieldName: 'Merchant Track', fieldType: 'SINGLE_SELECT', fieldOptions: '[{"id":"a","value":"F1"},{"id":"b","value":"F2"}]' }, sequenceNumber: 2, isOptional: true },
      { id: 'm2', globalFieldId: null, fieldName: 'Comments', fieldType: 'STRING', sequenceNumber: 1, isOptional: true },
      { id: 'm3', globalFieldId: 'g-platform', globalField: { fieldName: 'Platform', fieldType: 'MULTI_SELECT', fieldEnum: '["Android","iOS","Web"]' }, sequenceNumber: 3, isOptional: true },
    ],
  };
  const values = [
    // board-context value on the board form: real, editable row
    { id: 'v1', formId: 'board-form', fieldId: 'm2', contextId: 'board-1', actualFieldValue: 'hello', fieldValue: '', updatedAt: 5 },
    // entity-wide value from a stage form: shown as a prefill (saving creates a board row)
    { id: 'v2', formId: 'stage-form', fieldId: 'g-track', contextId: 'stage-9', actualFieldValue: 'F2', fieldValue: '', updatedAt: 3 },
    { id: 'v3', formId: 'stage-form', fieldId: 'g-track', contextId: 'stage-8', actualFieldValue: 'F1', fieldValue: '', updatedAt: 1 },
  ];

  it('resolves board fields in order with real, prefilled and empty rows, like Desk', () => {
    const rows = resolveFields(mapping as never, values as never, 'board-1');
    expect(rows.map(r => [r.fieldId, r.name, r.type, r.values, r.rowId, r.formId])).toEqual([
      ['m2', 'Comments', 'STRING', ['hello'], 'v1', 'board-form'],
      ['g-track', 'Merchant Track', 'SINGLE_SELECT', ['F2'], null, 'board-form'],
      ['g-platform', 'Platform', 'MULTI_SELECT', [], null, 'board-form'],
    ]);
    expect(rows[1].options).toEqual(['F1', 'F2']);
    expect(rows[2].options).toEqual(['Android', 'iOS', 'Web']);
  });

  it('builds the save call: update a real row, create a board row otherwise (always string[])', () => {
    const rows = resolveFields(mapping as never, values as never, 'board-1');
    expect(fieldSave(rows[0], ['bye'], 't1', 'board-1')).toEqual({ kind: 'update', id: 'v1', newValue: ['bye'] });
    expect(fieldSave(rows[1], ['F1'], 't1', 'board-1')).toEqual({
      kind: 'create',
      data: { entityId: 't1', entityType: 'TICKET', formId: 'board-form', fieldId: 'g-track', newValue: ['F1'], contextId: 'board-1' },
    });
  });
});

describe('ETA states', () => {
  it('finds the current stage ETA entry and whether it is breached', () => {
    const entries = [
      { id: 'e0', stageId: 's1', stageLeftAt: 10, stageEta: 5 },
      { id: 'e1', stageId: 's2', stageLeftAt: null, stageEta: NOW - DAY },
    ];
    expect(stageEtaState('IN DEV', STAGES as never, entries as never, NOW)).toEqual({ show: true, entryId: 'e1', stageId: 's2', eta: NOW - DAY, breached: true });
    // A stage with no ETA configured shows no chip.
    expect(stageEtaState('DONE', STAGES as never, [] as never, NOW)).toMatchObject({ show: false });
    // Configured but not started: chip shows, no entry yet.
    expect(stageEtaState('OPEN', STAGES as never, [] as never, NOW)).toEqual({ show: true, entryId: null, stageId: 's1', eta: null, breached: false });
  });

  it('says whether the ticket ETA is breached for open tickets only', () => {
    expect(etaState(NOW - 1, true, NOW)).toEqual({ eta: NOW - 1, breached: true });
    expect(etaState(NOW - 1, false, NOW)).toEqual({ eta: NOW - 1, breached: false });
    expect(etaState(null, true, NOW)).toEqual({ eta: null, breached: false });
  });
});

describe('avatarUrl', () => {
  it('uses web picture URLs and skips stored uploads the app cannot fetch', () => {
    expect(avatarUrl('https://lh3.googleusercontent.com/a/x')).toBe('https://lh3.googleusercontent.com/a/x');
    expect(avatarUrl('attachments/2026/08/1-profile')).toBeNull();
    expect(avatarUrl(null)).toBeNull();
  });
});

describe('doneMove', () => {
  const board = [
    st('a', 'To be Picked Up', 1, { defaultTicketStatusV2: 'TODO' }),
    st('b', 'Dev in Progress', 2),
    st('p', 'Prod', 7, { defaultTicketStatusV2: 'COMPLETED' }),
    st('r', 'Rejected', 8, { defaultTicketStatusV2: 'CANCELLED' }),
  ];

  it('moves to the first Completed stage on a linear board, like the stage picker', () => {
    expect(doneMove('To be Picked Up', board, [], 'DEFAULT')).toEqual({ kind: 'update', data: { stageName: 'Prod', statusV2: 'COMPLETED' } });
  });

  it('only sets the status when no stage is Completed, like the status picker', () => {
    // e.g. a "Completed" stage whose default status is STARTED
    const noDone = [st('t', 'To Do', 1), st('c', 'Completed', 6)];
    expect(doneMove('To Do', noDone, [], 'DEFAULT')).toEqual({ kind: 'update', data: { statusV2: 'COMPLETED' } });
    expect(doneMove('Prod', board, [], 'DEFAULT')).toEqual({ kind: 'update', data: { statusV2: 'COMPLETED' } });
  });

  it('uses a transition on non-linear boards, and needs an edge to the done stage', () => {
    expect(doneMove('Dev in Progress', board, [{ fromStageId: 'b', toStageId: 'p' }], 'NON_LINEAR')).toEqual({ kind: 'transition', toStageName: 'Prod' });
    expect(doneMove('Dev in Progress', board, [{ fromStageId: 'a', toStageId: 'p' }], 'NON_LINEAR')).toEqual({ kind: 'blocked', reason: 'no move to Prod from Dev in Progress' });
  });

  it('sends gated moves and Flow boards to Xyne', () => {
    expect(doneMove('To be Picked Up', board, [{ toStageId: 'p', formId: 'f1' }], 'DEFAULT')).toEqual({ kind: 'blocked', reason: 'Prod needs a form' });
    const approval = board.map(s => (s.id === 'p' ? { ...s, requestApprovalOnEntry: true } : s));
    expect(doneMove('To be Picked Up', approval, [], 'DEFAULT')).toEqual({ kind: 'blocked', reason: 'Prod needs approval' });
    expect(doneMove('To be Picked Up', board, [], 'FLOW')).toEqual({ kind: 'blocked', reason: 'Flow tickets finish through their steps' });
  });
});

describe('closeMove', () => {
  const st2 = (id: string, name: string, seq: number, status: string) => st(id, name, seq, { defaultTicketStatusV2: status });

  it('prefers the board\'s Cancelled stage, then its Completed stage', () => {
    const b = [st2('a', 'To be Picked Up', 1, 'TODO'), st2('p', 'Prod', 7, 'COMPLETED'), st2('r', 'Rejected', 8, 'CANCELLED')];
    expect(closeMove('To be Picked Up', b, [], 'DEFAULT')).toEqual({ kind: 'update', data: { stageName: 'Rejected', statusV2: 'CANCELLED' } });
    const noCancel = b.slice(0, 2);
    expect(closeMove('To be Picked Up', noCancel, [], 'DEFAULT')).toEqual({ kind: 'update', data: { stageName: 'Prod', statusV2: 'COMPLETED' } });
  });

  it('cancels by status alone when no stage is terminal, and keeps the same gates', () => {
    expect(closeMove('To Do', [st2('t', 'To Do', 1, 'STARTED'), st2('c', 'Completed', 6, 'STARTED')], [], 'DEFAULT')).toEqual({ kind: 'update', data: { statusV2: 'CANCELLED' } });
    const b = [st2('a', 'Open', 1, 'TODO'), st2('r', 'Dropped', 2, 'CANCELLED')];
    expect(closeMove('Open', b, [{ toStageId: 'r', formId: 'f' }], 'DEFAULT')).toEqual({ kind: 'blocked', reason: 'Dropped needs a form' });
    expect(closeMove('Open', b, [{ fromStageId: 'a', toStageId: 'r' }], 'NON_LINEAR')).toEqual({ kind: 'transition', toStageName: 'Dropped' });
  });
});
