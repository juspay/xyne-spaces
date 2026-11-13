import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import type { TriggerSummary } from '@xyne/workflow-sdk';
import { WorkflowUIProvider } from '../../provider/WorkflowUIProvider.js';
import { TriggerPicker } from './TriggerPicker.js';

const trigger = (type: string, name: string, connector: { id: string; name: string }): TriggerSummary => ({
  type,
  name,
  description: `${name} description`,
  category: 'webhook' as TriggerSummary['category'],
  connectorId: connector.id,
  connectorName: connector.name,
});

const TRIGGERS = [
  trigger('MANUAL', 'Manual Trigger', { id: 'builtin', name: 'Built-in' }),
  trigger('github.issues', 'Issue', { id: 'github', name: 'GitHub' }),
];

describe('TriggerPicker', () => {
  it('selects a trigger connector-first, then closes', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const client = { schema: { triggers: vi.fn().mockResolvedValue(TRIGGERS) } } as unknown as WorkflowClient;
    render(
      <WorkflowUIProvider
        client={client}
        queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <TriggerPicker open onSelect={onSelect} onClose={onClose} />
      </WorkflowUIProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^GitHub/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Issue/ }));

    expect(onSelect).toHaveBeenCalledWith('github.issues');
    expect(onClose).toHaveBeenCalled();
  });
});
