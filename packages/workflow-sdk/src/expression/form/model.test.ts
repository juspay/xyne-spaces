import { describe, it, expect } from 'vitest';
import {
  argumentSlots,
  takesSeveral,
  wantsAt,
  type Argument,
  type ItemFilter,
  type Call,
  type ListFormat,
} from './model.js';
import { writeComputation, writeLiteral, writeSelection } from './write.js';
import { readComputation } from './read.js';
import { compileExpression } from '../parse.js';
import { baseKind, elementType } from '../types.js';
import { toExpressionValue } from '../../expression/format.js';
import {
  FORMABLE_FUNCTIONS,
  isFormable,
} from './model.js';
import type { ExpressionFunction } from '../../expression/catalogue.js';

const LISTS = new Set(['steps.refund.output.body.items', 'trigger.context.tags']);
const isList = (path: string) => LISTS.has(path);

/** A picked value, as an argument. */
const at = (path: string, rest: Partial<Argument> = {}): Argument =>
  ({ kind: 'value', path, ...rest }) as Argument;
/** Several things where a list is wanted. */
const list = (...of: Argument[]): Argument => ({ kind: 'list', of });
/** Something typed into a box. */
const fixed = (raw: string): Argument => ({ kind: 'fixed', raw });

/**
 * A plausible value for the nth parameter, typed as that parameter wants.
 *
 * The round trip has to fill every argument, and what fills them has to be
 * valid: `"2"` into `$round`'s places and `"x"` into `$replace`'s find are not
 * interchangeable, which is the whole reason the signature decides.
 */
function fixedFor(fn: ExpressionFunction, at: number): Argument {
  const want = fn.signature.params[at]?.type;
  if (want === 'number') return fixed('2');
  if (want === 'boolean') return fixed('true');
  return fixed('x');
}

/** Read something this wrote as a call, failing loudly if it came back otherwise. */
function readCall(source: string): Call {
  const back = readComputation(toExpressionValue(source), isList);
  if (back?.kind !== 'call') throw new Error(`read as ${back?.kind ?? 'nothing'}: ${source}`);
  return back;
}

describe('writeLiteral — what the author typed, typed', () => {
  it('leaves a number bare, so a comparison compares numbers', () => {
    expect(writeLiteral('10')).toBe('10');
    expect(writeLiteral(' 10.5 ')).toBe('10.5');
    expect(writeLiteral('-3')).toBe('-3');
  });

  it('leaves true, false and null bare', () => {
    for (const raw of ['true', 'false', 'null']) expect(writeLiteral(raw)).toBe(raw);
  });

  it('quotes text, and survives a quote inside it', () => {
    expect(writeLiteral('fee')).toBe('"fee"');
    expect(writeLiteral('a "b" c')).toBe('"a \\"b\\" c"');
  });
});

describe('writeSelection — narrowing a list without a function literal', () => {
  const path = 'steps.refund.output.body.items';

  it('is just the path when nothing is asked of it', () => {
    expect(writeSelection({ path })).toBe(path);
  });

  it('narrows with JSONata own predicate syntax', () => {
    expect(writeSelection({ path, filter: { field: 'tag', op: '=', value: 'fee' } })).toBe(
      `${path}[tag = "fee"]`,
    );
  });

  it('reads one field off each item', () => {
    expect(writeSelection({ path, field: 'amount' })).toBe(`${path}.amount`);
  });

  it('narrows and then reads — the case this was built for', () => {
    expect(
      writeSelection({ path, filter: { field: 'tag', op: '=', value: 'fee' }, field: 'amount' }),
    ).toBe(`${path}[tag = "fee"].amount`);
  });

  it('compares numbers numerically', () => {
    expect(writeSelection({ path, filter: { field: 'amount', op: '>', value: '10' } })).toBe(
      `${path}[amount > 10]`,
    );
  });

  it('ignores a half-written filter rather than emitting a broken one', () => {
    expect(writeSelection({ path, filter: { field: 'tag', op: '=', value: '' } })).toBe(path);
  });

  it('is empty until a path is chosen', () => {
    expect(writeSelection({ path: '' })).toBe('');
  });
});

