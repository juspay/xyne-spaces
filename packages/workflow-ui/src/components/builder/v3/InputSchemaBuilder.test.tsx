import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { InputSchemaBuilder } from './InputSchemaBuilder.js';

describe('InputSchemaBuilder — document fields', () => {
  it('emits string format date when the creator selects Date', () => {
    const onChange = vi.fn();
    const schema = { type: 'object', properties: { eventDate: { type: 'string' } } };
    const { container } = render(<InputSchemaBuilder value={schema} onChange={onChange} />);

    const typeSelect = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'date' } });

    const emitted = onChange.mock.calls.at(-1)![0] as Record<string, any>;
    expect(emitted['properties'].eventDate).toEqual({ type: 'string', format: 'date' });
  });

  it('renders a single Document field from schema (format + accept)', () => {
    const schema = {
      type: 'object',
      properties: {
        pan: { type: 'object', format: 'attachment', accept: ['application/pdf', 'image/*'], maxSize: 10 * 1024 * 1024 },
      },
      required: ['pan'],
    };
    const { container } = render(<InputSchemaBuilder value={schema} onChange={() => {}} />);
    const typeSelect = container.querySelector('select') as HTMLSelectElement;
    expect(typeSelect.value).toBe('document');
    // accept is surfaced as a comma-joined string
    const acceptInput = within(container).getByPlaceholderText('application/pdf, image/*') as HTMLInputElement;
    expect(acceptInput.value).toBe('application/pdf, image/*');
    // required reflected
    const req = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(req.checked).toBe(true);
  });

  it('detects a Documents (multiple) field with minItems/maxItems', () => {
    const schema = {
      type: 'object',
      properties: {
        financials: {
          type: 'array',
          items: { type: 'object', format: 'attachment' },
          minItems: 1,
          maxItems: 3,
        },
      },
    };
    const { container } = render(<InputSchemaBuilder value={schema} onChange={() => {}} />);
    const typeSelect = container.querySelector('select') as HTMLSelectElement;
    expect(typeSelect.value).toBe('documents');
    // minItems>=1 → Required ticked
    const req = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(req.checked).toBe(true);
  });

  it('emits a single-attachment schema (required → required[]) when type becomes Document', () => {
    const onChange = vi.fn();
    const schema = { type: 'object', properties: { doc: { type: 'string' } }, required: ['doc'] };
    const { container } = render(<InputSchemaBuilder value={schema} onChange={onChange} />);

    const typeSelect = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'document' } });

    const emitted = onChange.mock.calls.at(-1)![0] as Record<string, any>;
    expect(emitted['properties'].doc).toMatchObject({ type: 'object', format: 'attachment' });
    expect(emitted['required']).toContain('doc'); // single → standard required[]
  });

  it('emits an attachment[] schema with minItems when a required Documents field is set', () => {
    const onChange = vi.fn();
    const schema = { type: 'object', properties: { files: { type: 'array' } }, required: ['files'] };
    const { container } = render(<InputSchemaBuilder value={schema} onChange={onChange} />);

    const typeSelect = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'documents' } });

    const emitted = onChange.mock.calls.at(-1)![0] as Record<string, any>;
    expect(emitted['properties'].files).toMatchObject({
      type: 'array',
      items: { type: 'object', format: 'attachment' },
      minItems: 1, // required Documents → minItems, NOT required[]
    });
    expect(emitted['required'] ?? []).not.toContain('files');
  });
});
