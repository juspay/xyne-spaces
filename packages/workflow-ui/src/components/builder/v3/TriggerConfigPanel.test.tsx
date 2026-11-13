import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import type { TriggerDescriptor } from '@xyne/workflow-sdk';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { WorkflowUIProvider } from '../../provider/WorkflowUIProvider.js';
import { TriggerConfigPanel } from './TriggerConfigPanel.js';

const descriptor = (over: Partial<TriggerDescriptor> = {}): TriggerDescriptor => ({
  type: 'GITHUB_PUSH',
  name: 'GitHub push',
  description: 'Commits pushed to a repository',
  category: 'webhook' as TriggerDescriptor['category'],
  configSchema: { type: 'object', properties: {} },
  outputSchema: { type: 'object' },
  requiresScopeFilter: false,
  scopeFilterFields: [],
  credentialSlots: [],
  credential: [],
  webhook: true,
  ...over,
});

function makeClient(d: TriggerDescriptor): WorkflowClient {
  return {
    schema: {
      trigger: vi.fn().mockResolvedValue(d),
      operators: vi.fn().mockResolvedValue([]),
      availableContext: vi.fn().mockResolvedValue({ trigger: { type: 'object' } }),
    },
    credentials: { list: vi.fn().mockResolvedValue({ credentials: [] }) },
  } as unknown as WorkflowClient;
}

const workflowConfig: WorkflowConfig = { trigger: { type: 'GITHUB_PUSH', config: {} }, steps: [] };

function renderPanel(opts: {
  descriptor?: TriggerDescriptor;
  workflowId?: string;
  onUpdateFilter?: ReturnType<typeof vi.fn>;
  start?: import('@xyne/workflow-sdk/builder').TriggerStart;
}) {
  const onUpdateFilter = opts.onUpdateFilter ?? vi.fn();
  const client = makeClient(opts.descriptor ?? descriptor());
  render(
    <WorkflowUIProvider
      client={client}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TriggerConfigPanel
        triggerType="GITHUB_PUSH"
        triggerConfig={{}}
        triggerMeta={[]}
        onUpdateConfig={vi.fn()}
        onRequestChangeTrigger={vi.fn()}
        readOnly={false}
        workflowConfig={workflowConfig}
        onUpdateFilter={onUpdateFilter}
        start={opts.start}
        onUpdateStart={vi.fn()}
        workflowId={opts.workflowId}
      />
    </WorkflowUIProvider>,
  );
  return { client, onUpdateFilter };
}

describe('TriggerConfigPanel — webhook endpoint', () => {
  it('shows the saved workflow’s id', async () => {
    renderPanel({ workflowId: 'wf1' });
    expect(await screen.findByText('wf1')).toBeInTheDocument();
  });

  it('asks for a save first when the workflow has no id yet', async () => {
    renderPanel({});
    expect(await screen.findByText('Save the workflow to get its ID.')).toBeInTheDocument();
  });
});

describe('TriggerConfigPanel — conditions', () => {
  it('says conditions are checked on arrival when the run starts at once', async () => {
    renderPanel({ workflowId: 'wf1' });
    expect(await screen.findByText(/Events that don’t match are ignored/)).toBeInTheDocument();
  });

  it('says conditions are checked at fire time when the run waits', async () => {
    renderPanel({
      workflowId: 'wf1',
      start: { kind: 'delay', offset: { amount: 2, unit: 'hours' } },
    });
    // The difference that matters: a delayed run IS created, then skipped if the
    // world no longer matches — the opposite of "the event is ignored".
    expect(await screen.findByText(/Checked when the run starts/)).toBeInTheDocument();
    expect(screen.getByText(/skipped, and says why/)).toBeInTheDocument();
  });

  it('adds a condition as one empty group', async () => {
    const { onUpdateFilter } = renderPanel({ workflowId: 'wf1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    expect(onUpdateFilter).toHaveBeenCalledWith({
      conditions: { all: [{ variable: '', operator: 'eq', value: '' }] },
    });
  });

  it('offers no conditions or delay for a manual trigger, which consults neither', async () => {
    renderPanel({
      descriptor: descriptor({
        name: 'Manual Trigger',
        category: 'manual' as TriggerDescriptor['category'],
        webhook: false,
      }),
    });
    expect(await screen.findByText('Manual Trigger')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add condition' })).not.toBeInTheDocument();
    // A manual run is started on purpose, so neither conditions nor a delay apply.
    expect(screen.queryByLabelText('When to run')).not.toBeInTheDocument();
    expect(screen.queryByText('Endpoint')).not.toBeInTheDocument();
  });
});

describe('TriggerConfigPanel — changing the trigger', () => {
  const withActions = (type: string, actions: string[]): TriggerDescriptor =>
    descriptor({
      type,
      name: type,
      configSchema: {
        type: 'object',
        properties: { actions: { type: 'array', items: { type: 'string', enum: actions } } },
      },
    });

  // Both triggers offer the same actions, as GitHub's issue comment and review comment triggers
  // do, so a carried-over selection would pass as valid and only a fresh form keeps it out.
  it("starts the new trigger's form empty instead of carrying the old trigger's selections", async () => {
    const issueComment = withActions('github.issue_comment', ['created', 'edited', 'deleted']);
    const reviewComment = withActions('github.pull_request_review_comment', ['created', 'edited', 'deleted']);
    const client = makeClient(issueComment);
    vi.mocked(client.schema.trigger).mockImplementation((type: string) =>
      Promise.resolve(type === reviewComment.type ? reviewComment : issueComment),
    );
    const onUpdateConfig = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const panel = (triggerType: string) => (
      <WorkflowUIProvider client={client} queryClient={queryClient}>
        <TriggerConfigPanel
          triggerType={triggerType}
          triggerConfig={{}}
          triggerMeta={[]}
          onUpdateConfig={onUpdateConfig}
          onRequestChangeTrigger={vi.fn()}
          onUpdateStart={vi.fn()}
          readOnly={false}
          workflowConfig={workflowConfig}
          onUpdateFilter={vi.fn()}
        />
      </WorkflowUIProvider>
    );

    const { rerender } = render(panel(issueComment.type));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'edited' }));
    expect(onUpdateConfig).toHaveBeenLastCalledWith({ actions: ['edited'] });

    rerender(panel(reviewComment.type));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'created' }));
    expect(onUpdateConfig).toHaveBeenLastCalledWith({ actions: ['created'] });
  });
});
