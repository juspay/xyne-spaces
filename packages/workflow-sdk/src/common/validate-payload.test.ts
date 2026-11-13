import { describe, it, expect } from 'vitest';
import { validateTriggerPayload } from './validate-payload.js';

const att = (over: Partial<{ name: string; mimeType: string; handle: string; size: number }> = {}) => ({
  name: 'f.pdf',
  mimeType: 'application/pdf',
  handle: 'mem://1',
  ...over,
});

describe('validateTriggerPayload', () => {
  it('returns no errors when there is no schema', () => {
    expect(validateTriggerPayload(undefined, { anything: 1 })).toEqual([]);
    expect(validateTriggerPayload({}, { anything: 1 })).toEqual([]);
  });

  it('does not constrain ordinary scalar fields', () => {
    const schema = { type: 'object', properties: { topic: { type: 'string' } } };
    expect(validateTriggerPayload(schema, {})).toEqual([]);
    expect(validateTriggerPayload(schema, { topic: 'x' })).toEqual([]);
  });

  it('flags a missing required field', () => {
    const schema = {
      type: 'object',
      properties: { pan: { type: 'object', format: 'attachment' } },
      required: ['pan'],
    };
    const errs = validateTriggerPayload(schema, {});
    expect(errs).toHaveLength(1);
    expect(errs[0]!.path).toBe('pan');
    expect(errs[0]!.message).toMatch(/required/);
  });

  it('passes when a required attachment is present and valid', () => {
    const schema = {
      type: 'object',
      properties: { pan: { type: 'object', format: 'attachment' } },
      required: ['pan'],
    };
    expect(validateTriggerPayload(schema, { pan: att() })).toEqual([]);
  });

  it('rejects a non-attachment value in an attachment field', () => {
    const schema = { type: 'object', properties: { pan: { type: 'object', format: 'attachment' } } };
    const errs = validateTriggerPayload(schema, { pan: { not: 'a file' } });
    expect(errs[0]!.message).toMatch(/must be a file/);
  });

  it('enforces accept (mime) with wildcard support', () => {
    const schema = {
      type: 'object',
      properties: { pan: { type: 'object', format: 'attachment', accept: ['image/*', 'application/pdf'] } },
    };
    expect(validateTriggerPayload(schema, { pan: att({ mimeType: 'image/png' }) })).toEqual([]);
    expect(validateTriggerPayload(schema, { pan: att({ mimeType: 'application/pdf' }) })).toEqual([]);
    const errs = validateTriggerPayload(schema, { pan: att({ mimeType: 'text/csv', name: 'd.csv' }) });
    expect(errs[0]!.message).toMatch(/not an accepted type/);
  });

  it('enforces maxSize', () => {
    const schema = {
      type: 'object',
      properties: { pan: { type: 'object', format: 'attachment', maxSize: 100 } },
    };
    const errs = validateTriggerPayload(schema, { pan: att({ size: 500 }) });
    expect(errs[0]!.message).toMatch(/exceeds the max size/);
  });

  it('enforces minItems / maxItems on a multiple field', () => {
    const schema = {
      type: 'object',
      properties: {
        financials: {
          type: 'array',
          items: { type: 'object', format: 'attachment' },
          minItems: 1,
          maxItems: 2,
        },
      },
    };
    expect(validateTriggerPayload(schema, { financials: [att(), att()] })).toEqual([]);
    expect(validateTriggerPayload(schema, { financials: [] })[0]!.message).toMatch(/at least 1 file/);
    expect(validateTriggerPayload(schema, { financials: [att(), att(), att()] })[0]!.message).toMatch(/at most 2 file/);
  });

  it('validates accept/maxSize per item in a multiple field', () => {
    const schema = {
      type: 'object',
      properties: {
        financials: {
          type: 'array',
          items: { type: 'object', format: 'attachment', accept: ['application/pdf'] },
        },
      },
    };
    const errs = validateTriggerPayload(schema, {
      financials: [att(), att({ mimeType: 'image/png', name: 'x.png' })],
    });
    expect(errs[0]!.message).toMatch(/not an accepted type/);
  });

  it('rejects a non-array value for a multiple field', () => {
    const schema = {
      type: 'object',
      properties: { financials: { type: 'array', items: { type: 'object', format: 'attachment' } } },
    };
    expect(validateTriggerPayload(schema, { financials: att() })[0]!.message).toMatch(/must be a list of files/);
  });
});
