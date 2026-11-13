import { useMemo } from 'react';
import type { Duration, TriggerStart, WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { MAX_START_DELAY_MS, TRIGGER_FILTER_SCOPE, durationMs } from '@xyne/workflow-sdk/builder';
import { VariableRefInput } from './VariableRefInput.js';

/**
 * When a matching event becomes a run.
 *
 * Rendered rather than generated: `start` is one fixed shape for every trigger,
 * not a connector-defined config, so there is no schema to drive a form from —
 * the same reason the condition editor beside it is hand-written. What the editor
 * does NOT do is retype the contract: the type, the units and the cap all come
 * from the engine, so a new unit or a changed limit arrives with the next build.
 *
 * The form is flat and the config is a discriminated union, so the two mapping
 * functions below are the only place that knows how one becomes the other —
 * including dropping the fields a shape does not carry, so switching modes can
 * never leave a stale `ifPast` on a plain delay.
 */

export interface TriggerStartPanelProps {
  start: TriggerStart | undefined;
  onChange: (start: TriggerStart | undefined) => void;
  /** The trigger's output feeds the anchor picker. */
  workflowConfig: WorkflowConfig;
  readOnly: boolean;
  /** The saved workflow's validation message for this section, if any. */
  error?: string | undefined;
}

type Mode = 'immediate' | 'delay';
type AnchorKind = 'event' | 'field';

export interface StartForm {
  mode: Mode;
  amount: number;
  unit: Duration['unit'];
  anchorKind: AnchorKind;
  /** Only meaningful when anchored on a field — an event has already happened. */
  direction: 'before' | 'after';
  anchor: string;
  ifPast: 'run' | 'skip';
}

const DEFAULT_FORM: StartForm = {
  mode: 'immediate',
  amount: 2,
  unit: 'hours',
  anchorKind: 'event',
  direction: 'after',
  anchor: '',
  ifPast: 'skip',
};

const UNITS: readonly Duration['unit'][] = ['minutes', 'hours', 'days'];

/** Config → form, filling in defaults for the fields a given shape doesn't carry. */
export function fromTriggerStart(start: TriggerStart | undefined): StartForm {
  if (!start || start.kind === 'immediate') return DEFAULT_FORM;

  if (start.kind === 'delay') {
    return {
      ...DEFAULT_FORM,
      mode: 'delay',
      amount: start.offset.amount,
      unit: start.offset.unit,
      anchorKind: 'event',
    };
  }

  return {
    mode: 'delay',
    amount: start.offset?.amount ?? 0,
    unit: start.offset?.unit ?? 'hours',
    anchorKind: 'field',
    direction: start.offset?.direction ?? 'after',
    anchor: start.anchor,
    ifPast: start.ifPast,
  };
}

/**
 * Form → config. Returns `undefined` for an immediate start so an ordinary
 * binding stays free of a field that says "no delay".
 */
export function toTriggerStart(form: StartForm): TriggerStart | undefined {
  if (form.mode === 'immediate') return undefined;

  if (form.anchorKind === 'event') {
    return { kind: 'delay', offset: { amount: form.amount, unit: form.unit } };
  }

  return {
    kind: 'at',
    anchor: form.anchor,
    ...(form.amount > 0
      ? { offset: { amount: form.amount, unit: form.unit, direction: form.direction } }
      : {}),
    ifPast: form.ifPast,
  };
}

/** What the author would be told at save time, said now instead. */
export function startFormError(form: StartForm): string | null {
  if (form.mode === 'immediate') return null;
  if (!Number.isInteger(form.amount) || form.amount < 0) return 'Use a whole number';
  if (form.anchorKind === 'event' && form.amount < 1) return 'Wait at least one minute';
  if (form.amount > 0 && durationMs({ amount: form.amount, unit: form.unit }) > MAX_START_DELAY_MS) {
    return 'A start delay may be at most 30 days';
  }
  if (form.anchorKind === 'field' && !form.anchor) return 'Choose the date to wait for';
  return null;
}

const label = 'text-[11px] font-medium text-slate-500';
const control =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

export function TriggerStartPanel({
  start,
  onChange,
  workflowConfig,
  readOnly,
  error,
}: TriggerStartPanelProps) {
  const form = useMemo(() => fromTriggerStart(start), [start]);
  const update = (patch: Partial<StartForm>): void => onChange(toTriggerStart({ ...form, ...patch }));
  // The server's message wins: it is the one that resolved the anchor against the
  // trigger's real output, which the editor cannot do.
  const message = error ?? startFormError(form);

  return (
    <section aria-label="When to run" className="mt-5">
      <h4 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        When to run
      </h4>
      <p className="mb-3 text-[11px] text-slate-400">
        Wait before starting, and the run reads everything again when it wakes.
      </p>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[12px] text-slate-600">
          <input
            type="radio"
            name="trigger-start-mode"
            checked={form.mode === 'immediate'}
            disabled={readOnly}
            onChange={() => update({ mode: 'immediate' })}
          />
          Immediately
        </label>

        <label className="flex items-center gap-2 text-[12px] text-slate-600">
          <input
            type="radio"
            name="trigger-start-mode"
            checked={form.mode === 'delay'}
            disabled={readOnly}
            onChange={() => update({ mode: 'delay' })}
          />
          After a delay
        </label>

        {form.mode === 'delay' && (
          <div className="space-y-2 pl-6">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                value={form.amount}
                disabled={readOnly}
                aria-label="Amount"
                className={`${control} w-16`}
                onChange={(e) => update({ amount: Number(e.target.value) })}
              />
              <select
                value={form.unit}
                disabled={readOnly}
                aria-label="Unit"
                className={control}
                onChange={(e) => update({ unit: e.target.value as Duration['unit'] })}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>

              {/* Before only makes sense against a date; the event has happened. */}
              {form.anchorKind === 'field' ? (
                <select
                  value={form.direction}
                  disabled={readOnly}
                  aria-label="Before or after"
                  className={control}
                  onChange={(e) => update({ direction: e.target.value as 'before' | 'after' })}
                >
                  <option value="after">after</option>
                  <option value="before">before</option>
                </select>
              ) : (
                <span className={label}>after</span>
              )}

              <select
                value={form.anchorKind}
                disabled={readOnly}
                aria-label="What to wait from"
                className={control}
                onChange={(e) => update({ anchorKind: e.target.value as AnchorKind })}
              >
                <option value="event">the event</option>
                <option value="field">a date field</option>
              </select>
            </div>

            {form.anchorKind === 'field' && (
              <div className="space-y-2">
                <VariableRefInput
                  value={form.anchor}
                  onChange={(v) => update({ anchor: typeof v === 'string' ? v : '' })}
                  config={workflowConfig}
                  atStepId={TRIGGER_FILTER_SCOPE}
                  placeholder="{{trigger.ticket.eta}}"
                  disabled={readOnly}
                  filterType="string"
                  compact
                />

                <div className="flex flex-wrap items-center gap-2">
                  <span className={label}>If that time has already passed</span>
                  <select
                    value={form.ifPast}
                    disabled={readOnly}
                    aria-label="If that time has already passed"
                    className={control}
                    onChange={(e) => update({ ifPast: e.target.value as 'run' | 'skip' })}
                  >
                    <option value="skip">don’t run</option>
                    <option value="run">run straight away</option>
                  </select>
                </div>
              </div>
            )}

            {message && <p className="text-[11px] text-red-600">{message}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
