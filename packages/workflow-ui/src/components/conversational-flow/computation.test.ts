/**
 * The form's own shape. The expression language it drives is tested in the SDK,
 * where it lives — these are the decisions a *form* makes.
 */
import { describe, it, expect } from 'vitest';
import {
  wantsAt,
} from '@xyne/workflow-sdk/expression';
import {
  GROUPS,
  acceptableIn,
  emptyList,
  emptySlot,
  fromArgument,
  fromListFormat,
  groupsFor,
  sayPlainly,
  toArgument,
  toListFormat,
  type ListDraft,
  type Slot,
} from './computation.js';

describe('a row and the SDK model it stands for', () => {
  it('reads a complete row as a narrowed, plucked selection', () => {
    expect(
      toArgument({
        ...emptySlot(),
        path: 'steps.a.output.items',
        field: 'tag',
        op: '=',
        test: 'fee',
        use: 'amount',
      }),
    ).toEqual({
      kind: 'value',
      path: 'steps.a.output.items',
      filter: { field: 'tag', op: '=', value: 'fee' },
      field: 'amount',
    });
  });

  it('treats a half-written filter as no filter', () => {
    const partial = toArgument({ ...emptySlot(), path: 'a.b', field: 'tag' });
    expect(partial).toEqual({ kind: 'value', path: 'a.b' });
    expect(partial).not.toHaveProperty('filter');
  });

  it('round-trips a selection back into a row', () => {
    const slot: Slot = {
      ...emptySlot(),
      path: 'a.b',
      field: 'tag',
      op: '>',
      test: '10',
      use: 'amount',
    };
    expect(fromArgument(toArgument(slot))).toEqual(slot);
    expect(fromArgument({ kind: 'value', path: 'a.b' })).toEqual(emptySlot_with('a.b'));
  });

  it('round-trips a typed value back into a row, as a typed value', () => {
    // The mode survives, which is the whole point of recording it: a path
    // someone typed must not come back as a path someone picked.
    const typed: Slot = { ...emptySlot(), mode: 'fixed', raw: 'trigger.name' };
    expect(fromArgument(toArgument(typed))).toEqual(typed);
    expect(toArgument(typed)).toEqual({ kind: 'fixed', raw: 'trigger.name' });
  });

  it('reads a one-entry list back as that entry', () => {
    // `$sum([a])` and `$sum(a)` mean the same; the form shows one row for both.
    expect(fromArgument({ kind: 'list', of: [{ kind: 'value', path: 'a.b' }] })).toEqual(
      emptySlot_with('a.b'),
    );
  });

  function emptySlot_with(path: string) {
    return { ...emptySlot(), path };
  }
});

describe('GROUPS — what the menu offers', () => {
  it('leaves out the operations a form cannot describe', () => {
    const offered = GROUPS.flatMap((group) => group.items).map((item) => item.name);
    expect(offered).not.toContain('$filter');
    expect(offered).not.toContain('$map');
    expect(offered).toContain('$sum');
    expect(offered).toContain('$count');
  });

  it('groups by what each one gives back', () => {
    const labelled = (label: string) =>
      GROUPS.find((group) => group.label === label)?.items.map((item) => item.name) ?? [];
    expect(labelled('Numbers')).toContain('$sum');
    expect(labelled('Text')).toContain('$uppercase');
    expect(labelled('Lists')).toContain('$sort');
  });
});

describe('acceptableIn — which values a slot takes', () => {
  const items = [
    { label: 'amount', type: 'number' },
    { label: 'count', type: 'integer' },
    { label: 'status', type: 'string' },
    { label: 'items', type: 'array' },
    { label: 'whatever', type: undefined },
  ];
  /** What the control for parameter `at` of this operation offers. */
  const labels = (name: string, at = 0) =>
    acceptableIn(wantsAt(name, at), items).map((item) => item.label);

  it('narrows a single-value operation to the type it can read', () => {
    expect(labels('$round')).toEqual(['amount', 'count', 'whatever']);
    expect(labels('$uppercase')).toEqual(['status', 'whatever']);
  });

  it('narrows a list operation to its element type', () => {
    // What element types bought: `$sum` offers the numbers and the list, and no
    // longer offers text.
    expect(labels('$sum')).toEqual(['amount', 'count', 'items', 'whatever']);
    expect(labels('$join')).toEqual(['status', 'items', 'whatever']);
  });

  it('offers everything to an operation that truly takes anything', () => {
    // `$count` is `<a:n>` — a list of anything. `$keys` is `<x-:a<s>>`.
    expect(labels('$count')).toHaveLength(items.length);
    expect(labels('$keys')).toHaveLength(items.length);
  });

  it('never filters out an undeclared type', () => {
    for (const name of ['$round', '$uppercase', '$sum', '$join']) {
      expect(labels(name), name).toContain('whatever');
    }
  });
});

