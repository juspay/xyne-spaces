import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSchemaForm } from './use-schema-form.js';

const testSchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', title: 'URL' },
    timeout: { type: 'number', title: 'Timeout', default: 30 },
    enabled: { type: 'boolean' },
    method: { type: 'string', enum: ['GET', 'POST', 'PUT'] },
    headers: {
      type: 'object',
      properties: {
        authorization: { type: 'string' },
      },
    },
  },
};

describe('useSchemaForm', () => {
  it('parses schema into fields', () => {
    const { result } = renderHook(() =>
      useSchemaForm({ schema: testSchema }),
    );

    const fields = result.current.fields;
    expect(fields).toHaveLength(5);

    const urlField = fields.find((f) => f.path === 'url');
    expect(urlField?.type).toBe('string');
    expect(urlField?.required).toBe(true);
    expect(urlField?.label).toBe('URL');

    const timeoutField = fields.find((f) => f.path === 'timeout');
    expect(timeoutField?.type).toBe('number');
    expect(timeoutField?.required).toBe(false);
    expect(timeoutField?.defaultValue).toBe(30);

    const methodField = fields.find((f) => f.path === 'method');
    expect(methodField?.enumValues).toEqual(['GET', 'POST', 'PUT']);

    const headersField = fields.find((f) => f.path === 'headers');
    expect(headersField?.type).toBe('object');
    expect(headersField?.children).toHaveLength(1);
  });

  it('sets and reads field values', () => {
    const { result } = renderHook(() =>
      useSchemaForm({ schema: testSchema }),
    );

    act(() => result.current.setFieldValue('url', 'https://example.com'));
    expect(result.current.values['url']).toBe('https://example.com');
  });

  it('sets nested field values', () => {
    const { result } = renderHook(() =>
      useSchemaForm({ schema: testSchema }),
    );

    act(() => result.current.setFieldValue('headers.authorization', 'Bearer abc'));
    const headers = result.current.values['headers'] as Record<string, unknown>;
    expect(headers['authorization']).toBe('Bearer abc');
  });

  it('validates required fields', () => {
    const { result } = renderHook(() =>
      useSchemaForm({ schema: testSchema }),
    );

    let valid: boolean;
    act(() => { valid = result.current.validate(); });
    expect(valid!).toBe(false);
    expect(result.current.errors['url']).toBe('URL is required');
  });

  it('passes validation when required fields are set', () => {
    const { result } = renderHook(() =>
      useSchemaForm({ schema: testSchema, initialValues: { url: 'https://x.com' } }),
    );

    let valid: boolean;
    act(() => { valid = result.current.validate(); });
    expect(valid!).toBe(true);
    expect(Object.keys(result.current.errors)).toHaveLength(0);
  });

  it('clears error on field edit', () => {
    const { result } = renderHook(() =>
      useSchemaForm({ schema: testSchema }),
    );

    act(() => { result.current.validate(); });
    expect(result.current.errors['url']).toBeDefined();

    act(() => result.current.setFieldValue('url', 'https://x.com'));
    expect(result.current.errors['url']).toBeUndefined();
  });

  it('calls onChange when values change', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useSchemaForm({ schema: testSchema, onChange }),
    );

    act(() => result.current.setFieldValue('url', 'https://x.com'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://x.com' }),
    );
  });

  it('resets to initial values', () => {
    const { result } = renderHook(() =>
      useSchemaForm({
        schema: testSchema,
        initialValues: { url: 'https://orig.com' },
      }),
    );

    act(() => result.current.setFieldValue('url', 'https://changed.com'));
    act(() => result.current.reset());
    expect(result.current.values['url']).toBe('https://orig.com');
  });

  it('formats camelCase keys as labels', () => {
    const schema = {
      type: 'object',
      properties: {
        myFieldName: { type: 'string' },
        another_field: { type: 'number' },
      },
    };
    const { result } = renderHook(() => useSchemaForm({ schema }));
    const labels = result.current.fields.map((f) => f.label);
    expect(labels).toContain('My Field Name');
    expect(labels).toContain('Another field');
  });

  it('preserves a decorated format when unwrapping a variable reference field', () => {
    const schema = {
      type: 'object',
      properties: {
        credentialName: {
          anyOf: [
            { type: 'string', description: 'Credential from the vault' },
            { type: 'string', pattern: '^\\{\\{.+\\}\\}$' },
          ],
          isVariableRef: true,
          format: 'credential-name',
        },
      },
    };

    const { result } = renderHook(() => useSchemaForm({ schema }));
    const credentialName = result.current.fields.find((field) => field.path === 'credentialName');

    expect(credentialName?.acceptsVariableRef).toBe(true);
    expect(credentialName?.format).toBe('credential-name');
  });

  describe('attachment fields', () => {
    const docSchema = {
      type: 'object',
      properties: {
        pan: { type: 'object', format: 'attachment', accept: ['application/pdf'], maxSize: 100 },
        financials: {
          type: 'array',
          items: { type: 'object', format: 'attachment', accept: ['application/pdf'] },
          minItems: 1,
          maxItems: 3,
        },
      },
      required: ['pan'],
    };

    it('captures attachment constraints onto the field', () => {
      const { result } = renderHook(() => useSchemaForm({ schema: docSchema }));
      const pan = result.current.fields.find((f) => f.path === 'pan');
      expect(pan?.format).toBe('attachment');
      expect(pan?.accept).toEqual(['application/pdf']);
      expect(pan?.maxSize).toBe(100);
      expect(pan?.required).toBe(true);

      const fin = result.current.fields.find((f) => f.path === 'financials');
      expect(fin?.type).toBe('array');
      expect(fin?.itemSchema?.['format']).toBe('attachment');
      expect(fin?.minItems).toBe(1);
      expect(fin?.maxItems).toBe(3);
    });

    it('fails validation when a required attachment is missing', () => {
      const { result } = renderHook(() => useSchemaForm({ schema: docSchema }));
      let ok = true;
      act(() => { ok = result.current.validate(); });
      expect(ok).toBe(false);
      expect(result.current.errors['pan']).toBeTruthy();
    });

    it('enforces minItems on a multiple-attachment field', () => {
      const att = { name: 'a.pdf', mimeType: 'application/pdf', handle: 'mem://1' };
      const { result } = renderHook(() => useSchemaForm({ schema: docSchema }));
      act(() => result.current.setFieldValue('pan', att));
      act(() => result.current.setFieldValue('financials', []));
      let ok = true;
      act(() => { ok = result.current.validate(); });
      expect(ok).toBe(false);
      expect(result.current.errors['financials']).toMatch(/at least 1 file/);
    });

    it('passes when required + min constraints are satisfied', () => {
      const att = { name: 'a.pdf', mimeType: 'application/pdf', handle: 'mem://1' };
      const { result } = renderHook(() => useSchemaForm({ schema: docSchema }));
      act(() => result.current.setFieldValue('pan', att));
      act(() => result.current.setFieldValue('financials', [att]));
      let ok = false;
      act(() => { ok = result.current.validate(); });
      expect(ok).toBe(true);
    });
  });
});
