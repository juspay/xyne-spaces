import { describe, it, expect } from 'vitest';
import {
  detectBranchesFromConfig,
  setAtPath,
  getAtPath,
  isStepConfigArray,
  generateConfigDefaults,
  walkStepConfigs,
} from './branch-detection.js';

// ─── Schemas matching SDK builtin steps ───

const stepArraySchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, type: { type: 'string' } },
  },
};

const conditionalSchema = {
  type: 'object',
  properties: {
    condition: { type: 'object' },
    if_true: stepArraySchema,
    if_false: stepArraySchema,
  },
};

const parallelSchema = {
  type: 'object',
  properties: {
    branches: {
      type: 'object',
      additionalProperties: stepArraySchema,
    },
  },
};

const loopSchema = {
  type: 'object',
  properties: { body: stepArraySchema },
};

const switchSchema = {
  type: 'object',
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          condition: { type: 'object' },
          label: { type: 'string' },
          steps: stepArraySchema,
        },
      },
    },
    default: stepArraySchema,
  },
};

// ─── Tests ───

describe('isStepConfigArray', () => {
  it('returns true for an array of objects with id+type', () => {
    expect(isStepConfigArray([{ id: 'a', type: 'CODE' }])).toBe(true);
  });
  it('returns false for empty array', () => {
    expect(isStepConfigArray([])).toBe(false);
  });
  it('returns false for non-array', () => {
    expect(isStepConfigArray('xyz')).toBe(false);
  });
  it('returns false when first element lacks id or type', () => {
    expect(isStepConfigArray([{ id: 'a' }])).toBe(false);
    expect(isStepConfigArray([{ type: 'CODE' }])).toBe(false);
  });
});

describe('detectBranchesFromConfig — LOOP', () => {
  it('detects a direct step array (body)', () => {
    const branches = detectBranchesFromConfig(
      { body: [{ id: 's1', type: 'CODE', config: {} }], maxIterations: 100 },
      loopSchema,
    );
    expect(Object.keys(branches)).toEqual(['body']);
    expect(branches['body']!.steps).toHaveLength(1);
    expect(branches['body']!.label).toBe('body');
  });

  it('detects an empty body via schema', () => {
    const branches = detectBranchesFromConfig({ body: [] }, loopSchema);
    expect(branches['body']!.steps).toEqual([]);
    expect(branches['body']!.label).toBe('body');
  });
});

describe('detectBranchesFromConfig — CONDITIONAL', () => {
  it('detects if_true + if_false as separate branches', () => {
    const branches = detectBranchesFromConfig(
      {
        condition: {},
        if_true: [{ id: 't', type: 'CODE', config: {} }],
        if_false: [{ id: 'f', type: 'CODE', config: {} }],
      },
      conditionalSchema,
    );
    expect(Object.keys(branches).sort()).toEqual(['if_false', 'if_true']);
    expect(branches['if_true']!.label).toBe('if_true');
    expect(branches['if_false']!.label).toBe('if_false');
  });
});

describe('detectBranchesFromConfig — PARALLEL', () => {
  it('detects record-of-arrays', () => {
    const branches = detectBranchesFromConfig(
      {
        branches: {
          'A': [{ id: 'a1', type: 'CODE', config: {} }],
          'B': [{ id: 'b1', type: 'CODE', config: {} }],
        },
      },
      parallelSchema,
    );
    expect(Object.keys(branches).sort()).toEqual(['branches.A', 'branches.B']);
    expect(branches['branches.A']!.label).toBe('A');
    expect(branches['branches.B']!.label).toBe('B');
  });

  it('detects empty dynamic branches via schema', () => {
    const branches = detectBranchesFromConfig(
      { branches: { 'A': [], 'B': [] } },
      parallelSchema,
    );
    expect(branches['branches.A']!.steps).toEqual([]);
    expect(branches['branches.B']!.steps).toEqual([]);
  });
});

