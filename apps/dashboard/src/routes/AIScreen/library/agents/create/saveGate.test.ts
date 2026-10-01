import { describe, expect, it } from 'vitest';
import { computeSaveGate, type SaveGateInput } from './saveGate';

const READY: SaveGateInput = {
  created: false,
  creating: false,
  drafting: false,
  name: 'Morning Brief',
  slug: 'morning-brief',
  description: 'Sends a prioritized DM brief every weekday.',
  instructions: [
    'You are the morning brief agent.',
    '## Workflow',
    '1. Read unread DMs and assigned tickets.',
    '2. Send a short prioritized brief.',
    '## Guardrails',
    '- Never send without asking first.',
  ].join('\n'),
  conflictCount: 0,
  nameCheck: { checking: false, nameError: null, slugError: null },
};

describe('computeSaveGate', () => {
  it('allows a complete draft', () => {
    expect(computeSaveGate(READY)).toEqual({ canSave: true, reason: null });
  });

  it('blocks while the handle is taken, even after the check finished', () => {
    const gate = computeSaveGate({
      ...READY,
      nameCheck: { checking: false, nameError: null, slugError: 'taken' },
    });
    expect(gate.canSave).toBe(false);
    expect(gate.reason).toContain('@morning-brief is taken');
  });

  it('blocks while the name check is still running', () => {
    const gate = computeSaveGate({
      ...READY,
      nameCheck: { checking: true, nameError: null, slugError: null },
    });
    expect(gate).toEqual({ canSave: false, reason: 'Checking the name and handle…' });
  });

  it('blocks while chat is still drafting, so half-written instructions cannot save', () => {
    expect(computeSaveGate({ ...READY, drafting: true }).canSave).toBe(false);
  });

  it('blocks on unresolved chat conflicts', () => {
    expect(computeSaveGate({ ...READY, conflictCount: 1 }).reason).toMatch(/Keep mine/);
  });

  it('blocks instructions that the server contract would reject', () => {
    const gate = computeSaveGate({
      ...READY,
      instructions: 'Summarise tickets for my team each day, please.',
    });
    expect(gate.canSave).toBe(false);
    expect(gate.reason).toMatch(/Workflow/);
  });

  it('blocks a schedule that cannot be armed', () => {
    const gate = computeSaveGate({ ...READY, scheduleProblem: 'The scheduled time has passed.' });
    expect(gate).toEqual({ canSave: false, reason: 'The scheduled time has passed.' });
    expect(computeSaveGate({ ...READY, scheduleProblem: null }).canSave).toBe(true);
  });

  it('reports the first missing field', () => {
    expect(computeSaveGate({ ...READY, name: ' ' }).reason).toBe('Add a name.');
    expect(computeSaveGate({ ...READY, description: '' }).reason).toBe('Add a description.');
  });

  describe('editing a saved agent', () => {
    const editing = { dirty: true, instructionsChanged: false };

    it('waits for a change before Save', () => {
      expect(
        computeSaveGate({ ...READY, editing: { dirty: false, instructionsChanged: false } }),
      ).toEqual({ canSave: false, reason: 'Nothing has changed yet.' });
    });

    it('does not ask an older agent for a description', () => {
      expect(computeSaveGate({ ...READY, description: '', editing })).toEqual({
        canSave: true,
        reason: null,
      });
    });

    it('checks the instructions against the contract only once they change', () => {
      const old = { ...READY, instructions: 'Answer questions about tickets.' };
      expect(computeSaveGate({ ...old, editing }).canSave).toBe(true);
      expect(
        computeSaveGate({ ...old, editing: { dirty: true, instructionsChanged: true } }).canSave,
      ).toBe(false);
    });
  });
});
