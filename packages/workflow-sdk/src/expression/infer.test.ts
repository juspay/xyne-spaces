import { describe, it, expect } from 'vitest';
import { inferExpressionType } from './infer.js';
import { EXPRESSION_FUNCTIONS, takesOf } from './catalogue.js';
import type { ExprType } from './types.js';

const TYPES: Record<string, ExprType> = {
  'steps.a.output.amounts': { array: 'number' },
  'steps.a.output.tags': { array: 'string' },
  'steps.a.output.rows': { array: 'object' },
  'steps.a.output.items': { array: 'object' },
  'steps.a.output.count': 'number',
  'steps.a.output.name': 'string',
  'steps.a.output.flag': 'boolean',
  'steps.a.output.obj': 'object',
  'steps.a.output.freeform': 'unknown',
  'trigger.context.tier': 'string',
};
const lookup = (path: string): ExprType | undefined => TYPES[path];
const infer = (src: string) => inferExpressionType(src, lookup);
const typeOf = (src: string) => infer(src).type;
const faultsOf = (src: string) => infer(src).faults.map((f) => f.message);

describe('what an expression produces', () => {
  it('reads a reference through the lookup', () => {
    expect(typeOf('steps.a.output.count')).toBe('number');
    expect(typeOf('steps.a.output.amounts')).toEqual({ array: 'number' });
  });

  it('gives a call its declared result', () => {
    expect(typeOf('$sum(steps.a.output.amounts)')).toBe('number');
    expect(typeOf('$uppercase(steps.a.output.name)')).toBe('string');
    expect(typeOf('$keys(steps.a.output.obj)')).toEqual({ array: 'string' });
    expect(typeOf('$split(steps.a.output.name, ",")')).toEqual({ array: 'string' });
    expect(typeOf('$exists(steps.a.output.name)')).toBe('boolean');
  });

  it('types a list built by hand from its elements', () => {
    expect(typeOf('[steps.a.output.count, 2, 3]')).toEqual({ array: 'number' });
    expect(typeOf('[steps.a.output.name, "x"]')).toEqual({ array: 'string' });
    // Mixed is a list this vocabulary cannot describe, so just "a list".
    expect(typeOf('[steps.a.output.count, steps.a.output.name]')).toBe('array');
  });

  it('types operators', () => {
    expect(typeOf('steps.a.output.count * 2')).toBe('number');
    expect(typeOf('steps.a.output.name & "!"')).toBe('string');
    expect(typeOf('steps.a.output.count > 2')).toBe('boolean');
    expect(typeOf('[1..5]')).toEqual({ array: 'number' });
    // Flattened, as JSONata does: wrapping a list does not nest it.
    expect(typeOf('[steps.a.output.amounts]')).toEqual({ array: 'number' });
    expect(typeOf('[steps.a.output.amounts, steps.a.output.count]')).toEqual({ array: 'number' });
  });

  it('types a block by its last expression, and a condition by both arms', () => {
    expect(typeOf('($t := $sum(steps.a.output.amounts); $t * 2)')).toBe('number');
    expect(typeOf('steps.a.output.flag ? 1 : 2')).toBe('number');
    expect(typeOf('steps.a.output.flag ? 1 : "x"')).toBe('unknown');
  });

  it('follows a pipe into the function on its right', () => {
    expect(typeOf('steps.a.output.amounts ~> $sum()')).toBe('number');
  });

  it('follows a pipe written without brackets, and a chain of them', () => {
    // Regression: `~> $sum` parses the right side as a bare variable rather
    // than a call, so the whole pipeline went unchecked and typed as unknown.
    expect(typeOf('steps.a.output.amounts ~> $sum')).toBe('number');
    expect(typeOf('steps.a.output.amounts ~> $average ~> $round(2)')).toBe('number');
    expect(faultsOf('steps.a.output.amounts ~> $uppercase')).toEqual([
      '$uppercase needs text, but this is list of numbers.',
    ]);
    expect(faultsOf('steps.a.output.name ~> $sum')).toHaveLength(1);
    expect(faultsOf('steps.a.output.amounts ~> $sum ~> $round(2)')).toEqual([]);
  });

  it('nests', () => {
    expect(typeOf('$round($sum(steps.a.output.amounts) / $count(steps.a.output.items), 2)')).toBe('number');
  });
});

