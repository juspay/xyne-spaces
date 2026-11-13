/**
 * What a declared shape says you can quote, and what it says about a list.
 */
import { describe, it, expect } from 'vitest';
import { declaredFields } from './calls.js';

const object = (properties: Record<string, unknown>) => ({ type: 'object', properties });

describe('declaredFields', () => {
  it('reads the leaves as dotted paths, with their types', () => {
    expect(
      declaredFields(
        object({
          status: { type: 'string' },
          customer: object({ tier: { type: 'string' }, age: { type: 'number' } }),
        }),
      ),
    ).toEqual([
      { path: 'status', type: 'string' },
      { path: 'customer.tier', type: 'string' },
      { path: 'customer.age', type: 'number' },
    ]);
  });

  it('describes the items of a list of objects, without making them quotable', () => {
    const fields = declaredFields(
      object({
        items: {
          type: 'array',
          items: object({ tag: { type: 'string' }, amount: { type: 'number' } }),
        },
      }),
    );

    expect(fields).toEqual([
      {
        path: 'items',
        type: 'array',
        itemFields: [
          { path: 'tag', type: 'string' },
          { path: 'amount', type: 'number' },
        ],
      },
    ]);
    // The list is still one leaf: nothing may point at a single element, so no
    // path gains an `items` step.
    expect(fields.map((f) => f.path)).toEqual(['items']);
  });

  it('says nothing about the items of a list of plain values', () => {
    const [field] = declaredFields(
      object({ tags: { type: 'array', items: { type: 'string' } } }),
    );
    expect(field).toEqual({ path: 'tags', type: 'array' });
    expect(field).not.toHaveProperty('itemFields');
  });

  it('says nothing about a list whose items were never declared', () => {
    const [field] = declaredFields(object({ rows: { type: 'array' } }));
    expect(field).toEqual({ path: 'rows', type: 'array' });
  });

  it('leaves everything that is not a list alone', () => {
    for (const field of declaredFields(
      object({ a: { type: 'string' }, b: { type: 'number' }, c: { type: 'boolean' } }),
    )) {
      expect(field).not.toHaveProperty('itemFields');
    }
  });

  it('finds a list nested inside an object', () => {
    const fields = declaredFields(
      object({
        refund: object({
          charges: { type: 'array', items: object({ amount: { type: 'number' } }) },
        }),
      }),
    );
    expect(fields).toEqual([
      {
        path: 'refund.charges',
        type: 'array',
        itemFields: [{ path: 'amount', type: 'number' }],
      },
    ]);
  });

  it('describes an item that is itself shaped', () => {
    const [field] = declaredFields(
      object({
        lines: { type: 'array', items: object({ product: object({ sku: { type: 'string' } }) }) },
      }),
    );
    expect(field?.itemFields).toEqual([{ path: 'product.sku', type: 'string' }]);
  });
});
