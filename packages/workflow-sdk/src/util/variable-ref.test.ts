import { describe, it, expect } from 'vitest';
import {
  VARIABLE_REF_REGEX,
  tokenize,
  isPureRef,
  extractRefPath,
  collectRefs,
  parseRef,
  findStepsReferencing,
} from './variable-ref.js';
import type { WorkflowConfig } from '../types/workflow-config.js';

// ─── VARIABLE_REF_REGEX ───

describe('VARIABLE_REF_REGEX', () => {
  it('matches a simple ref', () => {
    expect(VARIABLE_REF_REGEX.test('{{trigger.x}}')).toBe(true);
  });

  it('matches a ref with context. prefix', () => {
    expect(VARIABLE_REF_REGEX.test('{{context.trigger.x}}')).toBe(true);
  });

  it('matches deeply nested paths', () => {
    expect(VARIABLE_REF_REGEX.test('{{steps.step1.output.a.b.c}}')).toBe(true);
  });

  it('rejects plain strings', () => {
    expect(VARIABLE_REF_REGEX.test('hello')).toBe(false);
  });

  it('rejects partial ref (text before)', () => {
    expect(VARIABLE_REF_REGEX.test('prefix {{trigger.x}}')).toBe(false);
  });

  it('rejects partial ref (text after)', () => {
    expect(VARIABLE_REF_REGEX.test('{{trigger.x}} suffix')).toBe(false);
  });

  it('rejects empty braces', () => {
    expect(VARIABLE_REF_REGEX.test('{{}}')).toBe(false);
  });

  it('rejects single braces', () => {
    expect(VARIABLE_REF_REGEX.test('{trigger.x}')).toBe(false);
  });
});

// ─── tokenize ───

