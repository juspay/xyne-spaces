import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import type { SchemaFormField } from '../../hooks/use-schema-form.js';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import { FieldOptionsScopeProvider } from '../builder/v3/field-options.js';
import { SchemaFormRenderer } from './SchemaFormRenderer.js';

/**
 * Knowing a field's usual values changes what its ONE input offers — it does not
 * turn the field into a different kind of control, and it does not add a second
 * one beside it.
 *
 * `withOptions` marks where good values COME FROM; it never narrowed what is
 * legal. So the box stays a box: type anything, write a `{{ref}}`, or take one
 * of the suggestions that appear underneath.
 */

const fieldOptions = vi.fn().mockResolvedValue({
  items: [{ value: 'ch_1', label: 'support', description: 'Customer requests' }],
});
const client = { schema: { fieldOptions } } as unknown as WorkflowClient;

const channelId: SchemaFormField = {
  path: 'channelId',
  label: 'Channel',
  type: 'string',
  required: false,
  acceptsVariableRef: true,
  hasOptions: true,
};

function renderField(over: Partial<SchemaFormField> = {}, opts: { value?: unknown; readOnly?: boolean } = {}) {
  const onChange = vi.fn();
  render(
    <WorkflowUIProvider
      client={client}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FieldOptionsScopeProvider scope={{ kind: 'steps', type: 'DEMO', workflowId: 'wf_1' }}>
        <SchemaFormRenderer
          fields={[{ ...channelId, ...over }]}
          values={opts.value === undefined ? {} : { channelId: opts.value }}
          errors={{}}
          onChange={onChange}
          readOnly={opts.readOnly ?? false}
        />
      </FieldOptionsScopeProvider>
    </WorkflowUIProvider>,
  );
  return { onChange };
}

describe('a field whose values are knowable', () => {
  it('is still one ordinary box, not a chooser', () => {
    renderField();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('asks nothing until the author is actually in the field', () => {
    renderField();
    expect(fieldOptions).not.toHaveBeenCalled();
  });

  it('suggests underneath once focused, and taking one fills the box', async () => {
    const { onChange } = renderField();

    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.click(await screen.findByText('support'));

    // The id is what is stored; the label was only ever for the author.
    expect(onChange).toHaveBeenCalledWith('channelId', 'ch_1');
  });

  it('still takes a value no suggestion offered', () => {
    const { onChange } = renderField();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ch_made_up' } });
    expect(onChange).toHaveBeenCalledWith('channelId', 'ch_made_up');
  });

  it('still takes a reference, and stops suggesting once one is written', async () => {
    const { onChange } = renderField({}, { value: '{{trigger.channelId}}' });

    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{{trigger.other}}' } });

    expect(onChange).toHaveBeenCalledWith('channelId', '{{trigger.other}}');
    // A reference is a promise about run time — there is nothing to suggest for it.
    await waitFor(() => expect(screen.queryByText('support')).not.toBeInTheDocument());
  });

  it('keeps the multi-select for an array, where a line of text cannot hold a set', () => {
    renderField({ type: 'array' });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('suggests nothing on a read-only form', () => {
    renderField({}, { readOnly: true });
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.queryByText('support')).not.toBeInTheDocument();
  });
});
