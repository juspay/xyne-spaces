import { describe, it, expect } from 'vitest';
import {
  compileExpression,
  clearExpressionCache,
  inspectExpression,
  refsInExpression,
} from './parse.js';
import {
  EXPRESSION_REGEX,
  REF_OR_EXPRESSION_REGEX,
  isExpression,
  hasExpression,
  extractExpressionSource,
  tokenizeExpressions,
  toExpressionValue,
  collectExpressions,
} from './format.js';
import { EXPRESSION_FUNCTIONS } from './catalogue.js';
import { collectRefs, tokenize } from '../util/variable-ref.js';

// ─── Wire format ───

describe('EXPRESSION_REGEX / isExpression', () => {
  it('matches a pure expression', () => {
    expect(isExpression('{% $sum(steps.a.output.x) %}')).toBe(true);
    expect(EXPRESSION_REGEX.test('{%1%}')).toBe(true);
  });

  it('rejects an expression with surrounding text', () => {
    expect(isExpression('Total: {% 1 %}')).toBe(false);
    expect(isExpression('{% 1 %} total')).toBe(false);
  });

  it('rejects a variable ref', () => {
    expect(isExpression('{{steps.a.output.x}}')).toBe(false);
  });

  it('matches across newlines', () => {
    expect(isExpression('{%\n  $sum(steps.a.output.x)\n%}')).toBe(true);
  });
});

