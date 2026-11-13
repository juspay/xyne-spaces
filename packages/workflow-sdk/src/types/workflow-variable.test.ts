import { describe, it, expect } from 'vitest';
import {
  WorkflowVariableSchema,
  projectVariables,
  varsJsonSchema,
  type WorkflowVariable,
} from './workflow-variable.js';

describe('WorkflowVariableSchema', () => {
  it('round-trips each kind with its value exactly typed', () => {
    const vars: WorkflowVariable[] = [
      { key: 'companyName', type: 'text', value: 'Acme' },
      { key: 'threshold', type: 'number', value: 42 },
      { key: 'enabled', type: 'boolean', value: true },
      { key: 'rules', type: 'json', value: { max: 3, names: ['a', 'b'] } },
      { key: 'policy', type: 'document', value: { name: 'p.pdf', mimeType: 'application/pdf', handle: 'mem://p' } },
      { key: 'refs', type: 'documents', value: [{ name: 'a.pdf', mimeType: 'application/pdf', handle: 'mem://a' }] },
    ];
    for (const v of vars) expect(WorkflowVariableSchema.parse(v)).toEqual(v);
  });

  it('rejects a key that is not a valid identifier', () => {
    expect(WorkflowVariableSchema.safeParse({ key: 'my var', type: 'text', value: 'x' }).success).toBe(false);
    expect(WorkflowVariableSchema.safeParse({ key: 'a.b', type: 'text', value: 'x' }).success).toBe(false);
  });

  it('rejects a value that mismatches its declared type', () => {
    expect(WorkflowVariableSchema.safeParse({ key: 'n', type: 'number', value: 'nope' }).success).toBe(false);
  });

  it('rejects a document value missing required attachment fields', () => {
    expect(WorkflowVariableSchema.safeParse({ key: 'd', type: 'document', value: { name: 'x.pdf' } }).success).toBe(false);
  });
});

describe('projectVariables', () => {
  it('maps a list to a key→value record', () => {
    expect(
      projectVariables([
        { key: 'a', type: 'text', value: 'x' },
        { key: 'n', type: 'number', value: 1 },
      ]),
    ).toEqual({ a: 'x', n: 1 });
  });

  it('returns {} for undefined or empty', () => {
    expect(projectVariables(undefined)).toEqual({});
    expect(projectVariables([])).toEqual({});
  });

  it('lets the last definition win on a key clash', () => {
    expect(
      projectVariables([
        { key: 'a', type: 'text', value: 'first' },
        { key: 'a', type: 'text', value: 'second' },
      ]),
    ).toEqual({ a: 'second' });
  });

  it('skips unnamed draft rows (blank keys)', () => {
    expect(
      projectVariables([
        { key: '', type: 'text', value: 'x' },
        { key: '   ', type: 'number', value: 1 },
        { key: 'real', type: 'text', value: 'y' },
      ]),
    ).toEqual({ real: 'y' });
  });
});

describe('varsJsonSchema', () => {
  it('emits a property per variable with the right JSON type + attachment format', () => {
    const schema = varsJsonSchema([
      { key: 'companyName', type: 'text', value: 'Acme' },
      { key: 'threshold', type: 'number', value: 1 },
      { key: 'policy', type: 'document', value: { name: 'p.pdf', mimeType: 'application/pdf', handle: 'mem://p' } },
      { key: 'refs', type: 'documents', value: [] },
    ]);
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['companyName']).toEqual({ type: 'string' });
    expect(props['threshold']).toEqual({ type: 'number' });
    expect(props['policy']!['format']).toBe('attachment');
    expect(props['refs']!['type']).toBe('array');
    expect((props['refs']!['items'] as Record<string, unknown>)['format']).toBe('attachment');
  });

  it('is an empty-property object when nothing is declared', () => {
    expect(varsJsonSchema(undefined)).toEqual({ type: 'object', properties: {} });
  });

  it('omits unnamed draft rows (blank keys) so the picker has no {{vars.}} entry', () => {
    const schema = varsJsonSchema([
      { key: '', type: 'text', value: 'x' },
      { key: 'named', type: 'text', value: 'y' },
    ]);
    expect(Object.keys(schema['properties'] as Record<string, unknown>)).toEqual(['named']);
  });
});
