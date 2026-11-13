/**
 * Working a value out, for someone who does not write expressions.
 *
 * A form that *writes* an expression: choose an operation, fill its parameters
 * from the same values the rest of the inspector offers, and the `{% … %}` is
 * composed by the SDK. It reads back what it wrote, so an expression can be
 * edited rather than rebuilt, and gives up on anything it did not write.
 *
 * "List each item" is in the same menu but is not a call — see `ListControls`.
 * The escape hatch is one link away, seeded with whatever the form has built.
 */
import { useMemo, useState } from 'react';
import {
  kindOfJsonType,
  type TypeKind,
} from '@xyne/workflow-sdk/builder';
import {
  expressionFunction,
  baseKind,
  readComputation,
  argumentSlots,
  takesSeveral,
  wantsAt,
  toExpressionValue,
  writeComputation,
  type Computation,
  type ExprType,
} from '@xyne/workflow-sdk/expression';
import { ExpressionEditor, type ExpressionPath } from '../../shared/ExpressionEditor.js';
import { ListControls } from './ListControls.js';
import { FilterRow, TEXT_INPUT } from './controls.js';
import {
  LIST_SHAPE,
  acceptableIn,
  emptyList,
  emptySlot,
  fromArgument,
  fromListFormat,
  groupsFor,
  menuChoice,
  toArgument,
  toListFormat,
  type ListDraft,
  type Slot,
} from '../computation.js';
import type { FlowValue } from './DataSections.js';
import { Button, Select } from '../ui.js';

