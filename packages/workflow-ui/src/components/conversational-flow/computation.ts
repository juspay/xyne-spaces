/**
 * What the Calculate form needs that is not the expression language.
 *
 * The language is in the SDK — how a predicate is spelled, how one reads back.
 * Here is the part that is about a *form*: the shape of its controls and which
 * values each one offers. Beside `conditions.ts`, for the same reason.
 */
import {
  kindOfJsonType,
  type TypeKind,
} from '@xyne/workflow-sdk/builder';
import {
  FORMABLE_FUNCTIONS,
  assignableToArgument,
  baseKind,
  elementType,
  expressionFunction,
  readComputation,
  tokenizeExpressions,
  type Argument,
  type ComparisonOp,
  type ExprType,
  type ListFormat,
  type ValueSelection,
} from '@xyne/workflow-sdk/expression';

/** One row of the form. */
export interface Slot {
  /** Picked from the data, or typed by hand. */
  mode: 'value' | 'fixed';
  /** What was typed, when the mode is `fixed`. */
  raw: string;
  /** The chosen value's dotted path. Empty until picked. */
  path: string;
  /** A field of each item to test. Empty for no filter. */
  field: string;
  op: ComparisonOp;
  /** What to test it against. Empty for no filter. */
  test: string;
  /** A field of each item to use instead of the whole item. Empty for all of it. */
  use: string;
}

export const emptySlot = (): Slot => ({
  mode: 'value',
  raw: '',
  path: '',
  field: '',
  op: '=',
  test: '',
  use: '',
});

/**
 * A row as the SDK's model: an argument, however it was filled in.
 *
 * `typeOf` says what a field of the chosen list is declared to be, which only
 * the form knows. Without it a filter spells its value from the value's own
 * shape, and a text field tested against `10` silently matches nothing.
 */
export function toArgument(slot: Slot, typeOf?: (field: string) => string | undefined): Argument {
  return slot.mode === 'fixed'
    ? { kind: 'fixed', raw: slot.raw }
    : { kind: 'value', ...toSelection(slot, typeOf) };
}

/** And back. */
export function fromArgument(argument: Argument): Slot {
  if (argument.kind === 'fixed') return { ...emptySlot(), mode: 'fixed', raw: argument.raw };
  if (argument.kind === 'list') {
    // A one-entry list reads as that entry; the form offers the entries of a
    const only = argument.of[0];
    return only === undefined ? emptySlot() : fromArgument(only);
  }
  return fromSelection(argument);
}

/** A row's value part. A half-written filter is simply not a filter. */
function toSelection(slot: Slot, typeOf?: (field: string) => string | undefined): ValueSelection {
  const declared = slot.field === '' ? undefined : typeOf?.(slot.field);
  return {
    path: slot.path,
    ...(slot.field !== '' && slot.test !== ''
      ? {
          filter: {
            field: slot.field,
            op: slot.op,
            value: slot.test,
            ...(declared === undefined ? {} : { type: kindOfJsonType(declared) }),
          },
        }
      : {}),
    ...(slot.use !== '' ? { field: slot.use } : {}),
  };
}

/** And back, to re-open the form on something already written. */
function fromSelection(selection: ValueSelection): Slot {
  return {
    ...emptySlot(),
    path: selection.path,
    ...(selection.filter
      ? { field: selection.filter.field, op: selection.filter.op, test: selection.filter.value }
      : {}),
    ...(selection.field !== undefined ? { use: selection.field } : {}),
  };
}

/** The list form's rows. */
export interface ListDraft {
  source: Slot;
  /** What one item reads, with `{{field}}` in it. */
  template: string;
  separator: string;
  /** What to say when the list is empty. Empty to say nothing — and nothing shows. */
  empty: string;
}

export const emptyList = (): ListDraft => ({
  source: emptySlot(),
  template: '',
  separator: '\n',
  empty: '',
});

/** The rows as the SDK's model. `typeOf` as in {@link toArgument}. */
export function toListFormat(
  draft: ListDraft,
  typeOf?: (field: string) => string | undefined,
): ListFormat {
  return {
    kind: 'list',
    source: toSelection({ ...draft.source, use: '' }, typeOf),
    template: draft.template,
    separator: draft.separator,
    ...(draft.empty !== '' ? { empty: draft.empty } : {}),
  };
}

/** And back, to re-open the form on something already written. */
export function fromListFormat(format: ListFormat): ListDraft {
  return {
    ...emptyList(),
    source: fromSelection(format.source),
    template: format.template,
    separator: format.separator,
    ...(format.empty === undefined ? {} : { empty: format.empty }),
  };
}

