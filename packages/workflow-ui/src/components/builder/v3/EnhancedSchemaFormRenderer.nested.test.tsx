/**
 * Nested structures inside an array row.
 *
 * A Wait step's `form.fields[].options[]` is an array of objects nested inside
 * an array of discriminated-union objects. Before the recursion in
 * `ArrayItemField`, that depth had no editor: the array fell through to a raw
 * JSON textarea and a single object reached `VariableRefInput`, which renders
 * through `String()` — printing the literal text "[object Object]".
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { EnhancedSchemaFormRenderer } from './EnhancedSchemaFormRenderer.js';
import type { SchemaFormField } from '../../../hooks/use-schema-form.js';

const config: WorkflowConfig = { trigger: { type: 'MANUAL', config: {} }, steps: [] };

/** `form.fields[]`, each field carrying its own `options[]` — the Wait shape. */
const fieldsWithOptions: SchemaFormField[] = [
  {
    path: 'fields',
    label: 'Fields',
    type: 'array',
    required: false,
    acceptsVariableRef: false,
    itemSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        label: { type: 'string' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, value: { type: 'string' } },
          },
        },
      },
    },
  },
];

const values = {
  fields: [
    {
      name: 'choice',
      label: 'Choose one',
      options: [
        { label: 'Rides', value: 'rides' },
        { label: 'Payments', value: 'payments' },
      ],
    },
  ],
};

describe('nested array-of-objects inside an array row', () => {
  it('never renders an object through String()', () => {
    render(
      <EnhancedSchemaFormRenderer
        fields={fieldsWithOptions}
        values={values}
        errors={{}}
        onChange={() => {}}
        config={config}
        atStepId="ask_root"
      />,
    );

    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    expect(document.body.textContent).not.toContain('[object Object]');
    const editorValues = [
      ...Array.from(document.querySelectorAll('input')).map((i) => i.value),
      ...Array.from(document.querySelectorAll('textarea')).map((t) => t.value),
    ];
    expect(editorValues).not.toContain('[object Object]');
  });

  it('renders the nested options as editable values, not raw JSON', () => {
    render(
      <EnhancedSchemaFormRenderer
        fields={fieldsWithOptions}
        values={values}
        errors={{}}
        onChange={() => {}}
        config={config}
        atStepId="ask_root"
      />,
    );

    // The nested array gets its own editor: an "Options" group with a
    // Label/Value pair per option, each in its own field.
    expect(screen.getByText('Options')).toBeTruthy();
    expect(screen.getAllByText('Label').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Value').length).toBeGreaterThan(0);

    // …and the values are editable, not a JSON blob.
    const editable = Array.from(document.querySelectorAll('textarea')).map((t) => t.value);
    expect(editable).toContain('Rides');
    expect(editable).toContain('rides');
  });
});

// ─── Which fields offer the expression mode ───

/**
 * Regression, found by clicking it in the running app: HTTP Request's
 * `timeoutMs` is a bare `z.number()`, so it cannot hold a `{% … %}` string. The
 * mode was offered anyway, and typing into it put the field in breach of its own
 * schema — "Expected number, received string".
 */
describe('the ƒx mode is offered only where a string can be stored', () => {
  const field = (over: Partial<SchemaFormField>): SchemaFormField =>
    ({ path: 'f', label: 'F', type: 'number', required: false, acceptsVariableRef: false, ...over }) as SchemaFormField;

  const modesFor = (f: SchemaFormField): string[] => {
    const { unmount } = render(
      <EnhancedSchemaFormRenderer
        fields={[f]}
        values={{}}
        errors={{}}
        onChange={() => {}}
        config={config}
        atStepId="s1"
      />,
    );
    const group = screen.queryByRole('group', { name: /^How to fill/ });
    const labels = group
      ? Array.from(group.querySelectorAll('button')).map((b) => b.textContent ?? '')
      : [];
    unmount();
    return labels;
  };

  it('offers it on a number declared with variableRef', () => {
    expect(modesFor(field({ acceptsVariableRef: true }))).toEqual(['Value', 'Variable', 'ƒx']);
  });

  it('does not offer it on a bare number', () => {
    const modes = modesFor(field({ acceptsVariableRef: false }));
    expect(modes).not.toContain('ƒx');
    // Asserted as an absence rather than an exact list, because `Variable` is
    // still offered here and should not be: `supportsVarBinding` does not check
    // `acceptsVariableRef` either, so the builder invites a `{{ref}}` into a
    // bare `z.number()` where it fails the same shape check. That is
    // long-standing behaviour, not part of this change, and is left for a
    // decision rather than altered in passing.
    expect(modes).toContain('Value');
  });

  it('offers it on plain text, which holds the delimiters as written', () => {
    // No Variable: a string field embeds the picker in its ordinary box.
    expect(modesFor(field({ type: 'string' }))).toEqual(['Value', 'ƒx']);
  });

  it('does not offer it on a fixed list of choices', () => {
    expect(modesFor(field({ type: 'string', enumValues: ['a', 'b'] }))).toEqual([]);
  });
});