describe('writeComputation', () => {
  it('adds up several values — the case this exists for', () => {
    expect(
      writeComputation({
        kind: 'call',
        fn: '$sum',
        args: [list(at('steps.a.output.x'), at('steps.b.output.y'))],
      }),
    ).toBe('$sum([steps.a.output.x, steps.b.output.y])');
  });

  it('takes one list as it is, with no brackets it does not need', () => {
    expect(writeComputation({ kind: 'call', fn: '$sum', args: [at('steps.a.output.xs')] })).toBe(
      '$sum(steps.a.output.xs)',
    );
  });

  it('writes arithmetic the way JSONata spells it', () => {
    expect(
      writeComputation({ kind: 'call', fn: 'multiply', args: [at('a.b'), fixed('1.18')] }),
    ).toBe('a.b * 1.18');
    expect(writeComputation({ kind: 'call', fn: 'divide', args: [at('a.b'), at('a.c')] })).toBe(
      'a.b / a.c',
    );
  });

  it('lets each parameter have its own separator, which a frozen one could not', () => {
    expect(
      writeComputation({ kind: 'call', fn: '$join', args: [at('a.tags'), fixed(' and ')] }),
    ).toBe('$join(a.tags, " and ")');
  });

  it('writes a fixed value the way the parameter wants it, not the way it looks', () => {
    // `2` into a number parameter is a number…
    expect(
      writeComputation({ kind: 'call', fn: '$round', args: [at('a.n'), fixed('2')] }),
    ).toBe('$round(a.n, 2)');
    // …and the same two characters into a text parameter are text. Both are
    // `T0410` the other way round, which is why the signature decides.
    expect(
      writeComputation({ kind: 'call', fn: '$replace', args: [at('a.s'), fixed('2'), fixed('X')] }),
    ).toBe('$replace(a.s, "2", "X")');
  });

  it('refuses a fixed value the parameter cannot hold', () => {
    expect(
      writeComputation({ kind: 'call', fn: '$round', args: [at('a.n'), fixed('abc')] }),
    ).toBeNull();
  });

  it('leaves a trailing optional argument off when it is blank', () => {
    expect(writeComputation({ kind: 'call', fn: '$round', args: [at('a.n'), fixed('')] })).toBe(
      '$round(a.n)',
    );
  });

  it('refuses a blank in the middle rather than shifting what follows it', () => {
    expect(
      writeComputation({
        kind: 'call',
        fn: '$replace',
        args: [at('a.s'), fixed(''), fixed('X')],
      }),
    ).toBeNull();
  });

  it('refuses to write something incomplete', () => {
    expect(writeComputation({ kind: 'call', fn: '$sum', args: [] })).toBeNull();
    expect(writeComputation({ kind: 'call', fn: '$round', args: [at('')] })).toBeNull();
    // Two placeholders, one value — would leave a `…` in the output.
    expect(writeComputation({ kind: 'call', fn: '$append', args: [at('a.b')] })).toBeNull();
    expect(writeComputation({ kind: 'call', fn: '$nope', args: [at('a.b')] })).toBeNull();
  });
});

describe('argumentSlots', () => {
  it('says which parameter takes a list, not whether the call does', () => {
    expect(argumentSlots('$sum')).toEqual({ count: 1 });
    expect(takesSeveral('$sum', 0)).toBe(true);
  });

  it('takes one per parameter the signature declares, optional ones included', () => {
    // `<n-n?:n>` — the value, and how many places to round to.
    expect(argumentSlots('$round')).toEqual({ count: 2 });
    // `<s-(sf)(sf)n?:s>` — in, find, with, and how many times.
    expect(argumentSlots('$replace')).toEqual({ count: 4 });
  });

  it('knows nothing of a name a form cannot describe', () => {
    // Not in the catalogue at all…
    expect(argumentSlots('$substringBefore')).toBeNull();
    // …and in it, but needing a function a form cannot ask for.
    expect(argumentSlots('$filter')).toBeNull();
    expect(isFormable('$filter')).toBe(false);
    expect(isFormable('$sum')).toBe(true);
  });
});

