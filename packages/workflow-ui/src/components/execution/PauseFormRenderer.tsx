import { useState, type ReactNode } from 'react';
import type { PauseForm, PauseFormField } from '@xyne/workflow-sdk';
import { cn } from '../shared/cn.js';
import { MarkdownView } from '../shared/MarkdownView.js';
import { MarkdownEditor } from '../shared/MarkdownEditor.js';
import { Select } from '../shared/Select.js';
import { DisplayValue } from '../shared/AttachmentCard.js';
import { AttachmentFieldInput } from '../schema-form/AttachmentFieldInput.js';
import type { SchemaFormField } from '../../hooks/use-schema-form.js';

/**
 * Reviewer free-text field, rendered as the SAME labeled card as a display
 * section: a markdown header (label) + a body that shows the value via the
 * shared {@link DisplayValue} (markdown + Show more/less). "Edit" swaps the body
 * to the WYSIWYG {@link MarkdownEditor} at the same collapsed size; an empty
 * field opens straight into the editor.
 */
function MarkdownField({
  label,
  required,
  description,
  chip,
  value,
  onChange,
  disabled,
  error,
}: {
  label: string;
  required?: boolean | undefined;
  description?: string | undefined;
  chip?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean | undefined;
  error?: string | undefined;
}) {
  const hasValue = value.trim().length > 0;
  const [editing, setEditing] = useState(!hasValue && !disabled);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--wui-radius-sm)] border',
        error ? 'border-[var(--wui-status-failed)]' : 'border-[var(--wui-border)]',
      )}
    >
      {/* Header — identical to a display section's */}
      <div className="flex items-start justify-between gap-2 border-b border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-2.5 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <MarkdownView bare className="text-[11px] font-semibold text-[var(--wui-fg)]">{label}</MarkdownView>
          {required && <span className="text-[11px] text-[var(--wui-status-failed)]">*</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {chip}
          {!disabled && (editing ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--wui-primary)] hover:underline"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--wui-border)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--wui-fg-muted)] transition hover:border-[var(--wui-primary)] hover:text-[var(--wui-primary)]"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              Edit
            </button>
          ))}
        </div>
      </div>

      {description && (
        <div className="border-b border-[var(--wui-border)] px-2.5 py-1">
          <MarkdownView bare className="text-[10px] text-[var(--wui-fg-muted)]">{description}</MarkdownView>
        </div>
      )}

      {/* Body — editor while editing, else the same DisplayValue as a display */}
      {editing && !disabled ? (
        <MarkdownEditor bare value={value} onChange={onChange} disabled={disabled} />
      ) : hasValue ? (
        <DisplayValue value={value} maxClass="max-h-40" className="px-2.5 py-2 text-[13px] text-[var(--wui-fg)]" />
      ) : (
        <div className="px-2.5 py-2 text-[13px] text-[var(--wui-fg-muted)]/70">Nothing entered yet.</div>
      )}
      {error && (
        <p className="px-2.5 pb-2 text-[11px] text-[var(--wui-status-failed)]">{error}</p>
      )}
    </div>
  );
}

export interface PauseFormRendererProps {
  form: PauseForm;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean | undefined;
  /** Optional per-field origin chip (rendered next to the field label). */
  renderFieldChip?: ((field: PauseFormField, index: number) => ReactNode) | undefined;
  errors?: Record<string, string> | undefined;
}

export function PauseFormRenderer({ form, values, onChange, disabled, renderFieldChip, errors }: PauseFormRendererProps) {
  const setField = (name: string, value: unknown) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <div className="space-y-3">
      {form.description && (
        <MarkdownView className="text-xs text-[var(--wui-fg-muted)]">{form.description}</MarkdownView>
      )}
      {form.fields.map((field, i) => (
        <FormField
          field={field}
          value={values[field.name]}
          onChange={(val) => setField(field.name, val)}
          disabled={disabled}
          chip={renderFieldChip?.(field, i)}
          error={errors?.[field.name]}
        />
      ))}
    </div>
  );
}

function FormField({
  field,
  value,
  onChange,
  disabled,
  chip,
  error,
}: {
  field: PauseFormField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean | undefined;
  chip?: ReactNode;
  error?: string | undefined;
}) {

  if (field.type === 'text' || field.type === 'textarea') {
    return (
      <MarkdownField
        label={field.label}
        required={field.required}
        description={field.description}
        chip={chip}
        value={(value as string) ?? ''}
        onChange={onChange}
        disabled={disabled}
        error={error}
      />
    );
  }

  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-xs font-medium text-[var(--wui-fg)]">
        <MarkdownView bare className="text-xs font-medium text-[var(--wui-fg)]">{field.label}</MarkdownView>
        {field.required && <span className="text-[var(--wui-status-failed)]">*</span>}
        {chip && <span className="ml-auto">{chip}</span>}
      </label>
      {field.description && (
        <MarkdownView className="mb-1 text-[10px] text-[var(--wui-fg-muted)]">{field.description}</MarkdownView>
      )}
      {renderInput(field, value, onChange, disabled)}
      {error && (
        <p className="mt-1 text-[11px] text-[var(--wui-status-failed)]">{error}</p>
      )}
    </div>
  );
}

