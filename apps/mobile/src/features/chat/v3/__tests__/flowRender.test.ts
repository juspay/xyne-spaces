import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  flowStyleToNativeStyle,
  parseColorFromBorder,
  parseCssLength,
  parseCssSpacing,
} from '../rows/parts/flowStyle';
import {
  getControlOptions,
  getControlValueFromState,
  getStateValue,
  getStringProp,
  isDisabled,
  isVisible,
  stripMarkdownSyntax,
} from '../rows/parts/flowState';

/**
 * Characterisation tests locking the v3 Flow-JSON pure helpers to v2 behaviour.
 * These cover the parsing/evaluation logic that the interactive renderer relies
 * on, so the port cannot silently drift from the v2 conversation-composer.
 */
describe('flowStyle.parseCssLength', () => {
  it('passes finite numbers through', () => {
    assert.equal(parseCssLength(12), 12);
    assert.equal(parseCssLength(Number.NaN), undefined);
  });

  it('parses px and unitless as numbers', () => {
    assert.equal(parseCssLength('24px'), 24);
    assert.equal(parseCssLength('8'), 8);
  });

  it('converts rem/em to px at 16px base', () => {
    assert.equal(parseCssLength('2rem'), 32);
    assert.equal(parseCssLength('1.5em'), 24);
  });

  it('keeps percentages as string dimensions', () => {
    assert.equal(parseCssLength('50%'), '50%');
  });

  it('rejects garbage', () => {
    assert.equal(parseCssLength('auto'), undefined);
    assert.equal(parseCssLength({}), undefined);
  });
});

describe('flowStyle.parseCssSpacing', () => {
  it('wraps a single number', () => {
    assert.deepEqual(parseCssSpacing(4), [4]);
  });
  it('splits 1-4 token shorthand', () => {
    assert.deepEqual(parseCssSpacing('4px 8px'), [4, 8]);
    assert.deepEqual(parseCssSpacing('1px 2px 3px 4px'), [1, 2, 3, 4]);
  });
  it('rejects >4 tokens or percentages', () => {
    assert.equal(parseCssSpacing('1px 2px 3px 4px 5px'), undefined);
    assert.equal(parseCssSpacing('50%'), undefined);
  });
});

describe('flowStyle.parseColorFromBorder', () => {
  it('extracts hex / rgb / hsl token from a border shorthand', () => {
    assert.equal(parseColorFromBorder('1px solid #abcdef'), '#abcdef');
    assert.equal(parseColorFromBorder('2px dashed rgb(0,0,0)'), 'rgb(0,0,0)');
    assert.equal(parseColorFromBorder('1px solid'), undefined);
  });
});

describe('flowStyle.flowStyleToNativeStyle', () => {
  it('maps border, borderLeft, align, gap and % width', () => {
    const s = flowStyleToNativeStyle({
      border: '1px solid #123456',
      borderLeft: '3px solid #654321',
      align: 'center',
      gap: '8px',
      width: '80%',
      backgroundColor: '#fff',
    });
    assert.equal(s.borderWidth, 1);
    assert.equal(s.borderColor, '#123456');
    assert.equal(s.borderLeftWidth, 3);
    assert.equal(s.borderLeftColor, '#654321');
    assert.equal(s.alignItems, 'center');
    assert.equal(s.gap, 8);
    assert.equal(s.width, '80%');
    assert.equal(s.backgroundColor, '#fff');
  });

  it('drops pixel widths (web canvas overflow guard) but keeps maxWidth', () => {
    const s = flowStyleToNativeStyle({ width: '400px', maxWidth: '100px' });
    assert.equal(s.width, undefined);
    assert.equal(s.maxWidth, 100);
  });

  it('never copies web-only overflow / maxHeight', () => {
    const s = flowStyleToNativeStyle({ maxHeight: '280px', overflow: 'auto' } as Record<
      string,
      unknown
    >);
    assert.equal((s as Record<string, unknown>)['maxHeight'], undefined);
    assert.equal((s as Record<string, unknown>)['overflow'], undefined);
  });

  it('returns {} for undefined style', () => {
    assert.deepEqual(flowStyleToNativeStyle(undefined), {});
  });
});

describe('flowState.getStateValue', () => {
  it('resolves dotted paths and strips a leading values. prefix', () => {
    const values = { a: { b: { c: 7 } }, flag: true };
    assert.equal(getStateValue(values, 'a.b.c'), 7);
    assert.equal(getStateValue(values, 'values.flag'), true);
    assert.equal(getStateValue(values, 'a.missing.x'), undefined);
  });
});

describe('flowState.isVisible / isDisabled', () => {
  it('treats undefined hidden as visible', () => {
    assert.equal(isVisible({ type: 'text' } as never, {}), true);
  });
  it('honours boolean hidden', () => {
    assert.equal(isVisible({ type: 'text', hidden: true } as never, {}), false);
  });
  it('evaluates hidden expressions, preserving the v2 no-negation quirk', () => {
    // NOTE: v2 boolean branch is !hidden, but the STRING branch returns
    // !!getStateValue(...) with no negation -- a truthy `hidden` expression still
    // reports visible. The v3 port preserves this for parity (do not "fix" here).
    assert.equal(isVisible({ type: 'text', hidden: 'flag' } as never, { flag: true }), true);
    assert.equal(isVisible({ type: 'text', hidden: '!flag' } as never, { flag: true }), false);
  });
  it('evaluates disabled expressions and boolean', () => {
    assert.equal(isDisabled({ type: 'button', disabled: true } as never, {}), true);
    assert.equal(isDisabled({ type: 'button', disabled: 'busy' } as never, { busy: 1 }), true);
    assert.equal(isDisabled({ type: 'button', disabled: '!busy' } as never, { busy: 1 }), false);
  });
});

describe('flowState.getControlValueFromState', () => {
  it('prefers state value, joining arrays, falling back to props', () => {
    assert.equal(getControlValueFromState({ name: 'x' }, { x: 'hi' }), 'hi');
    assert.equal(getControlValueFromState({ name: 'x' }, { x: ['a', 'b'] }), 'a, b');
    assert.equal(getControlValueFromState({ name: 'x' }, { x: 3 }), '3');
    assert.equal(getControlValueFromState({ name: 'x', defaultValue: 'd' }, {}), 'd');
  });
});

describe('flowState.getControlOptions', () => {
  it('reads inline option objects', () => {
    const opts = getControlOptions(
      { options: [{ label: 'One', value: '1' }, { label: 'Two' }] },
      {},
    );
    assert.deepEqual(opts, [
      { label: 'One', value: '1' },
      { label: 'Two', value: 'Two' },
    ]);
  });
  it('resolves a $data reference', () => {
    const opts = getControlOptions(
      { options: '$choices' },
      { choices: [{ label: 'A', value: 'a' }] },
    );
    assert.deepEqual(opts, [{ label: 'A', value: 'a' }]);
  });
  it('returns [] for non-array options', () => {
    assert.deepEqual(getControlOptions({ options: 5 }, {}), []);
  });
});

describe('flowState misc', () => {
  it('getStringProp trims strings and rejects non-strings', () => {
    assert.equal(getStringProp({ a: '  x ' }, 'a'), 'x');
    assert.equal(getStringProp({ a: 5 }, 'a'), '');
  });
  it('stripMarkdownSyntax unwraps links and drops emphasis marks', () => {
    assert.equal(stripMarkdownSyntax('[Go](https://x.io)'), 'Go');
    assert.equal(stripMarkdownSyntax('*bold* _it_ `c` ~s~'), 'bold it c s');
  });
});