describe('readComputation', () => {
  it('reads back the full requirement, filter and field included', () => {
    const picked = at('steps.refund.output.body.items', {
      field: 'amount',
      filter: { field: 'tag', op: '=', value: 'fee', type: 'string' },
    });

    // Written wrapped by an earlier version, and still read: the brackets mean
    // "several entries here", so one of them is a list of one.
    expect(readCall('$sum([steps.refund.output.body.items[tag = "fee"].amount])')).toEqual({
      kind: 'call',
      fn: '$sum',
      args: [list(picked)],
    });

    // Written bare, which is what a single picked list gets today.
    expect(readCall('$sum(steps.refund.output.body.items[tag = "fee"].amount)')).toEqual({
      kind: 'call',
      fn: '$sum',
      args: [picked],
    });
  });

  it('reads a numeric filter without quoting it back as text', () => {
    const back = readCall('$count(steps.refund.output.body.items[amount > 10])');
    expect(back.args[0]?.kind === 'value' ? back.args[0].filter : null).toEqual({
      field: 'amount',
      op: '>',
      value: '10',
      // Recovered from how it was spelled — a bare number was a number.
      type: 'number',
    });
  });

  it('does not mistake a plain nested path for a list and a field', () => {
    const back = readCall('$uppercase(trigger.context.a.b)');
    expect(back.args[0]).toEqual(at('trigger.context.a.b'));
  });

  it('gives up on anything this could not have written', () => {
    for (const source of [
      '$substringBefore(trigger.context.a, "@")',
      '$filter(trigger.context.tags, function($t){ $t })',
      '$sum(trigger.context.a) + 1',
      '$sum(trigger.context.tags[tag = "fee" and x > 1])',
      '$sum(',
    ]) {
      expect(readComputation(toExpressionValue(source), isList), source).toBeNull();
    }
    expect(readComputation('not an expression', isList)).toBeNull();
  });

  it('round-trips everything it can write', () => {
    // The property that matters: a form that writes but cannot read leaves
    // "edit" with nothing to offer but a text box.
    for (const fn of FORMABLE_FUNCTIONS) {
      const slots = argumentSlots(fn.name)!;
      const args: Argument[] = Array.from({ length: slots.variadic ? 2 : slots.count }, (_, i) =>
        i === 0
          ? at('steps.refund.output.body.items', {
              filter: { field: 'tag', op: '=' as const, value: 'fee' },
              field: 'amount',
            })
          : fixedFor(fn, i),
      );

      const written = writeComputation({ kind: 'call', fn: fn.name, args });
      expect(written, fn.name).not.toBeNull();
      const back = readCall(written!);
      expect(back.fn, fn.name).toBe(fn.name);
      expect(writeComputation(back), fn.name).toBe(written);
    }
  });
});

const RIDE = {
  fareBreakup: [
    { description: 'BASE_FARE', amount: { amount: 36, currency: 'INR' } },
    { description: 'Waiting Charges', amount: { amount: 0, currency: 'INR' } },
    { description: 'Cancellation Charges', amount: { amount: 55, currency: 'INR' } },
  ],
};

const RIDE_LISTS = new Set(['trigger.fareBreakup']);
const rideIsList = (path: string) => RIDE_LISTS.has(path);

/** What a customer would actually be shown, from the expression a form wrote. */
async function render(computation: ListFormat, data: unknown = { trigger: RIDE }) {
  const written = writeComputation(computation);
  expect(written).not.toBeNull();
  return (await compileExpression(written!).evaluate(data)) as unknown;
}