/** How one item is parted from the next, named — a space is invisible in a box. */
export const SEPARATORS: Array<{ value: string; label: string }> = [
  { value: '\n', label: 'a new line' },
  { value: ', ', label: 'a comma' },
  { value: '; ', label: 'a semicolon' },
  { value: ' | ', label: 'a bar' },
  { value: ' ', label: 'a space' },
];

/** The list shape's slug in the operation menu. */
export const LIST_SHAPE = 'each-item';

/** One entry in the operation menu: a catalogue function, or the list shape. */
export interface MenuChoice {
  name: string;
  label: string;
  help: string;
  offer: string;
}

/**
 * Listing a list is in the same menu as the functions, because to an author it is the same question — "what do you want to do with this?" — even though the SDK models it as a shape of its own rather than a call.
 */
const LIST_CHOICE: MenuChoice = {
  name: LIST_SHAPE,
  label: 'List each item',
  // No worked example here on purpose: one would have to borrow some domain's
  help: 'Write out every item of a list — you write the line, once, with its fields in it.',
  // It produces text, so a number requirement narrows it away with the rest.
  offer: 'string',
};

/** The operations, grouped for a menu by what they give back. */
export const GROUPS: Array<{ label: string; items: readonly MenuChoice[] }> = [
  { label: 'Every item', items: [LIST_CHOICE] },
  { label: 'Numbers', items: FORMABLE_FUNCTIONS.filter((fn) => fn.offer === 'number') },
  { label: 'Text', items: FORMABLE_FUNCTIONS.filter((fn) => fn.offer === 'string') },
  { label: 'Lists', items: FORMABLE_FUNCTIONS.filter((fn) => fn.offer === 'array') },
  {
    label: 'Other',
    items: FORMABLE_FUNCTIONS.filter(
      (fn) => !['number', 'string', 'array'].includes(fn.offer),
    ),
  },
].filter((group) => group.items.length > 0);

/** Which values a control will accept. */
export function acceptableIn<T extends { type: string | undefined }>(
  want: ExprType,
  items: readonly T[],
): T[] {
  const takesList = baseKind(want) === 'array';
  const wanted = takesList ? elementType(want) : want;
  if (wanted === 'unknown') return [...items];
  return items.filter((item) => {
    if (item.type === undefined) return true;
    const kind = kindOfJsonType(item.type);
    if (kind === 'unknown') return true;
    if (kind === 'array') return takesList;
    return assignableToArgument(kind, wanted);
  });
}

/** The menu, narrowed to what something downstream will accept. */
export function groupsFor(
  expects: TypeKind | undefined,
): Array<{ label: string; items: readonly MenuChoice[] }> {
  if (expects === undefined || expects === 'string' || expects === 'unknown') return GROUPS;
  return GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((fn) => fn.offer === 'unknown' || fn.offer === expects),
  })).filter((group) => group.items.length > 0);
}

/** An entry of the menu by its slug, for its label and help text. */
export function menuChoice(name: string): MenuChoice | undefined {
  return GROUPS.flatMap((group) => group.items).find((item) => item.name === name);
}

/**
 * What a worked-out value is called, in a few words.
 *
 * Read back from the expression rather than stored beside it, so it cannot drift
 * from what the expression actually does — and so an expression written by hand
 * still gets a name. Anything unreadable is "worked out", which is true and
 * says no more than it knows.
 */
export function describeComputation(
  expression: string,
  isList: (path: string) => boolean,
): string {
  const computation = readComputation(expression, isList);
  if (computation === null) return 'worked out';
  if (computation.kind === 'list') {
    const of = lastSegment(computation.source.path);
    return of === '' ? 'each item' : `each ${of}`;
  }
  const label = expressionFunction(computation.fn)?.label ?? computation.fn;
  const first = lastSegment(pathOf(computation.args[0]));
  return first === '' ? label.toLowerCase() : `${label.toLowerCase()} of ${first}`;
}

/** The data an argument points at, if it points at any. */
function pathOf(argument: Argument | undefined): string {
  if (argument === undefined) return '';
  if (argument.kind === 'value') return argument.path;
  if (argument.kind === 'list') return pathOf(argument.of[0]);
  return '';
}

/** `steps.ride.output.body.fareBreakup` → `fareBreakup`. */
function lastSegment(path: string): string {
  const names = path.split('.');
  return names[names.length - 1] ?? '';
}

/**
 * A line of text with its expressions named rather than spelled out.
 *
 * For anywhere a message is *previewed* rather than edited — a card on the map
 * — where two hundred characters of JSONata is the same problem it was in the
 * box, with less room to show it.
 */
export function sayPlainly(text: string, isList: (path: string) => boolean): string {
  return tokenizeExpressions(text)
    .map((token) =>
      token.kind === 'expression' ? `ƒ ${describeComputation(token.raw, isList)}` : token.text,
    )
    .join('');
}
