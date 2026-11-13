/**
 * Which modes a field offers, and which one it is in — the step builder's own
 * decision, made where the field is rendered.
 */
import { describe, it, expect } from 'vitest';
import { fieldModeState, fieldSupportsExpression } from './EnhancedSchemaFormRenderer.js';

describe('fieldSupportsExpression — only where a string can be stored', () => {
  it('allows a field declared with variableRef', () => {
    // How a step opts a typed field into refs, and now expressions.
    expect(fieldSupportsExpression({ type: 'number', acceptsVariableRef: true })).toBe(true);
    expect(fieldSupportsExpression({ type: 'object', acceptsVariableRef: true })).toBe(true);
    expect(fieldSupportsExpression({ type: 'boolean', acceptsVariableRef: true })).toBe(true);
  });

  it('allows plain text, which holds the {% %} as written', () => {
    expect(fieldSupportsExpression({ type: 'string', acceptsVariableRef: false })).toBe(true);
  });

  it('refuses a bare typed field, which cannot hold a string at all', () => {
    // Regression: HTTP Request's `timeoutMs` is `z.number().int().positive()`,
    // so offering the mode produced a field that failed its own shape check —
    // "Expected number, received string" — as soon as anything was typed.
    expect(fieldSupportsExpression({ type: 'number', acceptsVariableRef: false })).toBe(false);
    expect(fieldSupportsExpression({ type: 'integer', acceptsVariableRef: false })).toBe(false);
    expect(fieldSupportsExpression({ type: 'boolean', acceptsVariableRef: false })).toBe(false);
    expect(fieldSupportsExpression({ type: 'object', acceptsVariableRef: false })).toBe(false);
    expect(fieldSupportsExpression({ type: 'array', acceptsVariableRef: false })).toBe(false);
  });

  it('refuses a selection or a fixed list, whatever it accepts', () => {
    const ref = { acceptsVariableRef: true } as const;
    expect(fieldSupportsExpression({ type: 'string', ...ref, format: 'credential-name' })).toBe(false);
    expect(fieldSupportsExpression({ type: 'object', ...ref, format: 'attachment' })).toBe(false);
    expect(fieldSupportsExpression({ type: 'object', ...ref, format: 'json-schema' })).toBe(false);
    expect(fieldSupportsExpression({ type: 'array', ...ref, format: 'output-fields' })).toBe(false);
    expect(fieldSupportsExpression({ type: 'string', ...ref, enumValues: ['a', 'b'] })).toBe(false);
  });
});

describe('fieldModeState — which modes a field offers', () => {
  const base = {
    value: undefined as unknown,
    supportsVarBinding: true,
    supportsExpression: true,
    isAttachmentField: false,
    picked: null,
  };

  it('offers all three to a typed field', () => {
    expect(fieldModeState(base).modes).toEqual(['value', 'variable', 'expression']);
  });

  it('leaves out variable for a string field, which embeds the picker', () => {
    expect(fieldModeState({ ...base, supportsVarBinding: false }).modes).toEqual([
      'value',
      'expression',
    ]);
  });

  it('leaves out expression where a value cannot be computed', () => {
    // A credential, an enum, a schema builder.
    expect(fieldModeState({ ...base, supportsExpression: false }).modes).toEqual([
      'value',
      'variable',
    ]);
  });

  it('offers nothing to switch to for an attachment field', () => {
    const { modes } = fieldModeState({
      ...base,
      isAttachmentField: true,
      supportsExpression: false,
    });
    expect(modes).toEqual(['value']);
  });
});

describe('fieldModeState — which mode a field is in', () => {
  const base = {
    supportsVarBinding: true,
    supportsExpression: true,
    isAttachmentField: false,
    picked: null,
  };

  it('defaults to value', () => {
    expect(fieldModeState({ ...base, value: undefined }).mode).toBe('value');
    expect(fieldModeState({ ...base, value: 42 }).mode).toBe('value');
    expect(fieldModeState({ ...base, value: 'hello' }).mode).toBe('value');
  });

  it('reads an expression out of the stored value', () => {
    // Re-opening a step shows the mode its data is in, with nothing remembered.
    expect(fieldModeState({ ...base, value: '{% $sum(steps.a.output.x) %}' }).mode).toBe(
      'expression',
    );
  });

  it('reads a reference out of the stored value', () => {
    expect(fieldModeState({ ...base, value: '{{steps.a.output.x}}' }).mode).toBe('variable');
  });

  it('tolerates surrounding whitespace', () => {
    expect(fieldModeState({ ...base, value: '  {% 1 + 1 %}  ' }).mode).toBe('expression');
  });

  it('does not mistake text containing an expression for one', () => {
    // Interpolated text belongs in the ordinary box, which already handles it.
    expect(fieldModeState({ ...base, value: 'Total: {% 1 + 1 %}' }).mode).toBe('value');
  });

  it('honours the author choice only while the value does not say otherwise', () => {
    expect(fieldModeState({ ...base, value: undefined, picked: 'expression' }).mode).toBe(
      'expression',
    );
    // The value wins: it is already a reference.
    expect(
      fieldModeState({ ...base, value: '{{steps.a.output.x}}', picked: 'expression' }).mode,
    ).toBe('variable');
  });

  it('ignores a remembered mode the field no longer offers', () => {
    expect(
      fieldModeState({
        ...base,
        value: undefined,
        supportsExpression: false,
        picked: 'expression',
      }).mode,
    ).toBe('value');
  });
});
