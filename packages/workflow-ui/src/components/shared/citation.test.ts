import { describe, it, expect } from 'vitest';
import { citeAt, citationsAt, unwrapResponse, unwrapResponseSchema } from './citation.js';

const cite = (ref: string) => ({ kind: 'ref' as const, ref });

describe('citeAt', () => {
  it('descends by key and index', () => {
    expect(citeAt({ total: [cite('a')] }, 'total')).toEqual([cite('a')]);
    expect(citeAt([[cite('a')]], 0)).toEqual([cite('a')]);
  });

  it('is undefined-safe all the way down', () => {
    expect(citeAt(undefined, 'total')).toBeUndefined();
    expect(citeAt('scalar', 'total')).toBeUndefined();
    expect(citeAt({}, 'missing')).toBeUndefined();
  });
});

describe('citationsAt', () => {
  const map = {
    response: {
      total: [cite('steps.ocr.output.results.0.data')],
      lineItems: [{ amount: [cite('steps.ocr.output.results.1.data')] }],
    },
  };

  it('finds a leaf by its path', () => {
    expect(citationsAt(map, ['response', 'total'])).toHaveLength(1);
  });

  it('finds a leaf nested under an array', () => {
    expect(citationsAt(map, ['response', 'lineItems', 0, 'amount'])).toHaveLength(1);
  });

  // A branch is not a leaf — a value must not inherit its children's sources.
  it('returns nothing for a branch node', () => {
    expect(citationsAt(map, ['response', 'lineItems'])).toEqual([]);
    expect(citationsAt(map, ['response'])).toEqual([]);
  });

  it('returns nothing for a missing path', () => {
    expect(citationsAt(map, ['response', 'nope'])).toEqual([]);
    expect(citationsAt(undefined, ['x'])).toEqual([]);
  });
});

describe('unwrapResponse', () => {
  it('hoists value back into response and aligns the mirror to it', () => {
    const out = unwrapResponse({
      response: { value: { total: '5000' }, citation: { total: [cite('steps.ocr.output.results.0.data')] } },
      attachments: [],
      usage: { inputTokens: 1, outputTokens: 2 },
    });

    expect(out.data['response']).toEqual({ total: '5000' });
    // Sibling agent fields survive the unwrap.
    expect(out.data['usage']).toEqual({ inputTokens: 1, outputTokens: 2 });
    // Mirror is keyed like the data, so one walk indexes both.
    expect(citationsAt(out.citation, ['response', 'total'])).toHaveLength(1);
  });

  // Every non-cited output must pass through untouched — the renderers call this
  // unconditionally.
  it('passes an uncited agent output through', () => {
    const output = { response: 'plain text', attachments: [] };
    const out = unwrapResponse(output);
    expect(out.data).toBe(output);
    expect(out.citation).toBeUndefined();
  });

  it('passes a non-agent step output through', () => {
    const output = { results: [{ name: 'a.pdf' }] };
    expect(unwrapResponse(output).data).toBe(output);
  });

  it('handles undefined output', () => {
    expect(unwrapResponse(undefined).data).toEqual({});
  });
});

describe('unwrapResponseSchema', () => {
  const userSchema = { type: 'object', properties: { total: { type: 'string' } } };
  const citedSchema = {
    type: 'object',
    properties: {
      response: { type: 'object', properties: { value: userSchema, citation: { type: 'object' } } },
      attachments: { type: 'array' },
    },
  };
  const citedOutput = { response: { value: { total: '5000' }, citation: {} } };

  // The schema has to move with the data: describing `response` as {value,citation}
  // while the data shows the value itself would drop the panel to a JSON dump.
  it('hoists the value schema to match the unwrapped data', () => {
    const out = unwrapResponseSchema(citedSchema, citedOutput);
    expect((out!['properties'] as Record<string, unknown>)['response']).toEqual(userSchema);
  });

  it('leaves the schema alone for uncited output', () => {
    const plain = { response: 'text' };
    expect(unwrapResponseSchema(citedSchema, plain)).toBe(citedSchema);
  });

  it('tolerates a missing schema', () => {
    expect(unwrapResponseSchema(undefined, citedOutput)).toBeUndefined();
  });
});
