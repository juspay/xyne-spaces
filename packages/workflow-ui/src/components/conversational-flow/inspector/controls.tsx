/**
 * The controls both shapes are built from — which is these two and no others.
 *
 * Narrowing a list before adding it up and narrowing one before writing it out
 * are the same question, and an author who learns it once should not meet a
 * second version of it. Anything used by one shape lives with that shape, so
 * this file stays an answer to "what do they share" rather than a drawer.
 *
 * Nothing here decides anything: what a row means lives in `../computation.ts`,
 * and what it writes lives in the SDK.
 */
import {
  COMPARISON_OPS,
  type ComparisonOp,
} from '@xyne/workflow-sdk/expression';
import type { DeclaredField } from '@xyne/workflow-sdk/conversational-flow';
import type { Slot } from '../computation.js';
import { Select } from '../ui.js';

export const TEXT_INPUT =
  'min-w-0 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] px-1.5 py-1 text-[12px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)]';

/** `only where <field> <test> <value>` — a predicate in three controls. */
export function FilterRow({
  suffix,
  fields,
  slot,
  onChange,
}: {
  /** Appended to each control's label, where a form has more than one of these. */
  suffix: string;
  fields: readonly DeclaredField[];
  slot: Slot;
  onChange: (patch: Partial<Slot>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-[72px] shrink-0 text-[11.5px] text-[var(--wui-fg-muted)]">only where</span>
      <Select
        aria-label={`Filter field${suffix}`}
        value={slot.field}
        onChange={(e) => onChange({ field: e.target.value })}
        className="w-auto px-2 py-1 text-[12px]"
      >
        <option value="">every one of them</option>
        {fields.map((field) => (
          <option key={field.path} value={field.path}>
            {field.type ? `${field.path} · ${field.type}` : field.path}
          </option>
        ))}
      </Select>
      {slot.field !== '' && (
        <>
          <Select
            aria-label={`Filter test${suffix}`}
            value={slot.op}
            onChange={(e) => onChange({ op: e.target.value as ComparisonOp })}
            className="w-auto px-2 py-1 text-[12px]"
          >
            {COMPARISON_OPS.map((comparison) => (
              <option key={comparison.op} value={comparison.op}>
                {comparison.said}
              </option>
            ))}
          </Select>
          <input
            aria-label={`Filter value${suffix}`}
            value={slot.test}
            placeholder="value"
            onChange={(e) => onChange({ test: e.target.value })}
            className={`w-20 flex-1 ${TEXT_INPUT}`}
          />
        </>
      )}
    </div>
  );
}
