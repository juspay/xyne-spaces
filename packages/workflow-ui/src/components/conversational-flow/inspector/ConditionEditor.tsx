/**
 * Saying when something happens — one editor, wherever a condition appears.
 *
 * A condition is read as a sentence: *plan is priority*. So it is written as one
 * too — the value, how to compare it, what to compare it against — and a second
 * test joins the first with `all` or `any` rather than opening a nested tree.
 * That is exactly the shape the engine stores, so nothing is translated on the
 * way in or out.
 *
 * Both places that carry a condition use this: an option offered only sometimes,
 * and a screen asked differently. They mean the same thing, so they look and
 * behave the same.
 */
import { Plus, X } from 'lucide-react';
import {
  fieldName,
  group,
  isFlat,
  joinOf,
  leavesOf,
  partsIn,
  takesValue,
  ConditionOperator,
  type Condition,
  type ConversationalFlow,
  type LeafCondition,
  type Screen,
} from '@xyne/workflow-sdk/conversational-flow';
import { OPERATORS, saidOperator } from '../conditions.js';
import { cn } from '../../shared/cn.js';
import { Select } from '../ui.js';
import { ValuePicker, valuesFor } from './DataSections.js';

/** The first thing a new test asks about — whatever this screen knows first. */
export function firstCondition(flow: ConversationalFlow, screen: Screen): Condition {
  const first = valuesFor(flow, screen)[0]?.items[0]?.ref ?? '';
  return { variable: first, operator: ConditionOperator.EQ, value: '' };
}

/** Whether a screen has anything at all to decide on. */
export function canDecide(flow: ConversationalFlow, screen: Screen): boolean {
  return valuesFor(flow, screen).length > 0;
}

// ─── Reading one ───

/**
 * A condition as a line of prose — for a list, where it has to be read at a
 * glance and there is no room to edit it.
 */
export function ConditionLine({ condition, className }: { condition: Condition; className?: string }) {
  const leaves = leavesOf(condition);
  const join = joinOf(condition) === 'any' ? ' or ' : ' and ';
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1', className)}>
      {leaves.map((leaf, at) => (
        <span key={at} className="inline-flex items-baseline gap-x-1">
          {at > 0 && <span className="text-[var(--wui-fg-muted)]">{join.trim()}</span>}
          <b className="font-medium">{fieldName(leaf.variable)}</b>
          <span className="text-[var(--wui-fg-muted)]">{saidOperator(leaf.operator)}</span>
          {takesValue(leaf.operator) && <b className="font-medium">{String(leaf.value ?? '')}</b>}
        </span>
      ))}
    </span>
  );
}

// ─── Writing one ───

