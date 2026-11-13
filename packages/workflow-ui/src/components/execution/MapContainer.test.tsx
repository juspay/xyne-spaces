import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { ExecutionDetail } from '@xyne/workflow-sdk/client';
import type { WorkflowStepConfig } from '@xyne/workflow-sdk/builder';
import type { StepMeta } from '../../hooks/use-step-metadata.js';
import type { StepExecutionState } from '../../utils/step-state.js';
import { MapContainer } from './MapContainer.js';
import { ExecutionTree } from './ExecutionTree.js';

/** Build a step record row (mirrors use-execution-viewer.test). */
function rec(stepName: string, status: string, data?: Record<string, unknown>) {
  return { stepName, status, executorType: 'deterministic', data: data ? JSON.stringify(data) : null };
}
const records = (rows: ReturnType<typeof rec>[]) => rows as unknown as ExecutionDetail['steps'];

// ─── MapContainer in isolation — lane derivation + per-lane states ───

describe('MapContainer', () => {
  /** Render each lane's states as testable `id:status` cells under a lane testid. */
  const renderLane = (states: Map<string, StepExecutionState>, _r: unknown, index: number) => (
    <div data-testid={`lane-${index}`}>
      {[...states.entries()].map(([id, s]) => (
        <span key={id}>{`${id}:${s.status}`}</span>
      ))}
    </div>
  );

  it('renders one lane per runtime iteration, each with its own per-iteration states', () => {
    render(
      <MapContainer
        mapStepId="m"
        label="Map"
        records={records([
          rec('m:item#0/a', 'COMPLETED', { output: {} }),
          rec('m:item#0/b', 'RUNNING'),
          rec('m:item#1/a', 'EXTERNAL_WAIT', { pauseState: { reason: 'approve' } }),
        ])}
        renderLane={renderLane}
      />,
    );

    // Header reflects the dynamic count.
    expect(screen.getByText(/Map · 2 items concurrently/i)).toBeDefined();

    // Two lanes, labelled by source-array index.
    expect(screen.getByText('Item 0')).toBeDefined();
    expect(screen.getByText('Item 1')).toBeDefined();

    // Lane 0 carries both its steps with the right statuses; lane 1 only its paused gate.
    const lane0 = screen.getByTestId('lane-0');
    expect(within(lane0).getByText('a:completed')).toBeDefined();
    expect(within(lane0).getByText('b:running')).toBeDefined();
    const lane1 = screen.getByTestId('lane-1');
    expect(within(lane1).getByText('a:paused')).toBeDefined();
    // Cross-iteration isolation: lane 1 does NOT show lane 0's running step.
    expect(within(lane1).queryByText('b:running')).toBeNull();
  });

  it('falls back to a single template lane before any iteration has run', () => {
    render(<MapContainer mapStepId="m" label="Map" records={records([])} renderLane={renderLane} />);
    expect(screen.getByText(/Map · per item \(concurrent\)/i)).toBeDefined();
    expect(screen.getByText('Each item')).toBeDefined();
    expect(screen.queryByText('Item 0')).toBeNull();
  });
});

// ─── ExecutionTree integration — branchModel:'map' routes to dynamic lanes ───

describe('ExecutionTree — MAP routing', () => {
  const stepMeta = new Map<string, StepMeta>([
    ['MAP', { name: 'Map', category: 'control', kind: 'control', branchModel: 'map' }],
    ['VALIDATE', { name: 'Validate', category: 'action', kind: 'action' }],
  ]);

  const mapStep: WorkflowStepConfig = {
    id: 'owners_map',
    type: 'MAP',
    config: {
      source: 'steps.extract.output.owners',
      body: [{ id: 'validate', type: 'VALIDATE', config: {} }],
    },
  } as unknown as WorkflowStepConfig;

  it('renders the body once per runtime iteration, side by side, with per-lane status', () => {
    const { container } = render(
      <ExecutionTree
        steps={[mapStep]}
        stepMeta={stepMeta}
        stepStates={new Map()}
        selectedStepId={null}
        onStepClick={() => {}}
        executionSteps={records([
          rec('owners_map:item#0/validate', 'COMPLETED', { output: { ok: true } }),
          rec('owners_map:item#1/validate', 'EXTERNAL_WAIT', { pauseState: { reason: 'approve PAN' } }),
        ])}
      />,
    );

    // Two concurrent lanes → the body node renders twice.
    expect(screen.getByText(/Map · 2 items concurrently/i)).toBeDefined();
    expect(screen.getAllByText('Validate')).toHaveLength(2);
    expect(screen.getByText('Item 0')).toBeDefined();
    expect(screen.getByText('Item 1')).toBeDefined();

    // The paused iteration surfaces a paused (amber) status badge in its lane.
    expect(container.querySelector('.bg-amber-500')).not.toBeNull();
    // The completed iteration surfaces a completed (emerald) status badge.
    expect(container.querySelector('.bg-emerald-500')).not.toBeNull();
  });

  it('clicks each lane node with its OWN per-iteration node-path id (not a shared bare id)', () => {
    const clicks: string[] = [];
    render(
      <ExecutionTree
        steps={[mapStep]}
        stepMeta={stepMeta}
        stepStates={new Map()}
        selectedStepId={null}
        onStepClick={(id) => clicks.push(id)}
        executionSteps={records([
          rec('owners_map:item#0/validate', 'COMPLETED', { output: { ok: true } }),
          rec('owners_map:item#1/validate', 'EXTERNAL_WAIT', { pauseState: { reason: 'x' } }),
        ])}
      />,
    );

    const nodes = screen.getAllByText('Validate');
    fireEvent.click(nodes[0]!);
    fireEvent.click(nodes[1]!);
    // Distinct node-paths → the detail panel can resolve each iteration's record.
    expect(clicks).toEqual(['owners_map:item#0/validate', 'owners_map:item#1/validate']);
  });

  it('shows the body template once when the MAP has not started', () => {
    render(
      <ExecutionTree
        steps={[mapStep]}
        stepMeta={stepMeta}
        stepStates={new Map()}
        selectedStepId={null}
        onStepClick={() => {}}
        executionSteps={records([])}
      />,
    );
    expect(screen.getByText('Each item')).toBeDefined();
    expect(screen.getAllByText('Validate')).toHaveLength(1);
  });
});
