/**
 * Reading a pasted response into a schema.
 *
 * The schema is the contract: it decides which fields an author can quote, and
 * — now that expressions read them — what they are. Both were broken, and in
 * ways that only showed on a real payload.
 */
import { describe, it, expect } from 'vitest';
import { declaredFields } from '@xyne/workflow-sdk/conversational-flow';
import { nodeAt, schemaFor, schemaFromSample } from './RequestEditor.js';

describe('schemaFromSample', () => {
  it('describes a list of objects instead of stopping at it', () => {
    // The reported bug: the walk stopped at an array, so nothing inside
    // `fareBreakup` was nameable and a breakdown could not be totalled.
    expect(schemaFromSample({ items: [{ tag: 'fee', amount: 36 }] })).toEqual({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { tag: { type: 'string' }, amount: { type: 'integer' } },
          },
        },
      },
    });
  });

  it('records real types rather than calling everything text', () => {
    expect(schemaFromSample({ a: 'x', b: 7, c: 1.5, d: true })).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'integer' },
        c: { type: 'number' },
        d: { type: 'boolean' },
      },
    });
  });

  it('says nothing about null, and nothing about an empty list', () => {
    const schema = schemaFromSample({ missing: null, empty: [] });
    expect(schema['properties']).toEqual({ missing: {}, empty: { type: 'array' } });
  });

  it('describes a list from its first element', () => {
    // A response whose elements differ is not describable this way, and a union
    // is not something the field list can express.
    const schema = schemaFromSample({ xs: [{ a: 1 }, { b: 2 }] });
    expect(nodeAt(schema, 'xs.a')).toEqual({ type: 'integer' });
    expect(nodeAt(schema, 'xs.b')).toBeUndefined();
  });

  it('goes deep enough for a real payload', () => {
    const schema = schemaFromSample({ bp: [{ price: { value: { amount: 36 } } }] });
    expect(nodeAt(schema, 'bp.price.value.amount')).toEqual({ type: 'integer' });
  });
});

describe('schemaFor — editing the list must not flatten what the sample taught', () => {
  const sampled = schemaFromSample({
    items: [{ tag: 'fee', amount: 36 }],
    status: 'COMPLETED',
    total: 91,
  });
  const shapeOf = (path: string) => nodeAt(sampled, path) ?? {};

  it('keeps a list its items, so its element fields stay offerable', () => {
    const rebuilt = schemaFor(['items', 'total'], shapeOf);
    expect(nodeAt(rebuilt, 'items.amount')).toEqual({ type: 'integer' });
    expect(nodeAt(rebuilt, 'total')).toEqual({ type: 'integer' });
  });

  it('drops a field the author removed', () => {
    const rebuilt = schemaFor(['total'], shapeOf);
    expect(nodeAt(rebuilt, 'items')).toBeUndefined();
  });

  it('leaves a hand-typed field genuinely unknown, not text', () => {
    // Declaring a type nobody verified is what made `$sum` of a number field
    // look like a text error.
    const rebuilt = schemaFor(['somethingNew'], shapeOf);
    expect(nodeAt(rebuilt, 'somethingNew')).toEqual({});
  });
});

describe('the payload this came from', () => {
  const ride = {
    actualFare: 91,
    rideStatus: 'COMPLETED',
    estimateFareBP: [{ price: { value: { amount: 36, currency: 'INR' } }, title: 'BASE_FARE' }],
    fareBreakup: [
      { amount: { amount: 36, amountInt: 36, currency: 'INR' }, description: 'BASE_FARE' },
    ],
    customerDropLocation: { address: { city: 'Bengaluru' }, lat: 12.93 },
  };

  it('offers the fields inside both lists', () => {
    const fields = declaredFields(schemaFromSample(ride));
    const breakup = fields.find((f) => f.path === 'fareBreakup');
    const bp = fields.find((f) => f.path === 'estimateFareBP');

    expect(breakup?.type).toBe('array');
    expect(breakup?.itemFields?.map((f) => `${f.path}:${String(f.type)}`)).toEqual([
      'amount.amount:integer',
      'amount.amountInt:integer',
      'amount.currency:string',
      'description:string',
    ]);
    expect(bp?.itemFields?.map((f) => f.path)).toEqual(['price.value.amount', 'price.value.currency', 'title']);
  });

  it('keeps the scalar fields too, typed', () => {
    const fields = declaredFields(schemaFromSample(ride));
    const by = (path: string) => fields.find((f) => f.path === path);
    expect(by('actualFare')?.type).toBe('integer');
    expect(by('rideStatus')?.type).toBe('string');
    expect(by('customerDropLocation.address.city')?.type).toBe('string');
  });
});
