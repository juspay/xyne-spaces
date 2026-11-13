import { describe, it, expect } from 'vitest';
import { pauseFormToJsonSchema, jsonTypeForFormField } from './pause-form-schema.js';
import type { PauseForm } from '../types/pause-state.js';

describe('jsonTypeForFormField', () => {
  it('maps field types to JSON scalar kinds', () => {
    expect(jsonTypeForFormField('text')).toBe('string');
    expect(jsonTypeForFormField('textarea')).toBe('string');
    expect(jsonTypeForFormField('select')).toBe('string');
    expect(jsonTypeForFormField('number')).toBe('number');
    expect(jsonTypeForFormField('checkbox')).toBe('boolean');
  });
});

describe('pauseFormToJsonSchema', () => {
  it('builds an open object keyed by field name with mapped types', () => {
    const form: PauseForm = {
      fields: [
        { type: 'text', name: 'note', label: 'Note' },
        { type: 'number', name: 'amount', label: 'Amount' },
        { type: 'checkbox', name: 'urgent', label: 'Urgent' },
      ],
    };
    const schema = pauseFormToJsonSchema(form);
    expect(schema['type']).toBe('object');
    expect(schema['additionalProperties']).toBe(true);
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['note']?.['type']).toBe('string');
    expect(props['amount']?.['type']).toBe('number');
    expect(props['urgent']?.['type']).toBe('boolean');
  });

  it('handles an empty form', () => {
    const schema = pauseFormToJsonSchema({ fields: [] });
    expect(schema['properties']).toEqual({});
    expect(schema['additionalProperties']).toBe(true);
  });

  it('emits the attachment schema (single + multiple) for attachment fields', () => {
    const form: PauseForm = {
      fields: [
        { type: 'attachment', name: 'contract', label: 'Signed contract' },
        {
          type: 'attachment',
          name: 'evidence',
          label: 'Evidence',
          multiple: true,
          accept: ['application/pdf'],
          maxItems: 3,
        },
      ],
    };
    const props = pauseFormToJsonSchema(form)['properties'] as Record<string, Record<string, unknown>>;
    // single → object carrying the `format: 'attachment'` marker
    expect(props['contract']?.['format']).toBe('attachment');
    // multiple → array whose items carry the marker (picker derives `attachment[]`)
    const evidence = props['evidence'] as Record<string, unknown>;
    expect(evidence['type']).toBe('array');
    expect((evidence['items'] as Record<string, unknown>)['format']).toBe('attachment');
    expect(evidence['maxItems']).toBe(3);
  });
});