describe('what it refuses — the mistakes that used to reach runtime', () => {
  it('catches a list of the wrong element type', () => {
    // T0412 at runtime; now visible while writing.
    expect(faultsOf('$sum(steps.a.output.tags)')).toEqual([
      '$sum needs list of numbers, but this is list of texts.',
    ]);
    expect(faultsOf('$sum(steps.a.output.items)')).toHaveLength(1);
    expect(faultsOf('$join(steps.a.output.amounts, ", ")')).toHaveLength(1);
  });

  it('catches a list where a single value belongs', () => {
    expect(faultsOf('$round(steps.a.output.amounts, 2)')).toHaveLength(1);
  });

  it('allows one number where a list of them is wanted, which JSONata wraps', () => {
    // Not a nicety: a filter matching one item returns the item rather than a
    // list of one, so this is what a correct expression often types as.
    expect(faultsOf('$sum(steps.a.output.count)')).toHaveLength(0);
    // The element type still holds.
    expect(faultsOf('$sum(steps.a.output.name)')).toHaveLength(1);
  });

  it('catches the wrong scalar — which the field rule would have allowed', () => {
    // `kindsCompatible` lets anything into a string *field* because the runtime
    // stringifies. A function parameter gets no such favour: T0410.
    expect(faultsOf('$uppercase(steps.a.output.count)')).toEqual([
      '$uppercase needs text, but this is number.',
    ]);
    expect(faultsOf('$round(steps.a.output.name, 2)')).toHaveLength(1);
  });

  it('does not refuse what JSONata actually allows', () => {
    // These were refused when the types were written by hand. JSONata declares
    // `$keys` as `<x-:a<s>>`, `$distinct` as `<x:x>` and `$append` as `<xx:a>` —
    // all take anything — so refusing them was the checker being wrong.
    expect(faultsOf('$keys(steps.a.output.name)')).toEqual([]);
    expect(faultsOf('$distinct(steps.a.output.name)')).toEqual([]);
    expect(faultsOf('$append(steps.a.output.count, steps.a.output.amounts)')).toEqual([]);
  });

  it('checks arguments past the first', () => {
    // `$replace` takes four. A picker fills the first; the mistake is as likely
    // to be in one of the others.
    expect(faultsOf('$replace(steps.a.output.name, "a", "b", steps.a.output.name)')).toEqual([
      '$replace needs number for argument 4, but this is text.',
    ]);
    expect(faultsOf('$replace(steps.a.output.name, "a", "b", 2)')).toEqual([]);
  });

  it('types every builtin, not only the curated ones', () => {
    // `$substringBefore` is not in the catalogue and is typed all the same,
    // because the signature table covers all of them.
    expect(typeOf('$substringBefore(steps.a.output.name, "@")')).toBe('string');
    expect(faultsOf('$substringBefore(steps.a.output.count, "@")')).toHaveLength(1);
    expect(typeOf('$sqrt(steps.a.output.count)')).toBe('number');
    expect(faultsOf('$sqrt(steps.a.output.name)')).toHaveLength(1);
  });

  it('catches arithmetic on text', () => {
    expect(faultsOf('steps.a.output.name * 2')).toEqual([
      '"*" needs numbers, but one side is text.',
    ]);
    expect(faultsOf('steps.a.output.count + steps.a.output.name')).toHaveLength(1);
  });

  it('reports a fault inside a nested call, not just at the top', () => {
    expect(faultsOf('$round($sum(steps.a.output.tags), 2)')).toHaveLength(1);
  });

  it('carries a position so the editor can point at it', () => {
    const [fault] = infer('$sum(steps.a.output.tags)').faults;
    expect(fault?.position).toBeGreaterThan(0);
  });
});

describe('it is allowed to be silent, never wrong', () => {
  const silent = (src: string) => expect(faultsOf(src), src).toEqual([]);

  it('says nothing about an undeclared reference', () => {
    silent('$sum(steps.a.output.nope)');
    silent('$uppercase(steps.b.output.whatever)');
  });

  it('says nothing about a freeform type', () => {
    silent('$sum(steps.a.output.freeform)');
    silent('$uppercase(steps.a.output.freeform)');
  });

  it('says nothing about a path relative to the item under test', () => {
    // `tag` is a field of each item, not something this lookup knows.
    silent('$sum(steps.a.output.items[tag = "fee"].amount)');
    silent('steps.a.output.items[amount > 10]');
  });

  it('says nothing about a lambda or its parameter', () => {
    silent('$filter(steps.a.output.items, function($i){ $i.amount > 10 })');
    silent('$map(steps.a.output.items, function($i){ $i.amount * 2 })');
  });

  it('says nothing about the arguments of a name it does not know', () => {
    // The name itself is reported by `inspectExpression`; there is nothing to
    // say about what was passed to something that does not exist.
    silent('$whatever(steps.a.output.name)');
  });

  it('says nothing about an expression that does not parse', () => {
    silent('$sum(');
    expect(typeOf('$sum(')).toBe('unknown');
  });

  it('accepts every catalogue template once its slot is filled', () => {
    // The guard against the catalogue itself disagreeing with the checker.
    for (const fn of EXPRESSION_FUNCTIONS) {
      const takes = takesOf(fn);
      const slot =
        typeof takes !== 'string'
          ? takes.array === 'number'
            ? 'steps.a.output.amounts'
            : takes.array === 'string'
              ? 'steps.a.output.tags'
              : takes.array === 'object'
                ? 'steps.a.output.rows'
                : 'steps.a.output.items'
          : takes === 'number'
            ? 'steps.a.output.count'
            : takes === 'string'
              ? 'steps.a.output.name'
              : takes === 'object'
                ? 'steps.a.output.obj'
                : 'steps.a.output.freeform';
      silent(fn.template.replaceAll('…', slot));
    }
  });
});