describe('hasExpression', () => {
  it('finds an expression anywhere in the string', () => {
    expect(hasExpression('Total: {% 1 %} today')).toBe(true);
    expect(hasExpression('{% 1 %}')).toBe(true);
  });

  it('is false for plain text and for refs', () => {
    expect(hasExpression('hello')).toBe(false);
    expect(hasExpression('{{steps.a.output.x}}')).toBe(false);
    expect(hasExpression('100% done')).toBe(false);
  });

  it('gives the same answer when asked repeatedly', () => {
    // Regression: a global regex advances `lastIndex` on `.test()`, so sharing
    // one with the tokenizer made the answer depend on the previous call.
    const value = '{% 1 %}';
    expect([hasExpression(value), hasExpression(value), hasExpression(value)]).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe('extractExpressionSource', () => {
  it('returns the trimmed source', () => {
    expect(extractExpressionSource('{%  $sum(a)  %}')).toBe('$sum(a)');
  });

  it('returns null when not a pure expression', () => {
    expect(extractExpressionSource('x {% 1 %}')).toBeNull();
  });
});

describe('tokenizeExpressions', () => {
  it('returns one literal for plain text', () => {
    expect(tokenizeExpressions('hello')).toEqual([{ kind: 'literal', text: 'hello' }]);
  });

  it('splits literal and expression segments', () => {
    expect(tokenizeExpressions('Total: {% $sum(a) %}!')).toEqual([
      { kind: 'literal', text: 'Total: ' },
      { kind: 'expression', source: '$sum(a)', raw: '{% $sum(a) %}' },
      { kind: 'literal', text: '!' },
    ]);
  });

  it('keeps two expressions separate rather than spanning the middle', () => {
    const tokens = tokenizeExpressions('{% 1 %} and {% 2 %}');
    expect(tokens.filter((t) => t.kind === 'expression')).toHaveLength(2);
    expect(tokens).toContainEqual({ kind: 'literal', text: ' and ' });
  });

  it('leaves variable refs inside literal text', () => {
    expect(tokenizeExpressions('{{steps.a.output.x}}')).toEqual([
      { kind: 'literal', text: '{{steps.a.output.x}}' },
    ]);
  });
});

describe('toExpressionValue', () => {
  it('round-trips with extractExpressionSource', () => {
    expect(extractExpressionSource(toExpressionValue('  $sum(a) '))).toBe('$sum(a)');
  });
});

describe('REF_OR_EXPRESSION_REGEX', () => {
  it('accepts either grammar, and nothing else', () => {
    expect(REF_OR_EXPRESSION_REGEX.test('{{trigger.x}}')).toBe(true);
    expect(REF_OR_EXPRESSION_REGEX.test('{{context.trigger.x}}')).toBe(true);
    expect(REF_OR_EXPRESSION_REGEX.test('{% $sum(trigger.x) %}')).toBe(true);
    expect(REF_OR_EXPRESSION_REGEX.test('plain')).toBe(false);
    expect(REF_OR_EXPRESSION_REGEX.test('Total {% 1 %}')).toBe(false);
    expect(REF_OR_EXPRESSION_REGEX.test('Hi {{trigger.x}}')).toBe(false);
  });
});

describe('the two grammars do not see each other', () => {
  it('tokenize ignores an expression', () => {
    expect(tokenize('{% $sum(a) %}').every((t) => t.kind === 'literal')).toBe(true);
  });

  it('collectRefs finds nothing in an expression', () => {
    expect(collectRefs({ amount: '{% $sum(steps.a.output.items.amount) %}' }, '')).toEqual([]);
  });

  it('collectExpressions finds nothing in a ref', () => {
    expect(collectExpressions({ amount: '{{steps.a.output.total}}' }, '')).toEqual([]);
  });
});

// ─── Safety ───

describe('inspectExpression — what may run', () => {
  it('allows the operations this exists for', () => {
    for (const source of [
      '$sum(steps.a.output.items.amount)',
      '$sum([steps.a.output.x, steps.b.output.y, steps.c.output.z])',
      'steps.a.output.items[tag = "fee"].amount',
      '$filter(steps.a.output.items, function($i){ $i.amount > 10 })',
      '$round($sum(steps.a.output.x) / $count(steps.a.output.x), 2)',
      '($total := $sum(steps.a.output.x); $total * 1.18)',
      '$uppercase(trigger.context.tier) & " " & vars.label',
    ]) {
      expect(inspectExpression(source), source).toBeNull();
    }
  });

  it('refuses every route to recursion', () => {
    // A lambda is allowed only as a direct call argument. Each of these puts one
    // somewhere else, which is the only way to give a function a name to call.
    for (const source of [
      '($f := function($n){ $f($n + 1) }; $f(0))',
      'function($f){ $f($f) }(function($f){ $f($f) })',
      'function($f){ $f($f) } ~> function($g){ $g($g) }',
      '($fs := [function($n){ $n }]; $fs[0](0))',
      '($o := {"f": function($n){ $n }}; $o.f(0))',
    ]) {
      expect(inspectExpression(source)?.kind, source).toBe('namedFunction');
    }
  });

  it('refuses $eval however it is reached', () => {
    for (const source of ['$eval("1+1")', '($g := $eval; $g("1+1"))', '$map([1], $eval)']) {
      expect(inspectExpression(source)?.kind, source).toBe('eval');
    }
  });

  it('refuses a name JSONata does not have', () => {
    // Was skipped on the belief that the builtins could not be enumerated.
    for (const source of ['$summ(a)', '$nope(1)', '$uppercse("x")']) {
      expect(inspectExpression(source)?.kind, source).toBe('unknownFunction');
    }
  });

  it('accepts a real builtin outside the curated catalogue', () => {
    for (const source of [
      '$substringBefore(trigger.x, "@")',
      '$sqrt(trigger.n)',
      '$formatNumber(trigger.n, "#,##0.00")',
      '$zip([1], [2])',
    ]) {
      expect(inspectExpression(source), source).toBeNull();
    }
  });

  it('reports a named function before a name that only looks unknown', () => {
    // `$f(0)` is an unknown name only because naming the function is banned.
    // The ban is the useful complaint.
    expect(inspectExpression('($f := function($n){ $n }; $f(0))')?.kind).toBe('namedFunction');
  });

  it('reports a syntax error with a position', () => {
    const fault = inspectExpression('$sum(steps.a.output.x');
    expect(fault?.kind).toBe('syntax');
    expect(fault?.position).toBeGreaterThan(0);
    expect(fault?.message).toBeTruthy();
  });

  it('cannot reach the host', () => {
    // The guarantee that makes an inline engine acceptable: names resolve
    // against the data, not any JS scope. Kept as a test so an engine upgrade
    // that changed it would fail here rather than in production.
    for (const source of [
      'process',
      'process.env',
      'globalThis',
      'require',
      'steps.constructor',
      'steps.__proto__',
    ]) {
      expect(inspectExpression(source), source).toBeNull(); // parses, but…
    }
  });
});

describe('EXPRESSION_FUNCTIONS', () => {
  it('offers a template that parses and is allowed', () => {
    // Catches a typo in a template before it reaches an author's editor.
    for (const fn of EXPRESSION_FUNCTIONS) {
      const source = fn.template.replaceAll('…', 'steps.a.output.items');
      expect(inspectExpression(source), `${fn.name}: ${source}`).toBeNull();
    }
  });

  it('has unique names, sigilled unless the entry is an operator', () => {
    const names = EXPRESSION_FUNCTIONS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const fn of EXPRESSION_FUNCTIONS) {
      expect(fn.name.startsWith('$'), fn.name).toBe(fn.infix === undefined);
    }
  });
});

// ─── References inside an expression ───

describe('refsInExpression', () => {
  it('finds paths rooted at a context root', () => {
    expect(refsInExpression('$sum(steps.a.output.items.amount)')).toEqual([
      'steps.a.output.items.amount',
    ]);
    expect(refsInExpression('trigger.context.orderId & vars.label')).toEqual([
      'trigger.context.orderId',
      'vars.label',
    ]);
  });

  it('finds every ref in an n-ary expression, once each', () => {
    expect(
      refsInExpression('$sum([steps.a.output.x, steps.b.output.y, steps.a.output.x])'),
    ).toEqual(['steps.a.output.x', 'steps.b.output.y']);
  });

  it('ignores a path relative to the item under test', () => {
    // `tag` is a field of each item, not a step called "tag".
    expect(refsInExpression('steps.a.output.items[tag = "fee"].amount')).toEqual([
      'steps.a.output.items.amount',
    ]);
  });

  it('ignores a lambda parameter', () => {
    expect(
      refsInExpression('$filter(steps.a.output.items, function($i){ $i.amount > 10 })'),
    ).toEqual(['steps.a.output.items']);
  });

  it('ignores a bare leading name, which is not a root', () => {
    // Bare step-id shorthand is deliberately not supported inside an expression.
    expect(refsInExpression('$sum(myStep.output.x)')).toEqual([]);
  });

  it('returns nothing for an expression that does not parse', () => {
    expect(refsInExpression('$sum(')).toEqual([]);
  });
});

// ─── Finding expressions in a config ───

describe('collectExpressions', () => {
  it('reports each expression with its location', () => {
    expect(
      collectExpressions(
        { a: '{% 1 %}', b: { c: ['x', 'Total {% 2 %}'] }, d: 5 },
        'cfg',
      ),
    ).toEqual([
      { source: '1', location: 'cfg.a' },
      { source: '2', location: 'cfg.b.c[1]' },
    ]);
  });

  it('does not descend into a skipped value', () => {
    const branch = [{ id: 's', type: 'T', config: { x: '{% 1 %}' } }];
    expect(collectExpressions({ branch }, '', new Set([branch]))).toEqual([]);
  });
});

// ─── Compilation cache ───

describe('compileExpression', () => {
  it('returns the same compiled expression for the same source', () => {
    clearExpressionCache();
    expect(compileExpression('$sum(a)')).toBe(compileExpression('$sum(a)'));
  });

  it('recompiles after the cache is cleared', () => {
    const first = compileExpression('$count(a)');
    clearExpressionCache();
    expect(compileExpression('$count(a)')).not.toBe(first);
  });

  it('throws on a syntax error', () => {
    expect(() => compileExpression('$sum(')).toThrow();
  });
});