describe('detectBranchesFromConfig — SWITCH', () => {
  it('detects each case as a positional branch and the default branch', () => {
    const branches = detectBranchesFromConfig(
      {
        cases: [
          {
            condition: {},
            label: 'High value',
            steps: [{ id: 'hv', type: 'CODE', config: {} }],
          },
          {
            condition: {},
            steps: [{ id: 'rf', type: 'CODE', config: {} }],
          },
        ],
        default: [{ id: 'std', type: 'CODE', config: {} }],
      },
      switchSchema,
    );

    expect(Object.keys(branches).sort()).toEqual([
      'cases.0.steps',
      'cases.1.steps',
      'default',
    ]);
    expect(branches['cases.0.steps']!.label).toBe('High value');
    expect(branches['cases.1.steps']!.label).toBe('Case 2');
    expect(branches['default']!.label).toBe('default');
  });

  it('handles empty cases array — default still detected', () => {
    const branches = detectBranchesFromConfig(
      { cases: [], default: [{ id: 'd', type: 'CODE', config: {} }] },
      switchSchema,
    );
    expect(Object.keys(branches)).toEqual(['default']);
    expect(branches['default']!.steps).toHaveLength(1);
  });

  it('handles cases with empty steps[] (case present, no steps yet)', () => {
    const branches = detectBranchesFromConfig(
      {
        cases: [
          { condition: {}, label: 'NewCase', steps: [] },
        ],
        default: [],
      },
      switchSchema,
    );
    expect(branches['cases.0.steps']!.steps).toEqual([]);
    expect(branches['cases.0.steps']!.label).toBe('NewCase');
  });

  it('falls back to Case N+1 when label is missing or empty', () => {
    const branches = detectBranchesFromConfig(
      {
        cases: [
          { condition: {}, steps: [{ id: 'x', type: 'CODE', config: {} }] },
          { condition: {}, label: '', steps: [{ id: 'y', type: 'CODE', config: {} }] },
        ],
        default: [],
      },
      switchSchema,
    );
    expect(branches['cases.0.steps']!.label).toBe('Case 1');
    expect(branches['cases.1.steps']!.label).toBe('Case 2');
  });

  it('does not require schema to detect cases — but without it array-of-cases is invisible', () => {
    // Without schema the detector can't distinguish cases from any other
    // array-of-objects, so it leaves the array alone. default still works
    // because it's a direct step array.
    const branches = detectBranchesFromConfig(
      {
        cases: [{ condition: {}, steps: [{ id: 'x', type: 'CODE' }] }],
        default: [{ id: 'd', type: 'CODE' }],
      },
      undefined, // no schema
    );
    expect(Object.keys(branches)).toEqual(['default']);
  });
});

describe('setAtPath / getAtPath', () => {
  it('set + get with a single key', () => {
    const obj = setAtPath({ a: 1 }, 'b', 2);
    expect(obj).toEqual({ a: 1, b: 2 });
    expect(getAtPath(obj, 'b')).toBe(2);
  });

  it('set + get with a two-segment path (object.object)', () => {
    const obj = setAtPath({ branches: { A: [1] } }, 'branches.B', [2]);
    expect(obj).toEqual({ branches: { A: [1], B: [2] } });
    expect(getAtPath(obj, 'branches.A')).toEqual([1]);
    expect(getAtPath(obj, 'branches.B')).toEqual([2]);
  });

  it('set + get with a multi-segment path including a numeric array index', () => {
    const start = {
      cases: [
        { label: 'A', steps: [] },
        { label: 'B', steps: [] },
      ],
      default: [],
    };
    const updated = setAtPath(start, 'cases.1.steps', [{ id: 's', type: 'CODE' }]);
    expect(getAtPath(updated, 'cases.1.steps')).toEqual([{ id: 's', type: 'CODE' }]);
    // Other branches preserved
    expect(getAtPath(updated, 'cases.0.label')).toBe('A');
    // Original not mutated
    expect((start.cases[1] as { steps: unknown[] }).steps).toEqual([]);
  });

  it('creates missing intermediate objects/arrays based on next segment', () => {
    const obj = setAtPath({} as Record<string, unknown>, 'cases.0.steps', ['s1']);
    expect(obj).toEqual({ cases: [{ steps: ['s1'] }] });
  });

  it('returns undefined for missing path segments in getAtPath', () => {
    expect(getAtPath({ a: { b: 1 } }, 'a.x.y')).toBeUndefined();
    expect(getAtPath({ a: [1, 2] }, 'a.5')).toBeUndefined();
  });

  it('immutability — setAtPath does not mutate input', () => {
    const start = { branches: { A: [{ id: 'a', type: 'CODE' }] } };
    const updated = setAtPath(start, 'branches.A', []);
    expect(start.branches.A).toHaveLength(1);
    expect((updated as typeof start).branches.A).toEqual([]);
  });
});