export function ConditionEditor({
  flow,
  screen,
  condition,
  readOnly,
  title,
  onChange,
  onRemove,
  onDone,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  condition: Condition;
  readOnly: boolean;
  /** What this condition decides, in the author's words. */
  title: string;
  onChange: (next: Condition) => void;
  /** Absent when the condition is what the thing is — a version, say. */
  onRemove?: (() => void) | undefined;
  /** Fold it back to the sentence. */
  onDone?: (() => void) | undefined;
}) {
  const flat = isFlat(condition);
  const parts = flat ? partsIn(condition) : [];
  const leaves = parts.filter((p): p is LeafCondition => 'variable' in p);
  const join = joinOf(condition) ?? 'all';

  // A condition nested deeper than one group is legal, and rare enough that it
  // is shown rather than flattened — losing what someone meant would be worse.
  if (!flat) {
    return (
      <div className="rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-3 text-[12.5px] text-[var(--wui-fg-muted)]">
        <ConditionLine condition={condition} className="text-[var(--wui-fg)]" />
        <p className="mt-1">This one has groups inside groups, so it is shown rather than edited here.</p>
      </div>
    );
  }

  const write = (next: LeafCondition[]) => onChange(group(join, next));

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--wui-radius)] border p-2.5"
      style={{
        borderColor: 'color-mix(in srgb, var(--wui-cf-data) 35%, transparent)',
        background: 'color-mix(in srgb, var(--wui-cf-data) 5%, transparent)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-medium text-[var(--wui-fg)]">{title}</p>
        {onRemove && !readOnly && (
          <button
            type="button"
            aria-label="Always show it"
            title="Always show it"
            onClick={onRemove}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {leaves.map((leaf, at) => (
          <div key={at} className="flex flex-col gap-1">
            {at > 0 && (
              <div className="flex items-center gap-2 pl-0.5">
                {at === 1 && !readOnly ? (
                  <Join value={join} onChange={(next) => onChange(group(next, leaves))} />
                ) : (
                  <span className="text-[11.5px] font-medium text-[var(--wui-fg-muted)]">{join === 'any' ? 'or' : 'and'}</span>
                )}
                <span className="h-px flex-1 bg-[var(--wui-border)]" aria-hidden />
              </div>
            )}
            <Test
              flow={flow}
              screen={screen}
              leaf={leaf}
              readOnly={readOnly}
              onChange={(next) => write(leaves.map((l, i) => (i === at ? next : l)))}
              onRemove={leaves.length > 1 ? () => write(leaves.filter((_, i) => i !== at)) : undefined}
            />
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => write([...leaves, firstCondition(flow, screen) as LeafCondition])}
            className="rounded-[var(--wui-radius-sm)] px-1 py-0.5 text-[12px] font-medium text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
          >
            <Plus className="mr-0.5 inline h-3 w-3" aria-hidden /> Add a test
          </button>
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className="rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] px-2 py-0.5 text-[12px] font-medium text-[var(--wui-fg)] hover:bg-[var(--wui-bg-muted)]"
            >
              Done
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** One test: what to read, how to compare it, and against what. */
function Test({
  flow,
  screen,
  leaf,
  readOnly,
  onChange,
  onRemove,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  leaf: LeafCondition;
  readOnly: boolean;
  onChange: (next: LeafCondition) => void;
  onRemove?: (() => void) | undefined;
}) {
  const operator = OPERATORS.find((o) => o.value === leaf.operator) ?? OPERATORS[0]!;
  const numeric = operator.valueType === 'number';

  return (
    <div className="flex flex-wrap items-center gap-1">
      <ValuePicker
        flow={flow}
        screen={screen}
        value={leaf.variable}
        readOnly={readOnly}
        // What this operator can actually hold against. Undefined for most of
        // them; a comparison insists on a number, "starts with" on text.
        {...(operator.needs === undefined ? {} : { expects: operator.needs })}
        onChange={(variable) => onChange({ ...leaf, variable })}
      />
      <Select
        aria-label="How to compare it"
        disabled={readOnly}
        value={operator.value}
        onChange={(e) => {
          const next = OPERATORS.find((o) => o.value === e.target.value)!;
          onChange(
            takesValue(next.value)
              ? { variable: leaf.variable, operator: next.value, value: leaf.value ?? '' }
              : { variable: leaf.variable, operator: next.value },
          );
        }}
        className="w-auto px-2 py-1 text-[12px]"
      >
        {OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>{o.said}</option>
        ))}
      </Select>
      {takesValue(operator.value) && (
        <input
          aria-label="Compared with"
          value={String(leaf.value ?? '')}
          disabled={readOnly}
          inputMode={numeric ? 'numeric' : undefined}
          placeholder={numeric ? '0' : 'value'}
          onChange={(e) => {
            const raw = e.target.value;
            const asNumber = numeric && raw.trim() !== '' && !Number.isNaN(Number(raw));
            onChange({ ...leaf, value: asNumber ? Number(raw) : raw });
          }}
          className="w-24 min-w-0 flex-1 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] px-1.5 py-1 text-[12px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)] disabled:opacity-60"
        />
      )}
      {onRemove && !readOnly && (
        <button
          type="button"
          aria-label="Remove this test"
          onClick={onRemove}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--wui-fg-muted)] hover:text-[var(--wui-status-failed)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** How the tests add up: all of them, or any of them. */
function Join({ value, onChange }: { value: 'all' | 'any'; onChange: (next: 'all' | 'any') => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="How the tests are joined"
      className="inline-flex overflow-hidden rounded-full border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))]"
    >
      {(['all', 'any'] as const).map((option) => {
        const on = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option)}
            className={cn(
              'px-2 py-0.5 text-[11.5px] font-medium transition-colors',
              on ? 'text-[var(--wui-primary-fg)]' : 'text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
            )}
            style={on ? { background: 'var(--wui-cf-data)' } : undefined}
          >
            {option === 'all' ? 'and' : 'or'}
          </button>
        );
      })}
    </div>
  );
}