describe('groupsFor — narrowed to what will accept the result', () => {
  const offered = (expects: Parameters<typeof groupsFor>[0]) =>
    groupsFor(expects).flatMap((group) => group.items).map((item) => item.name);

  it('offers everything when nothing insists', () => {
    expect(offered(undefined)).toEqual(GROUPS.flatMap((g) => g.items).map((f) => f.name));
  });

  it('offers only arithmetic where a number is required', () => {
    // A condition's "is greater than" can only hold against a number, so
    // offering "UPPERCASE" there offers a dead end.
    const names = offered('number');
    expect(names).toContain('$sum');
    expect(names).toContain('$count');
    expect(names).not.toContain('$uppercase');
    expect(names).not.toContain('$sort');
  });

  it('offers everything where text is required, because text is the sink', () => {
    expect(offered('string')).toEqual(offered(undefined));
  });

  it('keeps the ones whose result is unknowable', () => {
    expect(offered('number')).toContain('$lookup');
    expect(offered('object')).toContain('$lookup');
  });
});

describe('the list draft, and the format it maps to', () => {
  it('drops a half-written filter rather than writing a broken one', () => {
    const draft = {
      ...emptyList(),
      source: { ...emptySlot(), path: 'steps.a.output.items', field: 'tag' },
      template: '{{amount}}',
    };
    // A field chosen and nothing to test it against is not a filter yet.
    expect(toListFormat(draft).source).toEqual({ path: 'steps.a.output.items' });
  });

  it('leaves out the empty message when it was not asked for', () => {
    const format = toListFormat({
      ...emptyList(),
      source: { ...emptySlot(), path: 'a.b' },
      template: '{{x}}',
    });
    expect(format.empty).toBeUndefined();
  });

  it('round-trips a draft through the format and back', () => {
    const draft: ListDraft = {
      source: { ...emptySlot(), path: 'a.b', field: 'tag', op: '=', test: 'fee' },
      template: '*{{description}}* — ₹{{amount.amount}}',
      separator: ', ',
      empty: 'none',
    };
    expect(fromListFormat(toListFormat(draft))).toEqual(draft);
  });
});

describe('acceptableIn — each control offers what its own parameter takes', () => {
  const items = [
    { type: 'string' as const },
    { type: 'number' as const },
    { type: 'array' as const },
    { type: undefined },
  ];
  const kinds = (want: Parameters<typeof acceptableIn>[0]) =>
    acceptableIn(want, items).map((i) => i.type);

  it('offers numbers where a number goes, and text where text goes', () => {
    expect(kinds('number')).toEqual(['number', undefined]);
    expect(kinds('string')).toEqual(['string', undefined]);
  });

  it('offers the elements of a list, and the lists themselves, for a list parameter', () => {
    // A list-typed value is taken on trust: a JSON-Schema `type` keyword cannot
    // say what it is a list *of*, and the validator says so if it turns out wrong.
    expect(kinds({ array: 'number' })).toEqual(['number', 'array', undefined]);
  });

  it('offers everything for a parameter that declares nothing', () => {
    expect(kinds('unknown')).toEqual(['string', 'number', 'array', undefined]);
  });

  it('does not narrow a later parameter by the first one', () => {
    // `$split(text, separator, limit)` — the limit is a number, and going by
    // the function rather than the parameter offered only text there.
    expect(kinds(wantsAt('$split', 2))).toContain('number');
    expect(wantsAt('$split', 0)).toBe('string');
  });
});

describe('sayPlainly — a message as a card should preview it', () => {
  const noLists = () => false;

  it('names a worked-out value instead of spelling it out', () => {
    const expr =
      '{% $join($map(steps.ride.output.body.fareBreakup, function($i){ $string($i.description) }), "\\n") %}';
    expect(sayPlainly(`Your fares:\n${expr}`, noLists)).toBe('Your fares:\nƒ each fareBreakup');
  });

  it('leaves ordinary text and short references alone', () => {
    expect(sayPlainly('Hello {{trigger.context.name}}', noLists)).toBe(
      'Hello {{trigger.context.name}}',
    );
  });

  it('says only what it knows about one it cannot read', () => {
    expect(sayPlainly('{% $substringBefore(a.b, "@") %}', noLists)).toBe('ƒ worked out');
  });
});
