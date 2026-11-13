import { describe, it, expect } from 'vitest';
import { classifyResponse, declaredSchema, schemaProblem } from './contract.js';

describe('classifyResponse — holding JSON to the declared schema', () => {
  const schema = {
    type: 'object',
    properties: {
      screen: { type: 'string', enum: ['start', 'payments'] },
      reason: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['screen', 'reason'],
  };

  it('accepts a response that fits', () => {
    expect(classifyResponse('{"screen":"start","reason":"hi"}', true, schema)).toEqual({ ok: true });
    expect(classifyResponse('```json\n{"screen":"payments","reason":"x","tags":["a"]}\n```', true, schema)).toEqual({ ok: true });
  });

  it('names the first problem, in words the model can act on', () => {
    expect(classifyResponse('{"screen":"billing","reason":"x"}', true, schema))
      .toEqual({ ok: false, reason: 'mismatch', error: 'screen must be one of: start, payments (got "billing")' });
    expect(classifyResponse('{"screen":"start"}', true, schema))
      .toEqual({ ok: false, reason: 'mismatch', error: 'reason is required' });
    expect(classifyResponse('{"screen":"start","reason":3}', true, schema))
      .toEqual({ ok: false, reason: 'mismatch', error: 'reason must be a string (got number 3)' });
    expect(classifyResponse('{"screen":"start","reason":"x","tags":[1]}', true, schema))
      .toEqual({ ok: false, reason: 'mismatch', error: 'tags[0] must be a string (got number 1)' });
    expect(classifyResponse('["start"]', true, schema))
      .toEqual({ ok: false, reason: 'mismatch', error: 'the response must be an object (got an array)' });
  });

  it('keeps the old behaviour without a schema', () => {
    expect(classifyResponse('{"anything":true}', true)).toEqual({ ok: true });
    expect(classifyResponse('nope', true, schema)).toMatchObject({ ok: false, reason: 'unparseable' });
    expect(classifyResponse('', true, schema)).toEqual({ ok: false, reason: 'empty' });
    expect(classifyResponse('free text', false, schema)).toEqual({ ok: true });
  });

  it('is permissive about schema keywords it does not check', () => {
    expect(schemaProblem({ a: 1 }, { type: 'object', additionalProperties: false, minProperties: 5 }, '')).toBeNull();
  });
});

describe('declaredSchema', () => {
  it('reads an object or JSON text, only for JSON output', () => {
    expect(declaredSchema('json', { type: 'object' })).toEqual({ type: 'object' });
    expect(declaredSchema('json', '{"type":"object"}')).toEqual({ type: 'object' });
    expect(declaredSchema('string', { type: 'object' })).toBeUndefined();
    expect(declaredSchema('json', {})).toBeUndefined();
    expect(declaredSchema('json', '{{steps.x.output}}')).toBeUndefined();
    expect(declaredSchema('json', '[1]')).toBeUndefined();
  });
});
