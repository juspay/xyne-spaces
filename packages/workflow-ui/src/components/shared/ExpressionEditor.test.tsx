/**
 * The editor's two pure decisions: what a field is offered, and where clicking
 * a function leaves the caret.
 */
import { describe, it, expect } from 'vitest';
import {
  EXPRESSION_FUNCTIONS,
  assignableToField,
  kindOfJsonType,
} from '@xyne/workflow-sdk/expression';
import { functionInsertion, functionsFor } from './ExpressionEditor.js';

const names = (type: string | undefined) => functionsFor(type).map((f) => f.name);

describe('functionsFor — a field only offers what it can hold', () => {
  it('offers arithmetic to a number field, and no list operations', () => {
    const offered = names('number');
    expect(offered).toContain('$sum');
    expect(offered).toContain('$count');
    expect(offered).toContain('$round');
    // The point of type-scoping: a list is not a number.
    expect(offered).not.toContain('$filter');
    expect(offered).not.toContain('$keys');
  });

  it('treats integer as number', () => {
    expect(names('integer')).toEqual(names('number'));
  });

  it('offers list operations to an array field, and no arithmetic', () => {
    const offered = names('array');
    expect(offered).toContain('$filter');
    expect(offered).toContain('$sort');
    expect(offered).toContain('$distinct');
    expect(offered).not.toContain('$sum');
    expect(offered).not.toContain('$uppercase');
  });

  it('offers only true/false producers to a boolean field', () => {
    // `kindsCompatible` would allow `$sum` here, because it counts any scalar
    // as bindable into any other. Right for validation, wrong for a menu.
    expect(names('boolean')).toEqual(['$lookup', '$exists', '$contains', '$not']);
  });

  it('offers a function with an unknowable result everywhere', () => {
    for (const type of ['number', 'array', 'boolean', 'object', 'string']) {
      expect(names(type), type).toContain('$lookup');
    }
  });

  it('never offers something the validator would reject', () => {
    // The containment that makes curating safe: the menu may offer less than
    // the engine accepts, never more.
    for (const type of ['string', 'number', 'integer', 'boolean', 'array', 'object', undefined]) {
      const target = kindOfJsonType(type);
      for (const fn of functionsFor(type)) {
        // What the *checker* will do with the result, from JSONata's signature —
        // so the menu can never offer something the validator then refuses.
        expect(
          assignableToField(fn.signature.returns, target),
          `${fn.name} → ${String(type)}`,
        ).toBe(true);
      }
    }
  });

  it('offers everything to a text field', () => {
    // Falls out of `kindsCompatible`, which makes a string the universal sink:
    // any value can be bound into text, so nothing can be ruled out.
    expect(names('string').length).toBeGreaterThan(names('number').length);
    expect(names('string')).toContain('$filter');
    expect(names('string')).toContain('$sum');
  });

  it('offers everything for a type it cannot read, rather than nothing', () => {
    // An unreadable type is a wildcard, so the author gets a full menu instead
    // of a dead end.
    expect(names(undefined)).toEqual(names('string'));
  });
});

describe('functionInsertion — clicking a function leaves you somewhere useful', () => {
  const fn = (name: string) => {
    const found = EXPRESSION_FUNCTIONS.find((f) => f.name === name);
    if (!found) throw new Error(`${name} missing from the catalogue`);
    return found;
  };

  it('puts the caret between the brackets', () => {
    // The dead end this fixes: clicking `$count` used to leave the caret after
    // the closing bracket, with nothing to type and no way to browse.
    expect(functionInsertion(fn('$count'))).toEqual({ text: '$count()', caretBack: 1 });
    expect(functionInsertion(fn('$sum'))).toEqual({ text: '$sum()', caretBack: 1 });
  });

  it('keeps the literal arguments and still aims at the first slot', () => {
    expect(functionInsertion(fn('$round'))).toEqual({ text: '$round(, 2)', caretBack: 4 });
    const { text, caretBack } = functionInsertion(fn('$round'));
    // The caret sits immediately after the opening bracket.
    expect(text.length - caretBack).toBe(text.indexOf('(') + 1);
  });

  it('removes every placeholder, not just the first', () => {
    // `replace` would leave a literal `…` in `$append(…, …)`, which is not
    // valid in an expression.
    const { text } = functionInsertion(fn('$append'));
    expect(text).toBe('$append(, )');
    expect(text).not.toContain('…');
  });

  it('leaves nothing behind for any catalogue entry', () => {
    for (const entry of EXPRESSION_FUNCTIONS) {
      const { text, caretBack } = functionInsertion(entry);
      expect(text, entry.name).not.toContain('…');
      expect(caretBack, entry.name).toBeGreaterThanOrEqual(0);
      expect(caretBack, entry.name).toBeLessThanOrEqual(text.length);
    }
  });
});