describe('writeComputation — every item as one piece of text', () => {
  const breakdown: ListFormat = {
    kind: 'list',
    source: { path: 'trigger.fareBreakup' },
    template: '{{description}} = {{amount.amount}}',
    separator: '\n',
  };

  it('renders the breakdown the requirement asked for', async () => {
    expect(await render(breakdown)).toBe(
      'BASE_FARE = 36\nWaiting Charges = 0\nCancellation Charges = 55',
    );
  });

  it('takes whatever markup the channel wants, which is the point of a template', async () => {
    expect(
      await render({ ...breakdown, template: '*{{description}}* — ₹{{amount.amount}}' }),
    ).toBe('*BASE_FARE* — ₹36\n*Waiting Charges* — ₹0\n*Cancellation Charges* — ₹55');
    expect(
      await render({ ...breakdown, template: '<li><b>{{description}}</b>: {{amount.amount}}</li>' }),
    ).toContain('<li><b>BASE_FARE</b>: 36</li>');
  });

  it('is mostly ordinary text, with no placeholder required at all', async () => {
    expect(await render({ ...breakdown, template: 'a charge', separator: ', ' })).toBe(
      'a charge, a charge, a charge',
    );
  });

  it('says several fields on one line, which no fixed shape could', async () => {
    expect(
      await render({
        ...breakdown,
        template: '{{description}}: {{amount.amount}} {{amount.currency}}',
      }),
    ).toBe('BASE_FARE: 36 INR\nWaiting Charges: 0 INR\nCancellation Charges: 55 INR');
  });

  it('mixes a value from outside the list into every line', async () => {
    const data = { trigger: { ...RIDE, rideId: 'R-7' } };
    expect(
      await render({ ...breakdown, template: '{{trigger.rideId}} {{description}}' }, data),
    ).toBe('R-7 BASE_FARE\nR-7 Waiting Charges\nR-7 Cancellation Charges');
  });

  it('narrows to the items that matter', async () => {
    const only = {
      ...breakdown,
      source: {
        path: 'trigger.fareBreakup',
        filter: { field: 'amount.amount', op: '>' as const, value: '0' },
      },
    };
    expect(await render(only)).toBe('BASE_FARE = 36\nCancellation Charges = 55');
  });

  it('says something rather than nothing when the list is empty', async () => {
    const guarded = { ...breakdown, empty: 'No charges.' };
    expect(await render(guarded, { trigger: { fareBreakup: [] } })).toBe('No charges.');
    // And a missing field is an empty list too, which is the case that bites.
    expect(await render(guarded, { trigger: {} })).toBe('No charges.');
    expect(await render(guarded)).toContain('BASE_FARE = 36');
  });

  it('renders nothing at all without the guard, which is why the guard exists', async () => {
    expect(await render(breakdown, { trigger: { fareBreakup: [] } })).toBeUndefined();
  });

  it('survives a quote, a backslash and a brace in the literal text', async () => {
    expect(
      await render({ ...breakdown, template: 'say "{{description}}" \\ {x}', separator: ' | ' }),
    ).toContain('say "BASE_FARE" \\ {x}');
  });

  it('refuses to write something incomplete', () => {
    expect(writeComputation({ ...breakdown, template: '' })).toBeNull();
    expect(writeComputation({ ...breakdown, source: { path: '' } })).toBeNull();
    // Braces around nothing but space name no field, and could not be read back
    // as the literal text they are not.
    expect(writeComputation({ ...breakdown, template: 'a {{ }} b' })).toBeNull();
  });

  it('keeps writing while a placeholder is still being typed', async () => {
    // Typing `{{` is how the picker is opened, so the moment after it the text
    // holds an empty pair of braces. Refusing there would blank the preview
    // mid-keystroke; it is text until it names something.
    expect(await render({ ...breakdown, template: 'a {{}} b', separator: ' | ' })).toBe(
      'a {{}} b | a {{}} b | a {{}} b',
    );
  });
});

