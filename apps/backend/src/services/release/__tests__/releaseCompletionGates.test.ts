jest.mock('@xyne/shared', () => ({
  BoardType: { DEFAULT: 'DEFAULT', RELEASE: 'RELEASE', NON_LINEAR: 'NON_LINEAR', FLOW: 'FLOW' },
}));

import { BoardType } from '@xyne/shared';
import { evaluateReleaseCompletionGates, type GateTransition, type LinearStageGate } from '../releaseCompletionGates';

const edge = (from: string | null, to: string, extra: Partial<GateTransition> = {}): GateTransition => ({
  id: `${from ?? '*'}->${to}`,
  fromStageId: from,
  toStageId: to,
  formId: null,
  requiresApproval: false,
  bypassApprovalForAutomation: false,
  ...extra,
});

const nl = (transitions: GateTransition[], path: string[], currentStageId = 'Build') =>
  evaluateReleaseCompletionGates({
    boardType: BoardType.NON_LINEAR,
    currentStageId,
    path,
    transitions,
    linearStageGates: new Map(),
  });

const linear = (gates: Record<string, Partial<LinearStageGate>>, path: string[]) =>
  evaluateReleaseCompletionGates({
    boardType: BoardType.DEFAULT,
    currentStageId: 'Dev',
    path,
    transitions: [],
    linearStageGates: new Map(Object.entries(gates).map(([k, v]) => [k, { hasForm: false, hasApprovers: false, ...v }])),
  });

describe('evaluateReleaseCompletionGates', () => {
  describe('NON_LINEAR', () => {
    it('is clear when no hop is gated', () => {
      expect(nl([edge('Build', 'Merged'), edge('Merged', 'Closed')], ['Merged', 'Closed']).kind).toBe('CLEAR');
    });

    it('blocks on an intermediate approval edge and reports the stop stage', () => {
      const r = nl([edge('Build', 'Merged', { requiresApproval: true }), edge('Merged', 'Closed')], ['Merged', 'Closed']);
      expect(r).toMatchObject({ kind: 'BLOCKED', gate: 'APPROVAL', hopIndex: 0, fromStageId: 'Build', toStageId: 'Merged', transitionId: 'Build->Merged' });
    });

    it('honours bypassApprovalForAutomation', () => {
      const r = nl([edge('Build', 'Closed', { requiresApproval: true, bypassApprovalForAutomation: true })], ['Closed']);
      expect(r.kind).toBe('CLEAR');
    });

    it('blocks on an edge form even when approval is bypassed', () => {
      const r = nl([edge('Build', 'Merged'), edge('Merged', 'Closed', { formId: 'f1', requiresApproval: true, bypassApprovalForAutomation: true })], ['Merged', 'Closed']);
      expect(r).toMatchObject({ kind: 'BLOCKED', gate: 'FORM', fromStageId: 'Merged', toStageId: 'Closed' });
    });

    it('falls back to a global edge for the hop', () => {
      const r = nl([edge('Build', 'Merged'), edge(null, 'Closed', { requiresApproval: true })], ['Closed']);
      expect(r).toMatchObject({ kind: 'BLOCKED', gate: 'APPROVAL', transitionId: '*->Closed' });
    });

    it('rejects a hop with no allowed edge from a stage that has outgoing edges', () => {
      const r = nl([edge('Rejected', 'Backlog')], ['Closed'], 'Rejected');
      expect(r).toMatchObject({ kind: 'BLOCKED', gate: 'NOT_ALLOWED', fromStageId: 'Rejected' });
    });

    it('treats a stage with no outgoing edges as unrestricted (REST semantics)', () => {
      expect(nl([], ['Closed'], 'Rejected').kind).toBe('CLEAR');
    });
  });

  describe('linear', () => {
    it('blocks on an intermediate stage with approvers', () => {
      const r = linear({ Merged: { hasApprovers: true } }, ['Merged', 'Done']);
      expect(r).toMatchObject({ kind: 'BLOCKED', gate: 'APPROVAL', hopIndex: 0, fromStageId: 'Dev', toStageId: 'Merged', transitionId: null });
    });

    it('blocks on a target stage form after advancing through clear stages', () => {
      const r = linear({ Done: { hasForm: true } }, ['Merged', 'Done']);
      expect(r).toMatchObject({ kind: 'BLOCKED', gate: 'FORM', hopIndex: 1, fromStageId: 'Merged' });
    });

    it('is clear when no stage on the route is gated', () => {
      expect(linear({}, ['Merged', 'Done']).kind).toBe('CLEAR');
    });
  });
});
