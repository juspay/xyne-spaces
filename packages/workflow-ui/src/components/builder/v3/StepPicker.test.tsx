import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import type { StepSummary } from '@xyne/workflow-sdk';
import { WorkflowUIProvider } from '../../provider/WorkflowUIProvider.js';
import { StepPicker } from './StepPicker.js';

const step = (
  type: string,
  name: string,
  category: string,
  connector: { id: string; name: string },
): StepSummary => ({
  type,
  name,
  description: `${name} description`,
  category: category as StepSummary['category'],
  kind: 'action' as StepSummary['kind'],
  connectorId: connector.id,
  connectorName: connector.name,
});

const builtin = { id: 'builtin', name: 'Built-in' };
const github = { id: 'github', name: 'GitHub' };
const STEPS = [
  step('HTTP_REQUEST', 'HTTP Request', 'action', builtin),
  step('LOOP', 'Loop', 'control', builtin),
  step('github.create_issue', 'Create issue', 'action', github),
];

function renderPicker() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const client = { schema: { steps: vi.fn().mockResolvedValue(STEPS) } } as unknown as WorkflowClient;
  render(
    <WorkflowUIProvider
      client={client}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StepPicker open context={{ afterStepId: 's1' }} onSelect={onSelect} onClose={onClose} />
    </WorkflowUIProvider>,
  );
  return { onSelect, onClose };
}

describe('StepPicker', () => {
  it('heads a connector’s steps by category when it has more than one', async () => {
    renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: /^Built-in/ }));

    expect(screen.getByText('action')).toBeInTheDocument();
    expect(screen.getByText('control')).toBeInTheDocument();
    expect(screen.queryByText('Create issue')).not.toBeInTheDocument();
  });

  it('adds the chosen connector step in the picker’s context, and closes', async () => {
    const { onSelect, onClose } = renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: /^GitHub/ }));
    expect(screen.queryByText('action')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Create issue/ }));

    expect(onSelect).toHaveBeenCalledWith('github.create_issue', { afterStepId: 's1' });
    expect(onClose).toHaveBeenCalled();
  });
});