describe('tokenize', () => {
  it('returns a single literal for plain text', () => {
    expect(tokenize('hello world')).toEqual([
      { kind: 'literal', text: 'hello world' },
    ]);
  });

  it('returns a single ref for a pure reference', () => {
    expect(tokenize('{{trigger.x}}')).toEqual([
      { kind: 'ref', path: 'trigger.x', raw: '{{trigger.x}}' },
    ]);
  });

  it('strips context. prefix from the path', () => {
    expect(tokenize('{{context.trigger.x}}')).toEqual([
      { kind: 'ref', path: 'trigger.x', raw: '{{context.trigger.x}}' },
    ]);
  });

  it('handles mixed literal + ref + literal', () => {
    expect(tokenize('Hi {{trigger.user.name}}!')).toEqual([
      { kind: 'literal', text: 'Hi ' },
      {
        kind: 'ref',
        path: 'trigger.user.name',
        raw: '{{trigger.user.name}}',
      },
      { kind: 'literal', text: '!' },
    ]);
  });

  it('handles multiple refs', () => {
    const result = tokenize('{{a.b}} and {{c.d}}');
    expect(result).toEqual([
      { kind: 'ref', path: 'a.b', raw: '{{a.b}}' },
      { kind: 'literal', text: ' and ' },
      { kind: 'ref', path: 'c.d', raw: '{{c.d}}' },
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles consecutive refs with no separator', () => {
    expect(tokenize('{{a.b}}{{c.d}}')).toEqual([
      { kind: 'ref', path: 'a.b', raw: '{{a.b}}' },
      { kind: 'ref', path: 'c.d', raw: '{{c.d}}' },
    ]);
  });
});

// ─── isPureRef ───

describe('isPureRef', () => {
  it('returns true for pure ref', () => {
    expect(isPureRef('{{trigger.x}}')).toBe(true);
  });

  it('returns true for ref with context prefix', () => {
    expect(isPureRef('{{context.trigger.x}}')).toBe(true);
  });

  it('returns false for mixed content', () => {
    expect(isPureRef('prefix {{trigger.x}}')).toBe(false);
  });

  it('returns false for plain string', () => {
    expect(isPureRef('hello')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPureRef('')).toBe(false);
  });
});

// ─── extractRefPath ───

describe('extractRefPath', () => {
  it('extracts path from pure ref', () => {
    expect(extractRefPath('{{trigger.x}}')).toBe('trigger.x');
  });

  it('extracts path from ref with context prefix', () => {
    expect(extractRefPath('{{context.steps.s1.output}}')).toBe(
      'steps.s1.output',
    );
  });

  it('returns null for non-ref', () => {
    expect(extractRefPath('hello')).toBeNull();
  });

  it('returns null for mixed content', () => {
    expect(extractRefPath('hi {{trigger.x}}')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractRefPath('')).toBeNull();
  });
});

// ─── collectRefs ───

describe('collectRefs', () => {
  it('collects refs from a flat string', () => {
    const result = collectRefs('{{trigger.id}}', 'root');
    expect(result).toEqual([{ refPath: 'trigger.id', location: 'root' }]);
  });

  it('collects multiple refs from one string', () => {
    const result = collectRefs('{{a.b}} and {{c.d}}', 'field');
    expect(result).toEqual([
      { refPath: 'a.b', location: 'field' },
      { refPath: 'c.d', location: 'field' },
    ]);
  });

  it('collects refs from nested objects', () => {
    const result = collectRefs(
      { to: '{{trigger.user}}', body: 'static' },
      'config',
    );
    expect(result).toEqual([
      { refPath: 'trigger.user', location: 'config.to' },
    ]);
  });

  it('collects refs from arrays', () => {
    const result = collectRefs(['{{a.b}}', 'static', '{{c.d}}'], 'items');
    expect(result).toEqual([
      { refPath: 'a.b', location: 'items[0]' },
      { refPath: 'c.d', location: 'items[2]' },
    ]);
  });

  it('collects refs from deeply nested structures', () => {
    const result = collectRefs(
      {
        outer: {
          inner: ['{{deep.ref}}'],
        },
      },
      '',
    );
    expect(result).toEqual([
      { refPath: 'deep.ref', location: 'outer.inner[0]' },
    ]);
  });

  it('returns empty array for no refs', () => {
    expect(collectRefs({ a: 'hello', b: 42 }, 'root')).toEqual([]);
  });

  it('returns empty array for null/undefined/number values', () => {
    expect(collectRefs(null, 'root')).toEqual([]);
    expect(collectRefs(undefined, 'root')).toEqual([]);
    expect(collectRefs(42, 'root')).toEqual([]);
  });

  it('strips context. prefix from collected ref paths', () => {
    const result = collectRefs('{{context.trigger.id}}', 'field');
    expect(result).toEqual([{ refPath: 'trigger.id', location: 'field' }]);
  });
});

describe('findStepsReferencing', () => {
  const config: WorkflowConfig = {
    trigger: { type: 'MANUAL', config: {} },
    steps: [
      { id: 'fetch', type: 'CODE', config: { code: 'return 1' } },
      { id: 'summarize', type: 'CODE', config: { input: '{{fetch.output.text}}' } },
      { id: 'notify', type: 'CODE', config: { msg: 'Hi {{steps.fetch.output.id}}!' } },
      { id: 'unrelated', type: 'CODE', config: { x: '{{trigger.foo}}' } },
      {
        id: 'cond',
        type: 'CONDITIONAL',
        config: {
          condition: {},
          if_true: [
            { id: 'nested', type: 'CODE', config: { v: '{{fetch.output.score}}' } },
          ],
        },
      },
    ],
  };

  it('finds direct + shorthand + steps-prefixed + nested referrers, excluding self', () => {
    const refs = findStepsReferencing(config, 'fetch').sort();
    expect(refs).toEqual(['nested', 'notify', 'summarize']);
  });

  it('returns [] when nothing references the step', () => {
    expect(findStepsReferencing(config, 'notify')).toEqual([]);
  });

  it('does not blame a container for its child’s refs', () => {
    // `cond` itself has no ref to fetch — only its nested child does.
    expect(findStepsReferencing(config, 'fetch')).not.toContain('cond');
  });
});

// ─── parseRef ───

describe('parseRef', () => {
  it('parses steps.<id>.<path>', () => {
    expect(parseRef('steps.npci_reg.output.body.status')).toEqual({
      source: 'step',
      stepId: 'npci_reg',
      path: 'output.body.status',
    });
  });

  it('parses bare-shorthand <id>.<path> as a step ref', () => {
    expect(parseRef('fetch.output.text')).toEqual({
      source: 'step',
      stepId: 'fetch',
      path: 'output.text',
    });
  });

  it('parses trigger.<path>', () => {
    expect(parseRef('trigger.rrn')).toEqual({ source: 'trigger', path: 'rrn' });
  });

  it('parses workflow.<path>', () => {
    expect(parseRef('workflow.id')).toEqual({ source: 'workflow', path: 'id' });
  });

  it('parses execution.<path>', () => {
    expect(parseRef('execution.id')).toEqual({ source: 'execution', path: 'id' });
  });

  it('handles a bare step id with no sub-path', () => {
    expect(parseRef('fetch')).toEqual({ source: 'step', stepId: 'fetch', path: undefined });
  });

  it('handles trigger with no sub-path', () => {
    expect(parseRef('trigger')).toEqual({ source: 'trigger', path: undefined });
  });

  it('handles steps with stepId but no sub-path', () => {
    expect(parseRef('steps.fetch')).toEqual({ source: 'step', stepId: 'fetch', path: undefined });
  });

  it('agrees with the shorthand/steps/trigger cases findStepsReferencing relies on', () => {
    // bare shorthand and steps-prefixed both target the same step
    expect(parseRef('fetch.output.x').stepId).toBe('fetch');
    expect(parseRef('steps.fetch.output.x').stepId).toBe('fetch');
    // trigger refs are not step refs
    expect(parseRef('trigger.foo').source).toBe('trigger');
  });
});
