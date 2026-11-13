/**
 * The catalogue holds metadata; its types come from JSONata. These guard the
 * join between the two.
 */
import { describe, it, expect } from 'vitest';
import { EXPRESSION_FUNCTIONS, expressionFunction, takesOf } from './catalogue.js';
import { isBuiltin, builtinSignature } from './signatures.js';
import { parseSignature } from './signature.js';
import { assignableToField, sayType } from './types.js';
import { compileExpression, inspectExpression } from './parse.js';
import {
  argumentSlots,
  type Argument,
} from './form/model.js';
import { writeComputation } from './form/write.js';

describe('every offered function', () => {
  it('is a real JSONata builtin, or an operator that says so', () => {
    // A curated *name* that is not a builtin would be offered and then refused.
    // The arithmetic entries are not names at all — JSONata spells them `a * b`
    // — so they are identified by carrying an operator, and must not pretend to
    // be functions by taking a `$`.
    for (const fn of EXPRESSION_FUNCTIONS) {
      if (fn.infix !== undefined) {
        expect(fn.name.startsWith('$'), fn.name).toBe(false);
        expect(isBuiltin(fn.name), fn.name).toBe(false);
        continue;
      }
      expect(isBuiltin(fn.name), fn.name).toBe(true);
    }
  });

  it('carries the signature JSONata declares, or its own where there is none', () => {
    for (const fn of EXPRESSION_FUNCTIONS) {
      // An operator's `declared` is only consulted because the language has
      // nothing to say about it; a builtin may never override its own.
      const definition = builtinSignature(fn.name) ?? fn.declared;
      expect(definition, fn.name).toBeDefined();
      if (fn.infix === undefined) expect(fn.declared, fn.name).toBeUndefined();
      expect(fn.signature, fn.name).toEqual(parseSignature(definition!));
      // Never the unchecked fallback.
      expect(fn.signature.params.length > 0 || fn.signature.returns !== 'unknown', fn.name).toBe(
        true,
      );
    }
  });

  it('has a template that parses and is allowed', () => {
    for (const fn of EXPRESSION_FUNCTIONS) {
      const source = fn.template.replaceAll('…', 'steps.a.output.items');
      expect(inspectExpression(source), `${fn.name}: ${source}`).toBeNull();
    }
  });

  it('never ships a placeholder in a template as a finished answer', () => {
    // The template is the text editor's, where an author types over `"old"`.
    // A form builds the call from the signature instead — this is the property
    // that was quietly broken when it filled the template in and shipped
    // `$replace(x, "old", "new")` as something complete.
    for (const fn of EXPRESSION_FUNCTIONS) {
      const slots = argumentSlots(fn.name);
      if (slots === null) continue;
      const args: Argument[] = Array.from({ length: slots.count }, () => ({
        kind: 'fixed',
        raw: '',
      }));
      const written = writeComputation({ kind: 'call', fn: fn.name, args });
      // Everything blank cannot produce a call at all, let alone one with
      // "old" in it.
      expect(written, fn.name).toBeNull();
    }
  });

  it('has unique names, sigilled unless it is an operator, and is findable', () => {
    const names = EXPRESSION_FUNCTIONS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const fn of EXPRESSION_FUNCTIONS) {
      expect(fn.name.startsWith('$'), fn.name).toBe(fn.infix === undefined);
    }
    expect(expressionFunction('sum')).toBe(expressionFunction('$sum'));
    expect(expressionFunction('multiply')?.infix).toBe('*');
    expect(expressionFunction('$nope')).toBeUndefined();
  });
});

describe('`offer` may narrow a menu but never contradict the checker', () => {
  it('is always something the checker would accept for that kind of field', () => {
    // The guarantee that makes an editorial hint safe: wherever an entry is
    // offered, the result its signature declares can actually be bound there.
    // So a wrong `offer` hides a function from a list; it can never cause a
    // correct expression to be refused.
    for (const fn of EXPRESSION_FUNCTIONS) {
      if (fn.offer === 'unknown') continue;
      expect(
        assignableToField(fn.signature.returns, fn.offer),
        `${fn.name}: offered for ${fn.offer}, signature gives ${sayType(fn.signature.returns)}`,
      ).toBe(true);
    }
  });

  it('narrows where JSONata declares nothing', () => {
    // `$filter` is `<af>` — no declared return at all. The signature cannot say
    // where it belongs, so the catalogue does.
    const filter = expressionFunction('$filter')!;
    expect(filter.signature.returns).toBe('unknown');
    expect(filter.offer).toBe('array');
  });
});

describe('takesOf', () => {
  it('reads the first parameter, with its element type', () => {
    expect(takesOf(expressionFunction('$sum')!)).toEqual({ array: 'number' });
    expect(takesOf(expressionFunction('$join')!)).toEqual({ array: 'string' });
    expect(takesOf(expressionFunction('$round')!)).toBe('number');
    expect(takesOf(expressionFunction('$uppercase')!)).toBe('string');
  });

  it('reports the genuinely permissive ones as unknown', () => {
    // These were hand-written as object/array and refused valid input.
    expect(takesOf(expressionFunction('$keys')!)).toBe('unknown');
    expect(takesOf(expressionFunction('$distinct')!)).toBe('unknown');
    expect(takesOf(expressionFunction('$append')!)).toBe('unknown');
  });
});

describe('the arithmetic entries, which state their own signature', () => {
  /**
   * These are the one place a type is *claimed* rather than taken from the
   * language — JSONata publishes no signature for an operator — and hand-written
   * types are exactly what went wrong before: `$keys`, `$distinct` and `$append`
   * were all declared too narrowly and refused correct expressions, which is why
   * the rest of the table is generated.
   *
   * So the claim is checked against the language instead of trusted. Each entry
   * says `<nn:n>`; each of these proves the operator really does take two
   * numbers, really does give a number, and really does refuse text.
   */
  const ARITHMETIC = EXPRESSION_FUNCTIONS.filter((fn) => fn.infix !== undefined);

  it('covers the operators a form offers, and only those', () => {
    expect(ARITHMETIC.map((fn) => fn.infix)).toEqual(['+', '-', '*', '/', '%']);
  });

  it.each(ARITHMETIC.map((fn) => [fn.name, fn] as const))(
    '%s takes two numbers and gives a number, as it declares',
    async (_name, fn) => {
      expect(fn.declared).toBe('<nn:n>');
      expect(fn.signature.params.map((p) => p.type)).toEqual(['number', 'number']);
      expect(fn.signature.returns).toBe('number');

      const value = await compileExpression(`7 ${fn.infix!} 2`).evaluate({});
      expect(typeof value, fn.name).toBe('number');
    },
  );

  it.each(ARITHMETIC.map((fn) => [fn.name, fn] as const))(
    '%s refuses text, so declaring it numeric is not a guess',
    async (_name, fn) => {
      await expect(
        compileExpression(`"a" ${fn.infix!} 2`).evaluate({}),
        fn.name,
      ).rejects.toMatchObject({ code: 'T2001' });
    },
  );
});