const inputClass = cn(
  'w-full rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2.5 py-1.5 text-sm text-[var(--wui-fg)]',
  'placeholder:text-[var(--wui-fg-muted)]/50',
  'focus:border-[var(--wui-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--wui-primary)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

function renderInput(
  field: PauseFormField,
  value: unknown,
  onChange: (value: unknown) => void,
  disabled?: boolean | undefined,
) {
  // Attachment field: reuse the schema-form uploader (drag/drop → client.uploads →
  // Attachment ref). Detected via a cast and kept out of the discriminated `switch`
  // so this compiles regardless of whether the installed SDK type already exposes the
  // 'attachment' variant. The value lands in resumeData.data.<name> as a ref / refs.
  if ((field as { type: string }).type === 'attachment') {
    const f = field as unknown as {
      name: string;
      label: string;
      required?: boolean;
      multiple?: boolean;
      accept?: string[];
      maxSize?: number;
      maxItems?: number;
    };
    const sff: SchemaFormField = f.multiple
      ? {
          path: f.name,
          label: f.label,
          type: 'array',
          required: !!f.required,
          acceptsVariableRef: false,
          format: 'attachment',
          ...(f.maxItems !== undefined ? { maxItems: f.maxItems } : {}),
          itemSchema: {
            format: 'attachment',
            ...(f.accept !== undefined ? { accept: f.accept } : {}),
            ...(f.maxSize !== undefined ? { maxSize: f.maxSize } : {}),
          },
        }
      : {
          path: f.name,
          label: f.label,
          type: 'object',
          required: !!f.required,
          acceptsVariableRef: false,
          format: 'attachment',
          ...(f.accept !== undefined ? { accept: f.accept } : {}),
          ...(f.maxSize !== undefined ? { maxSize: f.maxSize } : {}),
        };
    return (
      <AttachmentFieldInput field={sff} value={value} onChange={onChange} readOnly={disabled} />
    );
  }

  switch (field.type) {
    case 'number':
      return (
        <input
          type="number"
          value={value != null ? String(value) : ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          disabled={disabled}
          className={inputClass}
        />
      );

    case 'select':
      return <SelectInput field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="rounded border-[var(--wui-border)] text-[var(--wui-primary)] focus:ring-[var(--wui-primary)]"
          />
          <MarkdownView bare className="text-[var(--wui-fg-muted)]">{field.label}</MarkdownView>
        </label>
      );

    default:
      return null;
  }
}

function SelectInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: Extract<PauseFormField, { type: 'select' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean | undefined;
}) {
  const options = Array.isArray(field.options) ? field.options : [];
  const currentValue = (value as string) ?? '';
  const isCustom = field.allowCustomValue && currentValue !== '' && !options.some((o) => o.value === currentValue);

  if (field.allowCustomValue && isCustom) {
    return (
      <div className="flex gap-1.5">
        <input
          type="text"
          value={currentValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? 'Custom value...'}
          disabled={disabled}
          className={cn(inputClass, 'flex-1')}
        />
        <button
          type="button"
          onClick={() => onChange('')}
          disabled={disabled}
          className="rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] px-2 text-xs text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)]"
        >
          List
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <Select
        value={currentValue}
        options={options.map((o) => ({ value: String(o.value), label: o.label }))}
        onChange={onChange}
        placeholder={field.placeholder}
        disabled={disabled}
        className="flex-1"
      />
      {field.allowCustomValue && (
        <button
          type="button"
          onClick={() => onChange('__custom__')}
          disabled={disabled}
          className="rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] px-2 text-xs text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)]"
        >
          Custom
        </button>
      )}
    </div>
  );
}

/** Extract default values from a PauseForm's field definitions. */
export function getFormDefaults(form: PauseForm | undefined): Record<string, unknown> {
  if (!form) return {};
  const defaults: Record<string, unknown> = {};
  for (const field of form.fields) {
    if ('defaultValue' in field && field.defaultValue != null) {
      defaults[field.name] = field.defaultValue;
    }
  }
  return defaults;
}

export function validatePauseForm(
  form: PauseForm | undefined,
  values: Record<string, unknown>,
): Record<string, string> {
  if (!form) return {};
  const errors: Record<string, string> = {};
  for (const field of form.fields) {
    if (!field.required) continue;
    if (isEmptyFieldValue(field, values[field.name])) {
      errors[field.name] = `${field.label} is required`;
    }
  }
  return errors;
}

function isEmptyFieldValue(field: PauseFormField, value: unknown): boolean {
  if (value === undefined || value === null) return true;

  if ((field as { type: string }).type === 'attachment') {
    return Array.isArray(value) ? value.length === 0 : !value;
  }

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'select':
      return typeof value === 'string' ? value.trim() === '' : !value;
    case 'number':
      return typeof value === 'number' ? Number.isNaN(value) : true;
   case 'checkbox':
      return value !== true;
    default:
      return !value;
  }
}
