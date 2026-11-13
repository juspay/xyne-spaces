import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import type { FieldOptionsPage } from '@xyne/workflow-sdk';
import { WorkflowUIProvider } from '../../provider/WorkflowUIProvider.js';
import { OptionsField, type FieldOptionsScope } from './field-options.js';

const scope: FieldOptionsScope = { kind: 'steps', type: 'PICKER', workflowId: 'wf_1' };

function makeClient(fieldOptions: ReturnType<typeof vi.fn>): WorkflowClient {
  return { schema: { fieldOptions } } as unknown as WorkflowClient;
}

function renderField(
  fieldOptions: ReturnType<typeof vi.fn>,
  opts: { value?: unknown; config?: Record<string, unknown>; multi?: boolean } = {},
) {
  const onChange = vi.fn();
  render(
    <WorkflowUIProvider
      client={makeClient(fieldOptions)}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OptionsField
        field="channelId"
        value={opts.value ?? ''}
        onChange={onChange}
        config={opts.config ?? {}}
        scope={scope}
        multi={opts.multi ?? false}
        placeholder="Choose a channel"
      />
    </WorkflowUIProvider>,
  );
  return { onChange };
}

const page = (over: Partial<FieldOptionsPage> = {}): FieldOptionsPage => ({
  items: [
    { value: 'ch_1', label: 'support', description: 'Customer requests' },
    { value: 'ch_2', label: 'billing', hint: '42 members' },
  ],
  ...over,
});

describe('OptionsField', () => {
  it('asks only once opened, then stores the id and shows the label', async () => {
    const fieldOptions = vi.fn().mockResolvedValue(page());
    const { onChange } = renderField(fieldOptions);

    // Nothing is fetched for a field nobody has touched.
    expect(fieldOptions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Choose a channel'));
    expect(await screen.findByText('support')).toBeInTheDocument();
    expect(screen.getByText('Customer requests')).toBeInTheDocument();
    expect(screen.getByText('42 members')).toBeInTheDocument();

    fireEvent.click(screen.getByText('support'));
    // The id is what the workflow keeps — never the label.
    expect(onChange).toHaveBeenCalledWith('ch_1');
  });

  it('sends the form along, so a loader can narrow by a sibling', async () => {
    const fieldOptions = vi.fn().mockResolvedValue(page());
    renderField(fieldOptions, { config: { projectId: 'p_1' } });

    fireEvent.click(screen.getByText('Choose a channel'));
    await waitFor(() => expect(fieldOptions).toHaveBeenCalled());
    expect(fieldOptions.mock.calls[0]![0]).toMatchObject({
      kind: 'steps',
      type: 'PICKER',
      field: 'channelId',
      config: { projectId: 'p_1' },
      workflowId: 'wf_1',
    });
  });

  it('resolves a stored id back to its name when the workflow is reopened', async () => {
    const fieldOptions = vi
      .fn()
      .mockResolvedValue({ items: [{ value: 'ch_1', label: 'support' }] } as FieldOptionsPage);
    renderField(fieldOptions, { value: 'ch_1' });

    // Asked to describe, not to search — and without the field being opened.
    await waitFor(() => expect(fieldOptions).toHaveBeenCalledWith(
      expect.objectContaining({ values: ['ch_1'] }),
    ));
    expect(await screen.findByText('support')).toBeInTheDocument();
  });

  it('shows a notice instead of an empty list when the form is not ready', async () => {
    const fieldOptions = vi
      .fn()
      .mockResolvedValue({ items: [], notice: 'Choose a project first' } as FieldOptionsPage);
    renderField(fieldOptions);

    fireEvent.click(screen.getByText('Choose a channel'));
    expect(await screen.findByText('Choose a project first')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to show')).not.toBeInTheDocument();
  });

  it('says a load failed rather than showing an empty list', async () => {
    const fieldOptions = vi.fn().mockRejectedValue(new Error('GitHub said 401'));
    renderField(fieldOptions);

    fireEvent.click(screen.getByText('Choose a channel'));
    expect(await screen.findByText(/Could not load choices/)).toBeInTheDocument();
    expect(screen.getByText(/401/)).toBeInTheDocument();
  });

  it('appends the next page rather than replacing the list', async () => {
    const fieldOptions = vi
      .fn()
      .mockResolvedValueOnce(page({ nextCursor: 'page2', total: 3 }))
      .mockResolvedValueOnce({ items: [{ value: 'ch_3', label: 'archived' }] } as FieldOptionsPage);
    renderField(fieldOptions);

    fireEvent.click(screen.getByText('Choose a channel'));
    fireEvent.click(await screen.findByText(/Load more/));

    expect(await screen.findByText('archived')).toBeInTheDocument();
    expect(screen.getByText('support')).toBeInTheDocument();
  });
});

describe('OptionsField — many choices', () => {
  // Arity is the schema's business: `z.array(...)` says how many may be picked,
  // and the mark says only that there is something to pick from.

  it('adds to the selection and keeps the list open', async () => {
    const fieldOptions = vi.fn().mockResolvedValue(page());
    const { onChange } = renderField(fieldOptions, { multi: true, value: ['ch_2'] });

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('support'));

    expect(onChange).toHaveBeenCalledWith(['ch_2', 'ch_1']);
    // A second choice is usually coming — closing after the first would be wrong.
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
  });

  it('takes one back off when it is picked again', async () => {
    const fieldOptions = vi.fn().mockResolvedValue(page());
    const { onChange } = renderField(fieldOptions, { multi: true, value: ['ch_1', 'ch_2'] });

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('billing'));

    expect(onChange).toHaveBeenCalledWith(['ch_1']);
  });

  it('names everything held, in one call', async () => {
    const fieldOptions = vi.fn().mockResolvedValue(page());
    renderField(fieldOptions, { multi: true, value: ['ch_1', 'ch_2'] });

    await waitFor(() => expect(screen.getByText('support, billing')).toBeInTheDocument());
    expect(fieldOptions).toHaveBeenCalledTimes(1);
    expect(fieldOptions.mock.calls[0]?.[0]).toMatchObject({ values: ['ch_1', 'ch_2'] });
  });

  it('closes on the first pick when only one is allowed', async () => {
    const fieldOptions = vi.fn().mockResolvedValue(page());
    const { onChange } = renderField(fieldOptions, { multi: false });

    fireEvent.click(screen.getByText('Choose a channel'));
    fireEvent.click(await screen.findByText('support'));

    expect(onChange).toHaveBeenCalledWith('ch_1');
    expect(screen.queryByText('billing')).not.toBeInTheDocument();
  });
});
