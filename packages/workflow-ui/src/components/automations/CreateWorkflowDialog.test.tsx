import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { FolderRecord, WorkflowClient } from '@xyne/workflow-sdk/client';
import type { TriggerSummary } from '@xyne/workflow-sdk';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import { CreateWorkflowDialog } from './CreateWorkflowDialog.js';

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
  trigger('CRON', 'Cron Trigger', { id: 'builtin', name: 'Built-in' }),
  trigger('github.issue_comment', 'Issue or pull request comment', { id: 'github', name: 'GitHub' }),
];

function renderDialog() {
  const create = vi.fn().mockResolvedValue({ id: 'wf-new' });
  const onCreated = vi.fn();
  const client = {
    schema: { triggers: vi.fn().mockResolvedValue(TRIGGERS) },
    workflows: { create },
  } as unknown as WorkflowClient;
  const folder = { id: 'f1', name: 'Ops' } as FolderRecord;
  render(
    <WorkflowUIProvider
      client={client}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CreateWorkflowDialog
        folders={[folder]}
        defaultFolderId="f1"
        onCreated={onCreated}
        onClose={vi.fn()}
        onCreateFolder={vi.fn()}
      />
    </WorkflowUIProvider>,
  );
  return { create, onCreated };
}

describe('CreateWorkflowDialog — trigger', () => {
  it('starts on the manual trigger, named from the registry', async () => {
    renderDialog();
    expect(await screen.findByText('Manual Trigger')).toBeInTheDocument();
    expect(screen.getByText('Built-in')).toBeInTheDocument();
  });

  it("picks any connector's trigger, connector first, and creates the workflow with it", async () => {
    const { create, onCreated } = renderDialog();
    await screen.findByText('Manual Trigger');

    fireEvent.change(screen.getByPlaceholderText('e.g. Customer Onboarding Pipeline'), {
      target: { value: 'PR bot' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: /^GitHub/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Issue or pull request comment/ }));

    expect(screen.getByText('Issue or pull request comment')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'PR bot',
        folderId: 'f1',
        config: { trigger: { type: 'github.issue_comment', config: {} }, steps: [] },
      }),
    );
  });
});