describe('readComputation — the list shape', () => {
  /** Read something this wrote as a list, failing loudly if it came back otherwise. */
  function readList(source: string): ListFormat {
    const back = readComputation(toExpressionValue(source), rideIsList);
    if (back?.kind !== 'list') throw new Error(`read as ${back?.kind ?? 'nothing'}: ${source}`);
    return back;
  }

  it('round-trips every variation, which is what makes "edit" possible', () => {
    const variations: ListFormat[] = [
      {
        kind: 'list',
        source: { path: 'trigger.fareBreakup' },
        template: '{{description}} = {{amount.amount}}',
        separator: '\n',
      },
      {
        kind: 'list',
        source: {
          path: 'trigger.fareBreakup',
          filter: { field: 'amount.amount', op: '>', value: '0', type: 'number' },
        },
        template: '*{{description}}* — ₹{{amount.amount}} {{amount.currency}}',
        separator: ', ',
        empty: 'Nothing to show',
      },
      // No placeholders at all.
      { kind: 'list', source: { path: 'trigger.fareBreakup' }, template: 'one', separator: ' | ' },
      // Nothing but a placeholder.
      {
        kind: 'list',
        source: { path: 'trigger.fareBreakup' },
        template: '{{description}}',
        separator: '\n',
      },
      // An outer value beside an item's.
      {
        kind: 'list',
        source: { path: 'trigger.fareBreakup' },
        template: '{{trigger.rideId}}: {{description}}',
        separator: '\n',
      },
      // Text with a quote in it.
      {
        kind: 'list',
        source: { path: 'trigger.fareBreakup' },
        template: 'say "{{description}}"',
        separator: '\n',
      },
    ];

    for (const computation of variations) {
      const written = writeComputation(computation);
      expect(written, JSON.stringify(computation)).not.toBeNull();
      expect(readList(written!)).toEqual(computation);
      expect(writeComputation(readList(written!))).toBe(written);
    }
  });

  it('is not confused by the call shape, and does not confuse it', () => {
    const sum = readComputation(
      toExpressionValue('$sum([trigger.fareBreakup.amount.amount])'),
      rideIsList,
    );
    expect(sum?.kind).toBe('call');
    const joined = readComputation(
      toExpressionValue('$join([trigger.fareBreakup.description], ", ")'),
      rideIsList,
    );
    expect(joined?.kind).toBe('call');
  });

  it('gives up on a hand-written list this could not have produced', () => {
    for (const source of [
      // A value transformed on the way out — not something a template can say.
      '$join($map(trigger.fareBreakup, function($i){ $uppercase($i.description) }), "\\n")',
      // A different parameter name — read back it would show the wrong fields.
      '$join($map(trigger.fareBreakup, function($x){ $string($x.description) }), "\\n")',
      // A computed separator.
      '$join($map(trigger.fareBreakup, function($i){ $string($i.description) }), trigger.sep)',
      // A guard testing something else.
      '$count(trigger.fareBreakup) = 1 ? "one" : $join($map(trigger.fareBreakup, function($i){ $string($i.description) }), "\\n")',
      // Literal text that would read back as a placeholder it never was.
      '$join($map(trigger.fareBreakup, function($i){ "{{x}}" }), "\\n")',
    ]) {
      expect(readComputation(toExpressionValue(source), rideIsList), source).toBeNull();
    }
  });
});

