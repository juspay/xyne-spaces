/**
 * Writing a list out, item by item.
 *
 * Its own file because it shares almost nothing with the call shape beside it:
 * one is a function over arguments, this is a template applied to every item.
 * They meet in one menu because an author asks both about the same list, and
 * nowhere else.
 */
import { useState, type ReactNode } from 'react';
import { CommitTextarea, Select } from '../ui.js';
import { SEPARATORS, emptySlot, type ListDraft } from '../computation.js';
import type { DeclaredField } from '@xyne/workflow-sdk/conversational-flow';
import type { FlowValue } from './DataSections.js';
import { FilterRow, TEXT_INPUT } from './controls.js';

/** The controls for writing a list out, item by item. */
export function ListControls({
  draft,
  lists,
  unknown,
  onChange,
}: {
  draft: ListDraft;
  /** Only the lists that have fields; a list of plain values is `$join`'s job. */
  lists: Array<{ group: string; items: FlowValue[] }>;
  /** Lists whose items nothing is known about — nameable, and fixable. */
  unknown: FlowValue[];
  onChange: (next: ListDraft) => void;
}) {
  // Above the early return: a hook cannot hide behind a condition.
  const [inserting, setInserting] = useState(false);

  if (lists.length === 0) {
    // Two different dead ends, and telling them apart is the difference between
    return unknown.length > 0 ? (
      <p className="text-[11.5px] leading-relaxed text-[var(--wui-fg-muted)]">
        <span className="font-mono">{unknown[0]?.label}</span> is a list, but nothing is known
        about what each item holds — so there is no field to label or show. Open that lookup, go
        to <span className="font-medium">What comes back</span>, and paste a sample response: the
        fields inside each item are read from it.
      </p>
    ) : (
      <p className="text-[11.5px] leading-relaxed text-[var(--wui-fg-muted)]">
        Nothing this screen can see is a list of items. One comes from a lookup that answers with
        a list — paste a sample response under <span className="font-medium">What comes back</span>{' '}
        and its items become available here.
      </p>
    );
  }

  const fields = lists
    .flatMap((group) => group.items)
    .find((item) => item.path === draft.source.path)?.itemFields;
  const set = (patch: Partial<ListDraft>) => onChange({ ...draft, ...patch });
  const named = SEPARATORS.some((separator) => separator.value === draft.separator);

  /** One line, with the field names standing in for values there is no data for. */
  const line =
    draft.template.trim() === ''
      ? null
      : draft.template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => `<${path.trim()}>`);

  return (
    <div className="flex flex-col gap-1.5">
      <Row label="of">
        <Select
          aria-label="Which list"
          value={draft.source.path}
          // Another list has other fields, so a filter written for the old one
          onChange={(e) =>
            onChange({ ...draft, source: { ...emptySlot(), path: e.target.value } })
          }
          className="w-auto max-w-full flex-1 px-2 py-1 text-[12px]"
        >
          <option value="">Pick a list…</option>
          {lists.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Row>

      {fields !== undefined && (
        <>
          <FilterRow
            suffix=""
            fields={fields}
            slot={draft.source}
            onChange={(patch) => set({ source: { ...draft.source, ...patch } })}
          />

          {/* The same box a screen's message is written in, down one level: the
              gesture — type text, drop `{{a value}}` into it — already exists,
              and a second mechanism for it would only be a second thing to
              learn and a ceiling on what can be said. */}
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] text-[var(--wui-fg-muted)]">each item reads</span>
            <CommitTextarea
              aria-label="What each item reads"
              value={draft.template}
              rows={2}
              placeholder="{{description}} = {{amount.amount}}"
              onCommit={(template) => set({ template })}
              onBraces={() => setInserting(true)}
              className="rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] px-2 py-1.5 text-[12px]"
              footer={(insert) => (
                <ItemFields
                  fields={fields}
                  open={inserting}
                  onOpenChange={setInserting}
                  insert={insert}
                />
              )}
            />
          </div>

          <Row label="between">
            <Select
              aria-label="Between items"
              value={draft.separator}
              onChange={(e) => set({ separator: e.target.value })}
              className="w-auto px-2 py-1 text-[12px]"
            >
              {/* What a hand-written expression used, so reading one back does
                  not silently change it. */}
              {!named && <option value={draft.separator}>{JSON.stringify(draft.separator)}</option>}
              {SEPARATORS.map((separator) => (
                <option key={separator.value} value={separator.value}>
                  {separator.label}
                </option>
              ))}
            </Select>
          </Row>

          <Row label="if empty">
            <input
              aria-label="If the list is empty"
              value={draft.empty}
              placeholder="say nothing at all"
              onChange={(e) => set({ empty: e.target.value })}
              className={`flex-1 ${TEXT_INPUT}`}
            />
          </Row>

          {line !== null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-[var(--wui-fg-muted)]">It will read</span>
              <pre className="whitespace-pre-wrap break-all rounded-[var(--wui-radius-sm)] bg-[var(--wui-bg)] px-2 py-1 font-mono text-[11px] text-[var(--wui-fg-muted)]">
                {[line, line, '…'].join(draft.separator)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The fields of one item, to drop into the line. */
function ItemFields({
  fields,
  insert,
  open,
  onOpenChange,
}: {
  fields: readonly DeclaredField[];
  insert: (text: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (fields.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="self-start text-[11.5px] text-[var(--wui-fg-muted)] underline-offset-2 hover:text-[var(--wui-fg)] hover:underline"
      >
        Insert a field…
      </button>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Insert a field"
      className="flex flex-wrap gap-1 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-1.5"
    >
      {fields.map((field) => (
        <button
          key={field.path}
          type="button"
          title={field.type ?? 'type not declared'}
          onClick={() => {
            insert(`{{${field.path}}}`);
            onOpenChange(false);
          }}
          className="rounded bg-[var(--wui-surface,var(--wui-bg))] px-1.5 py-0.5 font-mono text-[10px] text-[var(--wui-fg)] hover:bg-[var(--wui-bg)]"
        >
          {field.path}
        </button>
      ))}
    </div>
  );
}

/** `<label>   <controls>`, so the rows of a form line up down the left. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-[72px] shrink-0 text-[11.5px] text-[var(--wui-fg-muted)]">{label}</span>
      {children}
    </div>
  );
}
