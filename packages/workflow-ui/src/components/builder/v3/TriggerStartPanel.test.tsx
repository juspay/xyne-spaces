import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TriggerStart, WorkflowConfig } from '@xyne/workflow-sdk/builder';
import {
  TriggerStartPanel,
  fromTriggerStart,
  startFormError,
  toTriggerStart,
  type StartForm,
} from './TriggerStartPanel.js';

const config: WorkflowConfig = { trigger: { type: 'TICKET_CREATED', config: {} }, steps: [] };

const form = (over: Partial<StartForm> = {}): StartForm => ({
  ...fromTriggerStart(undefined),
  ...over,
});

function renderPanel(start: TriggerStart | undefined, onChange = vi.fn()) {
  render(
    <TriggerStartPanel
      start={start}
      onChange={onChange}
      workflowConfig={config}
      readOnly={false}
    />,
  );
  return onChange;
}

describe('start policy ↔ form', () => {
  it('round-trips a delay anchored on the event', () => {
    const start: TriggerStart = { kind: 'delay', offset: { amount: 2, unit: 'hours' } };
    expect(toTriggerStart(fromTriggerStart(start))).toEqual(start);
  });

  it('round-trips a delay anchored on a date field', () => {
    const start: TriggerStart = {
      kind: 'at',
      anchor: '{{trigger.ticket.eta}}',
      offset: { amount: 1, unit: 'days', direction: 'before' },
      ifPast: 'run',
    };
    expect(toTriggerStart(fromTriggerStart(start))).toEqual(start);
  });

  it('round-trips an anchor with no offset', () => {
    const start: TriggerStart = { kind: 'at', anchor: '{{vars.cutoff}}', ifPast: 'skip' };
    expect(toTriggerStart(fromTriggerStart(start))).toEqual(start);
  });

  it('leaves an immediate binding with no start at all', () => {
    expect(toTriggerStart(form({ mode: 'immediate' }))).toBeUndefined();
    expect(toTriggerStart(fromTriggerStart({ kind: 'immediate' }))).toBeUndefined();
  });

  it('drops the fields a shape does not carry', () => {
    // The author configured a date anchor, then switched back to the event: the
    // anchor, direction and ifPast must not ride along on a plain delay.
    const switched = form({
      mode: 'delay',
      anchorKind: 'event',
      anchor: '{{trigger.ticket.eta}}',
      direction: 'before',
      ifPast: 'run',
      amount: 3,
      unit: 'hours',
    });
    expect(toTriggerStart(switched)).toEqual({
      kind: 'delay',
      offset: { amount: 3, unit: 'hours' },
    });
  });

  it('omits the offset when a date anchor has none', () => {
    const at = toTriggerStart(
      form({ mode: 'delay', anchorKind: 'field', anchor: '{{trigger.dueAt}}', amount: 0 }),
    );
    expect(at).toEqual({ kind: 'at', anchor: '{{trigger.dueAt}}', ifPast: 'skip' });
  });
});

describe('what the author is told before saving', () => {
  it('accepts an ordinary delay', () => {
    expect(startFormError(form({ mode: 'delay', amount: 2, unit: 'hours' }))).toBeNull();
  });

  it('refuses a delay past the engine’s cap', () => {
    expect(startFormError(form({ mode: 'delay', amount: 60, unit: 'days' }))).toMatch(/30 days/);
  });

  it('refuses a fractional amount', () => {
    expect(startFormError(form({ mode: 'delay', amount: 1.5 }))).toMatch(/whole number/);
  });

  it('asks for the date when one is anchored on', () => {
    expect(
      startFormError(form({ mode: 'delay', anchorKind: 'field', anchor: '' })),
    ).toMatch(/Choose the date/);
  });

  it('says nothing about an immediate start', () => {
    expect(startFormError(form({ mode: 'immediate', amount: 999, unit: 'days' }))).toBeNull();
  });
});

describe('TriggerStartPanel', () => {
  it('starts on Immediately when the binding has no delay', () => {
    renderPanel(undefined);
    expect(screen.getByLabelText('Immediately')).toBeChecked();
    expect(screen.queryByLabelText('Unit')).not.toBeInTheDocument();
  });

  it('emits a delay anchored on the event', () => {
    const onChange = renderPanel(undefined);
    fireEvent.click(screen.getByLabelText('After a delay'));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'delay',
      offset: { amount: 2, unit: 'hours' },
    });
  });

  it('offers before-or-after only once a date is the anchor', () => {
    renderPanel({ kind: 'delay', offset: { amount: 2, unit: 'hours' } });
    expect(screen.queryByLabelText('Before or after')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('What to wait from'), {
      target: { value: 'field' },
    });
    // The change is reported upward; the panel renders from the prop it is given.
    renderPanel({ kind: 'at', anchor: '{{trigger.dueAt}}', ifPast: 'skip' });
    expect(screen.getByLabelText('Before or after')).toBeInTheDocument();
    expect(screen.getByLabelText('If that time has already passed')).toBeInTheDocument();
  });

  it('shows the server’s message in preference to its own', () => {
    render(
      <TriggerStartPanel
        start={{ kind: 'at', anchor: '{{trigger.nope}}', ifPast: 'skip' }}
        onChange={vi.fn()}
        workflowConfig={config}
        readOnly={false}
        error={'"{{trigger.nope}}" — path "nope" does not exist'}
      />,
    );
    expect(screen.getByText(/does not exist/)).toBeInTheDocument();
  });
});