describe('every operation, written and run and read back', () => {
  const DATA = {
    nums: [1, 2, 3],
    words: ['a', 'b'],
    objs: [{ a: 1 }, { b: 2 }],
    obj: { a: 1 },
    n: 7.25,
    s: 'Hello World',
    numeric: '42',
    flag: true,
  };
  const lists = new Set(['nums', 'words', 'objs']);

  /**
   * Where a parameter declares nothing useful — `$number`'s `(nsb)` union, or a
   * bare `x` — the test has to know what the function is actually for. Only
   * these; everything else is chosen from the signature.
   */
  const FIRST: Record<string, string> = {
    $number: 'numeric',
    $keys: 'obj',
    $lookup: 'obj',
  };

  const argFor = (fn: ExpressionFunction, i: number): Argument => {
    const want = wantsAt(fn.name, i);
    const kind = baseKind(want);
    if (takesSeveral(fn.name, i)) {
      const element = baseKind(elementType(want));
      return at(element === 'string' ? 'words' : element === 'object' ? 'objs' : 'nums');
    }
    if (kind === 'number') return i === 0 ? at('n') : fixed('2');
    if (kind === 'string') return i === 0 ? at('s') : fixed('l');
    if (kind === 'boolean') return i === 0 ? at('flag') : fixed('true');
    if (kind === 'object') return at('obj');
    return i === 0 ? at(FIRST[fn.name] ?? 's') : fixed('a');
  };

  it.each(FORMABLE_FUNCTIONS.map((fn) => [fn.name, fn] as const))(
    '%s writes, runs and reads back',
    async (_name, fn) => {
      const slots = argumentSlots(fn.name)!;
      const args = Array.from({ length: slots.count }, (_, i) => argFor(fn, i));

      const source = writeComputation({ kind: 'call', fn: fn.name, args });
      expect(source, `${fn.name} wrote nothing`).not.toBeNull();

      // It has to be something JSONata will actually run — the whole class of
      // bug this replaced was expressions that looked fine and were T0410s.
      await expect(
        compileExpression(source!).evaluate(DATA),
        `${fn.name}: ${source!}`,
      ).resolves.not.toThrow;

      const back = readComputation(toExpressionValue(source!), (p) => lists.has(p));
      expect(back, `${fn.name} did not read back`).not.toBeNull();
      expect(writeComputation(back!), `${fn.name} did not survive the round trip`).toBe(source);
    },
  );

  it('offers arithmetic, which JSONata has no function for', () => {
    for (const name of ['add', 'subtract', 'multiply', 'divide', 'remainder']) {
      expect(FORMABLE_FUNCTIONS.some((fn) => fn.name === name), name).toBe(true);
    }
  });

  it('offers no control for a parameter that wants a function', () => {
    // `$sort` is `<af?:a>`. One control, and the comparator left off.
    expect(argumentSlots('$sort')).toEqual({ count: 1 });
    // `$filter` needs one, so it is not offered at all.
    expect(argumentSlots('$filter')).toBeNull();
  });
});

describe('a filter spells its value as the field, not as it looks', () => {
  const count = (filter: ItemFilter) =>
    writeComputation({
      kind: 'call',
      fn: '$count',
      args: [{ kind: 'value', path: 'trigger.items', filter }],
    });

  it('quotes a numeric-looking value tested against a text field', async () => {
    // The bug this closes: `[code = 10]` against `"10"` is false, silently, and
    // the author sees a filter that matches nothing with nothing to explain it.
    const src = count({ field: 'code', op: '=', value: '10', type: 'string' })!;
    expect(src).toBe('$count(trigger.items[code = "10"])');
    const data = { trigger: { items: [{ code: '10' }, { code: '20' }, { code: '10' }] } };
    await expect(compileExpression(src).evaluate(data)).resolves.toBe(2);
  });

  it('leaves a number bare where the field really is a number', () => {
    expect(count({ field: 'amount', op: '>', value: '10', type: 'number' })).toBe(
      '$count(trigger.items[amount > 10])',
    );
  });

  it('falls back to the value’s own shape when nothing declares the field', () => {
    // All anyone can do: a comparison needs *some* spelling, and a schema that
    // says nothing cannot choose one.
    expect(count({ field: 'amount', op: '>', value: '10' })).toBe(
      '$count(trigger.items[amount > 10])',
    );
  });

  it('reads the spelling back as the type, so re-saving does not change it', () => {
    for (const type of ['string', 'number'] as const) {
      const src = count({ field: 'code', op: '=', value: '10', type })!;
      const back = readComputation(toExpressionValue(src), (p) => p === 'trigger.items');
      expect(writeComputation(back!), type).toBe(src);
    }
  });
});
