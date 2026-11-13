import { describe, it, expect } from 'vitest';
import {
  ensureCitationPath,
  parseCitationPath,
  resolveCitationPath,
} from './citation-path.js';

function makeConfig(): Record<string, unknown> {
  return {
    reason: '{{steps.a.output.mode}}',
    display: [
      { label: 'Mobile', value: '{{steps.a.output.mobile}}' }, // no id/name
      { id: 'sec_2', label: 'Amount', value: '12500' },        // has id
    ],
    form: { fields: [{ name: 'acha', label: 'Note' }] },        // has name
  };
}

describe('ensureCitationPath', () => {
  it('returns a fixed name for a scalar field', () => {
    expect(ensureCitationPath(makeConfig(), 'reason')).toBe('reason');
  });

  it('keys array elements by existing id', () => {
    expect(ensureCitationPath(makeConfig(), 'display.1.value')).toBe('display[sec_2].value');
  });

  it('keys form fields by their name', () => {
    expect(ensureCitationPath(makeConfig(), 'form.fields.0')).toBe('form.fields[acha]');
  });

  it('stamps a stable id on an element that has neither id nor name (mutates config)', () => {
    const cfg = makeConfig();
    const path = ensureCitationPath(cfg, 'display.0.value', () => 'gen1');
    expect(path).toBe('display[gen1].value');
    // id was stamped onto the element
    expect((cfg['display'] as Array<Record<string, unknown>>)[0]!['id']).toBe('gen1');
  });

  it('returns null for a non-existent field', () => {
    expect(ensureCitationPath(makeConfig(), 'nope')).toBeNull();
    expect(ensureCitationPath(makeConfig(), 'display.9.value')).toBeNull();
  });
});

describe('parseCitationPath', () => {
  it('splits keys and array-element ids', () => {
    expect(parseCitationPath('display[sec_amt].value')).toEqual([
      { kind: 'key', value: 'display' },
      { kind: 'elem', value: 'sec_amt' },
      { kind: 'key', value: 'value' },
    ]);
  });
});

describe('resolveCitationPath', () => {
  it('resolves a scalar field', () => {
    expect(resolveCitationPath(makeConfig(), 'reason')).toBe('{{steps.a.output.mode}}');
  });

  it('resolves an array element value by stable id', () => {
    expect(resolveCitationPath(makeConfig(), 'display[sec_2].value')).toBe('12500');
  });

  it('resolves a form field object by name', () => {
    expect(resolveCitationPath(makeConfig(), 'form.fields[acha]')).toEqual({ name: 'acha', label: 'Note' });
  });

  it('returns undefined when the target no longer exists', () => {
    expect(resolveCitationPath(makeConfig(), 'display[gone].value')).toBeUndefined();
  });

  it('stays attached after reorder (matches by stable key, not index)', () => {
    const cfg = makeConfig();
    const path = ensureCitationPath(cfg, 'display.0.value', () => 'gen1')!;
    // reverse the display array — index changes, id does not
    (cfg['display'] as unknown[]).reverse();
    expect(resolveCitationPath(cfg, path)).toBe('{{steps.a.output.mobile}}');
  });
});
