import { useState } from 'react';
import type { SchemaFormField } from '../../hooks/use-schema-form.js';
import { AttachmentFieldInput } from './AttachmentFieldInput.js';
import { CredentialDropdown } from './CredentialDropdown.js';
import { OptionsField, OptionSuggestions, useFieldOptionsScope } from '../builder/v3/field-options.js';
import { InputSchemaBuilder } from '../builder/v3/InputSchemaBuilder.js';
import { StringArrayInput } from '../builder/v3/StringArrayInput.js';
import { MultiSelectCheckboxes } from '../builder/v3/MultiSelectCheckboxes.js';
import { cn } from '../shared/cn.js';

export interface SchemaFormRendererProps {
  fields: SchemaFormField[];
  values: Record<string, unknown>;
  errors: Record<string, string>;
  onChange: (path: string, value: unknown) => void;
  readOnly?: boolean | undefined;
  /**
   * Render upload fields as a single row when empty. Pass-through only — the
   * renderer has no opinion, it just hands this to {@link AttachmentFieldInput}
   * so a dense form can ask for it without every other screen changing.
   */
  compactUploads?: boolean | undefined;
  className?: string | undefined;
  classNames?: {
    root?: string | undefined;
    field?: string | undefined;
    label?: string | undefined;
    input?: string | undefined;
    error?: string | undefined;
    description?: string | undefined;
  } | undefined;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function SchemaFormRenderer({
  fields,
  values,
  errors,
  onChange,
  readOnly,
  compactUploads,
  className,
  classNames,
}: SchemaFormRendererProps) {
  return (
    <div className={cn('space-y-4', classNames?.root, className)}>
      {fields.map((field) => (
        <FieldRenderer
          key={field.path}
          field={field}
          siblings={values}
          value={getNestedValue(values, field.path)}
          error={errors[field.path]}
          onChange={(val) => onChange(field.path, val)}
          readOnly={readOnly}
          compactUploads={compactUploads}
          classNames={classNames}
        />
      ))}
    </div>
  );
}

interface FieldRendererProps {
  field: SchemaFormField;
  /**
   * The whole form, at every depth — what a picker sends so its loader can narrow
   * by other fields. Not rebound when nesting: `ctx.config` means one thing, and
   * `ctx.field` (a dotted path) says where in it this field sits.
   */
  siblings: Record<string, unknown>;
  value: unknown;
  error?: string | undefined;
  onChange: (value: unknown) => void;
  readOnly?: boolean | undefined;
  compactUploads?: boolean | undefined;
  classNames?: SchemaFormRendererProps['classNames'] | undefined;
}

function FieldRenderer({
  field,
  siblings,
  value,
  error,
  onChange,
  readOnly,
  compactUploads,
  classNames,
}: FieldRendererProps) {
  const optionsScope = useFieldOptionsScope();
  const [suggesting, setSuggesting] = useState(false);
  const canPick = field.hasOptions === true && optionsScope !== null;
  const inputClasses = cn(
    'w-full rounded-lg border px-3 py-2 text-sm',
    'bg-[var(--wui-surface)] text-[var(--wui-fg)]',
    'outline-none transition-all',
    error
      ? 'border-[var(--wui-status-failed)] focus:border-[var(--wui-status-failed)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wui-status-failed)_25%,transparent)]'
      : 'border-[var(--wui-border)] focus:border-[var(--wui-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)]',
    readOnly && 'opacity-60 cursor-not-allowed bg-[var(--wui-bg-subtle)]',
    classNames?.input,
  );

  const renderValueInput = () => {
    const isAttachmentField =
      field.format === 'attachment' ||
      (field.type === 'array' && field.itemSchema?.['format'] === 'attachment');
    if (isAttachmentField) {
      return (
        <AttachmentFieldInput
          field={field}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          compact={compactUploads}
        />
      );
    }

    if (field.format === 'credential-name') {
      return (
        <CredentialDropdown
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          readOnly={readOnly}
          ariaLabel={field.label}
          accepts={field.credentialTypes}
        />
      );
    }

    if (field.enumValues) {
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          className={inputClasses}
        >
          <option value="">Select...</option>
          {field.enumValues.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      );
    }

    switch (field.type) {
      case 'boolean': {
        const currentValue = value === true ? 'true' : value === false ? 'false' : '';
        return (
          <select
            value={currentValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'true') onChange(true);
              else if (v === 'false') onChange(false);
              else onChange(undefined);
            }}
            disabled={readOnly}
            className={inputClasses}
          >
            {!field.required && <option value="">Unset</option>}
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        );
      }

      case 'number':
      case 'integer':
        return (
          <input
            type="number"
            value={value !== undefined && value !== null ? String(value) : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            placeholder={field.placeholder ?? field.description}
            disabled={readOnly}
            step={field.type === 'integer' ? 1 : undefined}
            className={inputClasses}
          />
        );

      case 'object':
        if (field.format === 'json-schema') {
          return (
            <InputSchemaBuilder
              value={(value as Record<string, unknown>) ?? {}}
              onChange={onChange}
            />
          );
        }
        if (field.children && field.children.length > 0) {
          return (
            <div className="ml-1 mt-2 space-y-3 border-l-2 border-[var(--wui-border)] pl-4">
              {field.children.map((child) => (
                <FieldRenderer
                  key={child.path}
                  field={child}
                  siblings={siblings}
                  value={getNestedValue(
                    (value as Record<string, unknown>) ?? {},
                    child.path.slice(field.path.length + 1),
                  )}
                  onChange={(val) => onChange({
                    ...((value as Record<string, unknown>) ?? {}),
                    [child.path.slice(field.path.length + 1)]: val,
                  })}
                  readOnly={readOnly}
                  compactUploads={compactUploads}
                  classNames={classNames}
                />
              ))}
            </div>
          );
        }
        return (
          <textarea
            value={value ? JSON.stringify(value, null, 2) : ''}
            onChange={(e) => {
              try { onChange(JSON.parse(e.target.value)); }
              catch { /* invalid JSON — keep typing */ }
            }}
            disabled={readOnly}
            rows={4}
            className={cn(inputClasses, 'font-mono text-xs leading-relaxed')}
            placeholder="{}"
          />
        );

      case 'array': {
        const itemSchema = field.itemSchema;
        if (itemSchema?.['enum']) {
          return (
            <MultiSelectCheckboxes
              options={itemSchema['enum'] as string[]}
              value={(value as string[]) ?? []}
              onChange={onChange}
            />
          );
        }
        if (itemSchema?.['type'] === 'string' && !itemSchema['enum']) {
          return (
            <StringArrayInput
              value={(value as string[]) ?? []}
              onChange={onChange}
            />
          );
        }
        return (
          <textarea
            value={value ? JSON.stringify(value, null, 2) : ''}
            onChange={(e) => {
              try { onChange(JSON.parse(e.target.value)); }
              catch { /* invalid JSON — keep typing */ }
            }}
            disabled={readOnly}
            rows={4}
            className={cn(inputClasses, 'font-mono text-xs leading-relaxed')}
            placeholder="[]"
          />
        );
      }

      default:
        return (
          <input
            type={field.format === 'password' ? 'password' : 'text'}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setSuggesting(true)}
            onBlur={() => setSuggesting(false)}
            placeholder={field.placeholder ?? field.description}
            disabled={readOnly}
            className={inputClasses}
          />
        );
    }
  };

  const renderInput = () => {
    if (!canPick || optionsScope === null) return renderValueInput();

    if (field.type === 'array') {
      return (
        <OptionsField
          field={field.path}
          value={value}
          onChange={onChange}
          config={siblings}
          scope={optionsScope}
          multi
          placeholder={field.placeholder ?? 'Choose…'}
          disabled={readOnly}
        />
      );
    }

    return (
      <div className="relative">
        {renderValueInput()}
        {suggesting && !String(value ?? '').includes('{{') && (
          <OptionSuggestions
            scope={optionsScope}
            field={field.path}
            config={siblings}
            search={String(value ?? '')}
            onPick={(picked) => {
              onChange(picked);
              setSuggesting(false);
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div className={cn('space-y-1.5', classNames?.field)}>
      <label className={cn('flex items-center gap-1 text-xs font-medium text-[var(--wui-fg)]', classNames?.label)}>
        {field.label}
        {field.required && <span className="text-[var(--wui-status-failed)]">*</span>}
        {field.acceptsVariableRef && (
          <span className="ml-auto rounded bg-[var(--wui-primary-light)] px-1 py-0.5 text-[9px] font-semibold text-[var(--wui-primary)]">
            {'{{var}}'}
          </span>
        )}
      </label>

      {renderInput()}

      {field.description && (
        <p className={cn('text-[11px] leading-relaxed text-[var(--wui-fg-muted)]', classNames?.description)}>
          {field.description}
        </p>
      )}

      {error && (
        <p className={cn('flex items-center gap-1 text-[11px] text-[var(--wui-status-failed)]', classNames?.error)}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