describe('walkStepConfigs (schema-free discovery)', () => {
  it('visits every step in a flat list', () => {
    const visited: string[] = [];
    walkStepConfigs(
      [
        { id: 'a', type: 'CODE', config: {} },
        { id: 'b', type: 'HTTP_REQUEST', config: {} },
      ],
      (s) => visited.push(s.type),
    );
    expect(visited).toEqual(['CODE', 'HTTP_REQUEST']);
  });

  it('recurses into LOOP body without needing a schema', () => {
    const visited: string[] = [];
    walkStepConfigs(
      [{
        id: 'loop_1',
        type: 'LOOP',
        config: { body: [{ id: 'a', type: 'CODE', config: {} }] },
      }],
      (s) => visited.push(s.type),
    );
    expect(visited).toEqual(['LOOP', 'CODE']);
  });

  it('recurses into PARALLEL branches (record of arrays) without a schema', () => {
    const visited: string[] = [];
    walkStepConfigs(
      [{
        id: 'p',
        type: 'PARALLEL',
        config: {
          branches: {
            A: [{ id: 'a', type: 'CODE', config: {} }],
            B: [{ id: 'b', type: 'HTTP_REQUEST', config: {} }],
          },
        },
      }],
      (s) => visited.push(s.type),
    );
    expect(visited.sort()).toEqual(['CODE', 'HTTP_REQUEST', 'PARALLEL']);
  });

  it('recurses into SWITCH cases[i].steps without a schema', () => {
    const visited: string[] = [];
    walkStepConfigs(
      [{
        id: 'sw',
        type: 'SWITCH',
        config: {
          cases: [
            { condition: {}, label: 'C1', steps: [{ id: 'x', type: 'PARALLEL', config: {} }] },
            { condition: {}, label: 'C2', steps: [{ id: 'y', type: 'CODE', config: {} }] },
          ],
          default: [{ id: 'd', type: 'HTTP_REQUEST', config: {} }],
        },
      }],
      (s) => visited.push(s.type),
    );
    // The regression: PARALLEL inside SWITCH must be discovered.
    expect(visited.sort()).toEqual(['CODE', 'HTTP_REQUEST', 'PARALLEL', 'SWITCH']);
  });

  it('recurses through SWITCH → PARALLEL → CODE without schemas', () => {
    const visited: string[] = [];
    walkStepConfigs(
      [{
        id: 'sw',
        type: 'SWITCH',
        config: {
          cases: [{
            condition: {},
            label: 'C1',
            steps: [{
              id: 'par',
              type: 'PARALLEL',
              config: {
                branches: {
                  A: [{ id: 'inner', type: 'CODE', config: {} }],
                },
              },
            }],
          }],
          default: [],
        },
      }],
      (s) => visited.push(s.type),
    );
    expect(visited.sort()).toEqual(['CODE', 'PARALLEL', 'SWITCH']);
  });
});

describe('generateConfigDefaults', () => {
  it('seeds dynamic-branch container with two branches (PARALLEL)', () => {
    const defaults = generateConfigDefaults(parallelSchema);
    expect(defaults['branches']).toEqual({ 'Branch 1': [], 'Branch 2': [] });
  });

  it('seeds direct step arrays as []', () => {
    const defaults = generateConfigDefaults(loopSchema);
    expect(defaults['body']).toEqual([]);
  });

  it('seeds SWITCH defaults: cases=[] (array), default=[] (array)', () => {
    const defaults = generateConfigDefaults(switchSchema);
    expect(defaults['cases']).toEqual([]);
    expect(defaults['default']).toEqual([]);
  });

  it('uses schema "default" property when present', () => {
    const schema = {
      type: 'object',
      properties: { maxIterations: { type: 'number', default: 1000 } },
    };
    expect(generateConfigDefaults(schema)).toEqual({ maxIterations: 1000 });
  });
});