export function Calculate({
  groups,
  initial,
  expects,
  onInsert,
  onCancel,
}: {
  /** Everything this screen can quote — the same list the chips above use. */
  groups: Array<{ group: string; items: FlowValue[] }>;
  /**
   * An expression already in the slot, carried into the form so that editing one
   * does not mean building it again from nothing.
   */
  initial?: string | undefined;
  /**
   * What the result has to be, when something downstream insists — a condition's "is greater than" can only hold against a number, so offering "UPPERCASE" there is offering a dead end.
   */
  expects?: TypeKind | undefined;
  /** Receives the finished `{% … %}`, to drop in where the cursor is. */
  onInsert: (text: string) => void;
  onCancel: () => void;
}) {
  /** Which offered values are lists — what tells `items.amount` from `a.b`. */
  const listPaths = useMemo(
    () =>
      new Set(
        groups
          .flatMap((group) => group.items)
          .filter((item) => kindOfJsonType(item.type) === 'array')
          .map((item) => item.path),
      ),
    [groups],
  );

  const recovered = useMemo(
    () =>
      initial === undefined ? null : readComputation(initial, (path) => listPaths.has(path)),
    [initial, listPaths],
  );

  const [name, setName] = useState(
    recovered === null ? '' : recovered.kind === 'list' ? LIST_SHAPE : recovered.fn,
  );
  const [slots, setSlots] = useState<Slot[]>(() => rowsFor(recovered));
  const [list, setList] = useState<ListDraft>(
    recovered?.kind === 'list' ? fromListFormat(recovered) : emptyList(),
  );
  /** An expression was handed in, and this form could not read it. */
  const unreadable = initial !== undefined && initial.trim() !== '' && recovered === null;

  const choice = menuChoice(name);
  const listing = name === LIST_SHAPE;
  const fn = expressionFunction(name);
  const shape = argumentSlots(name);
  const itemFieldsOf = (path: string) =>
    groups.flatMap((group) => group.items).find((value) => value.path === path)?.itemFields;

  /** A row, with what its chosen list declares its fields to be. */
  const argOf = (slot: Slot) =>
    toArgument(slot, (field) => itemFieldsOf(slot.path)?.find((f) => f.path === field)?.type);

  /** The first parameter takes a list, so this form offers several rows for it. */
  const several = shape !== null && takesSeveral(name, 0) && shape.count === 1;
  const expression = listing
    ? writeComputation(
        toListFormat(list, (field) =>
          itemFieldsOf(list.source.path)?.find((f) => f.path === field)?.type,
        ),
      )
    : fn && shape
      ? writeComputation({
          kind: 'call',
          fn: name,
          args: several ? [{ kind: 'list', of: slots.map(argOf) }] : slots.map(argOf),
        })
      : null;


  /** The lists this screen holds that have fields to show. */
  const listsWithFields = useMemo(
    () =>
      groups
        .map((group) => ({
          group: group.group,
          items: group.items.filter((item) => item.itemFields !== undefined),
        }))
        .filter((group) => group.items.length > 0),
    [groups],
  );

  /** Lists whose items are a mystery. */
  const listsWithoutFields = useMemo(
    () =>
      groups
        .flatMap((group) => group.items)
        .filter((item) => kindOfJsonType(item.type) === 'array' && item.itemFields === undefined),
    [groups],
  );

  /** Every address an expression here may read. */
  const paths = useMemo<ExpressionPath[]>(
    () =>
      groups.flatMap((group) =>
        group.items.flatMap((item) => [
          { path: item.path, schemaType: item.type ?? '' },
          ...(item.itemFields ?? []).map((field) => ({
            path: `${item.path}.${field.path}`,
            schemaType: field.type ?? '',
          })),
        ]),
      ),
    [groups],
  );

  /** Hand-written mode, and what it holds. */
  const [writing, setWriting] = useState(false);
  const [typed, setTyped] = useState<unknown>(initial);

  const pick = (chosen: string) => {
    setName(chosen);
    if (chosen === LIST_SHAPE) setList(emptyList());
    else setSlots(Array.from({ length: argumentSlots(chosen)?.count ?? 1 }, emptySlot));
  };

  const update = (index: number, patch: Partial<Slot>) => {
    setSlots((prev) => prev.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  };

  const typedText = typeof typed === 'string' && typed.trim() !== '' ? typed : null;

  if (writing) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-2">
        <ExpressionEditor
          value={typed}
          onChange={setTyped}
          paths={paths}
          {...(expects === undefined ? {} : { fieldType: expects })}
          renderPicker={({ insert, close }) => (
            <PathPicker groups={groups} onPick={insert} onClose={close} />
          )}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={typedText === null}
            onClick={() => {
              if (typedText !== null) onInsert(typedText);
            }}
          >
            Insert
          </Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <button
            type="button"
            onClick={() => setWriting(false)}
            className="text-[11.5px] text-[var(--wui-fg-muted)] underline-offset-2 hover:text-[var(--wui-fg)] hover:underline"
          >
            use the form instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-2">
      <Select
        aria-label="What to work out"
        value={name}
        onChange={(e) => pick(e.target.value)}
        className="px-2 py-1 text-[12px]"
      >
        <option value="">What to work out…</option>
        {groupsFor(expects).map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.items.map((item) => (
              <option key={item.name} value={item.name}>
                {item.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      {unreadable && (
        <p className="text-[11.5px] leading-relaxed text-[var(--wui-fg-muted)]">
          The expression there was written by hand, so this form starts empty. Inserting will
          replace it.
        </p>
      )}

      {choice && (
        <p className="text-[11.5px] leading-relaxed text-[var(--wui-fg-muted)]">{choice.help}</p>
      )}

      {listing && (
        <ListControls
          draft={list}
          lists={listsWithFields}
          unknown={listsWithoutFields}
          onChange={setList}
        />
      )}

      {fn && shape && (
        <>

          <div className="flex flex-col gap-1.5">
            {slots.map((slot, index) => {
              const itemFields = itemFieldsOf(slot.path);
              const nth = String(index + 1);
              const many = shape.count > 1 || several;
              return (
                <div key={index} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1">
                    {/* Which of the two this row is, said rather than guessed:
                        `trigger.name` typed into a fixed box is those words. */}
                    <Select
                      aria-label={`How ${many ? `value ${nth}` : 'the value'} is given`}
                      value={slot.mode}
                      onChange={(e) =>
                        update(index, {
                          ...emptySlot(),
                          mode: e.target.value as Slot['mode'],
                        })
                      }
                      className="w-auto px-2 py-1 text-[12px]"
                    >
                      <option value="value">A value</option>
                      <option value="fixed">Fixed</option>
                    </Select>

                    {slot.mode === 'fixed' ? (
                      <input
                        aria-label={many ? `Fixed ${nth}` : 'The fixed value'}
                        value={slot.raw}
                        placeholder={placeholderFor(wantsAt(name, several ? 0 : index))}
                        onChange={(e) => update(index, { raw: e.target.value })}
                        className={`min-w-0 flex-1 ${TEXT_INPUT}`}
                      />
                    ) : (
                      <Select
                        aria-label={many ? `Value ${nth}` : 'Which value'}
                        value={slot.path}
                        // A different list has different items, so a filter
                        onChange={(e) =>
                          update(index, { ...emptySlot(), path: e.target.value })
                        }
                        className="min-w-0 flex-1 px-2 py-1 text-[12px]"
                      >
                        <option value="">Pick a value…</option>
                        {groups.map((group) => {
                          // This control's own parameter, not the call's first.
                          const items = acceptableIn(
                            wantsAt(name, several ? 0 : index),
                            group.items,
                          );
                          if (items.length === 0) return null;
                          return (
                            <optgroup key={group.group} label={group.group}>
                              {items.map((item) => (
                                <option key={item.path} value={item.path}>
                                  {item.type ? `${item.label} · ${item.type}` : item.label}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </Select>
                    )}
                  </div>

                  {/* Only for a list of objects that was picked, not typed:
                      there is something to narrow by and something to read off
                      each one. */}
                  {slot.mode === 'value' && itemFields !== undefined && (
                    <div className="ml-1 flex flex-col gap-1 border-l-2 border-[var(--wui-border)] pl-2">
                      <FilterRow
                        suffix={` ${nth}`}
                        fields={itemFields}
                        slot={slot}
                        onChange={(patch) => update(index, patch)}
                      />
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[11.5px] text-[var(--wui-fg-muted)]">and use</span>
                        <Select
                          aria-label={`Use field ${nth}`}
                          value={slot.use}
                          onChange={(e) => update(index, { use: e.target.value })}
                          className="w-auto px-2 py-1 text-[12px]"
                        >
                          <option value="">the whole item</option>
                          {itemFields.map((field) => (
                            <option key={field.path} value={field.path}>
                              {field.type ? `${field.path} · ${field.type}` : field.path}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {several && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setSlots((prev) => [...prev, emptySlot()])}
                className="text-[11.5px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
              >
                + add another value
              </button>
              {/* One click adds a row; without this the only way back is to
                  choose the operation again, which clears the ones you meant. */}
              {slots.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSlots((prev) => prev.slice(0, -1))}
                  className="text-[11.5px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
                >
                  − one fewer
                </button>
              )}
            </div>
          )}

          {/* No result to show — nothing here holds the data a run would have.
              What it can show is exactly what will be written, which is the part
              an author cannot otherwise check. */}
          {expression !== null && (
            <p className="break-all rounded-[var(--wui-radius-sm)] bg-[var(--wui-bg)] px-2 py-1 font-mono text-[11px] text-[var(--wui-fg-muted)]">
              {toExpressionValue(expression)}
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={expression === null}
          onClick={() => {
            if (expression !== null) onInsert(toExpressionValue(expression));
          }}
        >
          Insert
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <button
          type="button"
          onClick={() => {
            // Carried across, so writing it yourself means continuing from what
            setTyped(expression === null ? initial : toExpressionValue(expression));
            setWriting(true);
          }}
          className="text-[11.5px] text-[var(--wui-fg-muted)] underline-offset-2 hover:text-[var(--wui-fg)] hover:underline"
        >
          or write it yourself
        </button>
      </div>
    </div>
  );
}



/** The values a screen holds, as something to click. */
function PathPicker({
  groups,
  onPick,
  onClose,
}: {
  groups: Array<{ group: string; items: FlowValue[] }>;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Insert a value"
      className="absolute left-0 top-full z-10 mt-1 max-h-64 w-full overflow-auto rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] p-1.5 shadow-lg"
    >
      {groups.map((group) => (
        <div key={group.group} className="flex flex-col gap-1 py-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">
            {group.group}
          </p>
          {group.items.map((item) => (
            <div key={item.path} className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => {
                  onPick(item.path);
                  onClose();
                }}
                className="rounded bg-[var(--wui-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--wui-fg)] hover:bg-[var(--wui-bg)]"
              >
                {item.path}
              </button>
              {/* A field of every item — the address an expression needs and
                  the chips cannot offer, since there is no one item to quote. */}
              {(item.itemFields ?? []).map((field) => (
                <button
                  key={field.path}
                  type="button"
                  onClick={() => {
                    onPick(`${item.path}.${field.path}`);
                    onClose();
                  }}
                  className="rounded bg-[var(--wui-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg)] hover:text-[var(--wui-fg)]"
                >
                  …{field.path}
                </button>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The rows a recovered call should open with. */
function rowsFor(recovered: Computation | null): Slot[] {
  if (recovered?.kind !== 'call') return [emptySlot()];

  const first = recovered.args[0];
  if (recovered.args.length === 1 && first?.kind === 'list') {
    return first.of.length === 0 ? [emptySlot()] : first.of.map(fromArgument);
  }

  const rows = recovered.args.map(fromArgument);
  const wanted = argumentSlots(recovered.fn)?.count ?? rows.length;
  while (rows.length < wanted) rows.push(emptySlot());
  return rows.length === 0 ? [emptySlot()] : rows;
}

/** What a fixed value for this parameter should look like. */
function placeholderFor(want: ExprType): string {
  const kind = baseKind(want);
  if (kind === 'number') return 'a number';
  if (kind === 'boolean') return 'true or false';
  return 'some text';
}
