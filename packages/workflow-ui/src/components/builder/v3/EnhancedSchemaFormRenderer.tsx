import { useMemo, useState } from 'react';
import type { WorkflowConfig, Citation } from '@xyne/workflow-sdk/builder';
import {
  isExpression,
} from '@xyne/workflow-sdk/expression';
import type { SchemaFormField } from '../../../hooks/use-schema-form.js';
import { CitationCtx, FieldSourceControl, type CitationCtxValue } from './field-source-control.js';
import { itemSchemaToFields, detectItemDiscriminatedUnion } from '../../../hooks/use-schema-form.js';
import { VariableRefInput } from './VariableRefInput.js';
import { ExpressionInput } from './ExpressionInput.js';
import { KeyValueEditor } from './KeyValueEditor.js';
import { DiscriminatedUnionEditor } from './DiscriminatedUnionEditor.js';
import { CodeEditor } from './CodeEditor.js';
import { OutputFieldsEditor } from './OutputFieldsEditor.js';
import { StringArrayInput } from './StringArrayInput.js';
import { MultiSelectCheckboxes } from './MultiSelectCheckboxes.js';
import { InputSchemaBuilder } from './InputSchemaBuilder.js';
import { CredentialDropdown } from '../../schema-form/CredentialDropdown.js';
import { cn } from '../../shared/cn.js';
import { OptionsField, useFieldOptionsScope } from './field-options.js';
import { useOptionalSlot } from '../../provider/slot-resolution.js';
import type { AssigneePickerProps } from '../../../types/slots.js';

export interface EnhancedSchemaFormRendererProps {
  fields: SchemaFormField[];
  values: Record<string, unknown>;
  errors: Record<string, string>;
  onChange: (path: string, value: unknown) => void;
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
  /** Author citations for this step (overlay). Enables the per-field "source" control. */
  citations?: Record<string, Citation[]> | undefined;
  onAddCitation?: ((fieldPath: string, citation: Citation) => void) | undefined;
  onRemoveCitation?: ((citationPath: string, index: number) => void) | undefined;
}

/** Field types where a typed editor exists but the whole field can also bind to a `{{ref}}`. */
const VAR_BINDABLE_TYPES = new Set(['boolean', 'number', 'integer', 'array', 'object']);

/** True if the value is exactly one `{{...}}` reference (no surrounding text). */
function isPureRefValue(v: unknown): boolean {
  return typeof v === 'string' && /^\{\{[^}]+\}\}$/.test(v.trim());
}

/** True if the value is exactly one `{% ... %}` expression. */
function isExpressionValue(v: unknown): boolean {
  return typeof v === 'string' && isExpression(v.trim());
}

/**
 * The three ways to fill a field, which are mutually exclusive — hence a mode
 * switch rather than another box.
 *
 *   value       type it, or pick it from what this field usually holds
 *   variable    point at a value that already exists
 *   expression  work one out that does not
 */
type FieldMode = 'value' | 'variable' | 'expression';

const MODE_LABEL: Record<FieldMode, string> = {
  value: 'Value',
  variable: 'Variable',
  expression: 'ƒx',
};

const MODE_TITLE: Record<FieldMode, string> = {
  value: 'Type a fixed value',
  variable: 'Use a value from the trigger or an earlier step',
  expression: 'Work out a value — add up a list, filter it, reformat text',
};

/**
 * Whether a field can hold a *computed* value.
 *
 * The binding condition is the important one, and it is easy to get wrong: an
 * expression is stored as a `{% … %}` **string**, so the field's schema has to
 * accept a string. That means it was declared `variableRef(…)`, or it is plain
 * text. A bare `z.number()` cannot hold one — offering the mode there gives a
 * field that fails its own shape check the moment anything is typed, which is
 * exactly what happened on HTTP Request's `timeoutMs`.
 *
 * A step that wants expressions in a typed field declares it
 * `variableRef(z.number())`, which is already what it must do to accept a
 * `{{ref}}`. So this is not a limitation of expressions so much as the same
 * contract refs have always had.
 *
 * Excluded besides: a credential and an attachment are selections rather than
 * values, an enum is a fixed list, and the schema builders edit a shape.
 */
export function fieldSupportsExpression(field: {
  type: SchemaFormField['type'];
  acceptsVariableRef: boolean;
  format?: string | undefined;
  enumValues?: string[] | undefined;
}): boolean {
  return (
    (field.acceptsVariableRef || field.type === 'string')
    && field.format !== 'credential-name'
    && field.format !== 'attachment'
    && field.format !== 'json-schema'
    && field.format !== 'output-fields'
    && !field.enumValues
  );
}

/**
 * Which modes a field offers, and which one it is in.
 *
 * Pulled out of the component because it is the whole decision and worth
 * testing directly: rendering it instead would mean standing up a provider and
 * a CodeMirror instance to assert a branch of `if`.
 *
 * The stored value wins over what the author last clicked, so re-opening a step
 * shows the mode its data is actually in — the same way the two-state toggle
 * this replaced behaved. `picked` only decides the cases the value cannot: an
 * empty field, or a literal.
 */
export function fieldModeState(args: {
  value: unknown;
  /** The field has a typed editor, so a `{{ref}}` needs a mode of its own. */
  supportsVarBinding: boolean;
  /** The field can hold a computed value. */
  supportsExpression: boolean;
  isAttachmentField: boolean;
  picked: FieldMode | null;
}): { modes: FieldMode[]; mode: FieldMode } {
  const { value, supportsVarBinding, supportsExpression, isAttachmentField, picked } = args;

  const modes: FieldMode[] = [
    'value',
    // A string field embeds the picker in its ordinary box, so it needs no
    // separate variable mode; a typed field has no room for `{{…}}` and does.
    ...(supportsVarBinding && !isAttachmentField ? (['variable'] as const) : []),
    ...(supportsExpression ? (['expression'] as const) : []),
  ];

  const detected: FieldMode | null = isExpressionValue(value)
    ? 'expression'
    : isPureRefValue(value) && supportsVarBinding
      ? 'variable'
      : null;

  const mode = detected ?? (picked !== null && modes.includes(picked) ? picked : 'value');
  return { modes, mode };
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (path === '') return obj;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function EnhancedSchemaFormRenderer({
  fields,
  values,
  errors,
  onChange,
  config,
  atStepId,
  readOnly,
  citations,
  onAddCitation,
  onRemoveCitation,
}: EnhancedSchemaFormRendererProps) {
  // Enable per-field citation controls only when the caller wires the mutators.
  const citationCtx: CitationCtxValue | null = useMemo(
    () =>
      !readOnly && onAddCitation && onRemoveCitation
        ? {
            config,
            atStepId,
            stepConfig: values,
            citations: citations ?? {},
            onAdd: onAddCitation,
            onRemove: onRemoveCitation,
          }
        : null,
    [readOnly, onAddCitation, onRemoveCitation, config, atStepId, values, citations],
  );

  const body = (
    <div className="space-y-4">
      {fields.map((field) => (
        <EnhancedFieldRenderer
          key={field.path}
          field={field}
          siblings={values}
          value={getNestedValue(values, field.path)}
          error={errors[field.path]}
          onChange={(val) => onChange(field.path, val)}
          config={config}
          atStepId={atStepId}
          readOnly={readOnly}
        />
      ))}
    </div>
  );

  return citationCtx ? (
    <CitationCtx.Provider value={citationCtx}>{body}</CitationCtx.Provider>
  ) : (
    body
  );
}

interface EnhancedFieldRendererProps {
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
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
}

function EnhancedFieldRenderer({
  field,
  siblings,
  value,
  error,
  onChange,
  config,
  atStepId,
  readOnly,
}: EnhancedFieldRendererProps) {
  const optionsScope = useFieldOptionsScope();
  // "Use a variable" binding for fields that have a typed editor (the default
  // string field already embeds the picker). Bound when toggled on or the
  // current value is already a pure ref.
  const isAttachmentField = field.format === 'attachment';
  const isCredentialField = field.format === 'credential-name';
  const supportsVarBinding = isAttachmentField
    || (field.acceptsVariableRef && field.format === 'json-schema')
    || (!isCredentialField
      && VAR_BINDABLE_TYPES.has(field.type)
      && field.format !== 'json-schema'
      && field.format !== 'output-fields');
  const supportsExpression = fieldSupportsExpression(field);
  const AssigneeSlot = useOptionalSlot<AssigneePickerProps>('assigneePicker');
  // What the author last asked for. The *value* wins when it already says what
  // it is, so re-opening a step shows the mode its data is in — which is also
  // how the old two-state toggle behaved.
  const [picked, setPicked] = useState<FieldMode | null>(null);
  // No scope means no one to ask — an unsaved workflow with no folder yet, so
  // there is nothing to suggest and the field is just its ordinary input.
  const suggestFrom =
    field.hasOptions === true && optionsScope !== null
      ? { scope: optionsScope, field: field.path, config: siblings }
      : undefined;
  const { modes, mode } = fieldModeState({
    value,
    supportsVarBinding,
    supportsExpression,
    isAttachmentField,
    picked,
  });

  // Host-provided assignee picker. 
  if (field.format === 'assignee' && AssigneeSlot) {
    return <AssigneeSlot value={value} onChange={onChange} readOnly={readOnly} />;
  }

  const inExpression = mode === 'expression';
  const boundToVar = isAttachmentField || (supportsVarBinding && mode === 'variable');
  const varFilterType = isAttachmentField ? 'attachment[]' : field.type;

  const inputClasses = cn(
    'w-full rounded-lg border px-3 py-2 text-sm',
    'bg-white text-[var(--wui-fg)]',
    'outline-none transition-all',
    error
      ? 'border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100'
      : 'border-[var(--wui-border)] focus:border-[var(--wui-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)]',
    readOnly && 'opacity-60 cursor-not-allowed bg-[var(--wui-bg-subtle)]',
  );

  const renderValueInput = () => {
    if (isCredentialField) {
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

    if (inExpression) {
      return (
        <ExpressionInput
          value={value}
          onChange={onChange}
          config={config}
          atStepId={atStepId}
          fieldType={field.type}
          disabled={readOnly}
        />
      );
    }

    // Whole-field bound to a variable ref (type-filtered picker).
    if (boundToVar) {
      return (
        <VariableRefInput
          value={value}
          onChange={onChange}
          config={config}
          atStepId={atStepId}
          placeholder={isAttachmentField ? '{{ select files }}' : '{{ variable }}'}
          disabled={readOnly}
          filterType={varFilterType}
        />
      );
    }

    switch (field.type) {
      case 'boolean': {
        // Tri-state dropdown: True / False / (Unset for optional fields).
        // Clearer than a toggle when the field is nullable — toggle can't
        // distinguish "user chose false" from "user hasn't set it".
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
        // JSON Schema builder (format: 'json-schema')
        if (field.format === 'json-schema') {
          return (
            <InputSchemaBuilder
              value={value as Record<string, unknown> | undefined}
              onChange={(val) => onChange(val)}
              disabled={readOnly}
            />
          );
        }
        // Discriminated union (anyOf with const discriminator)
        if (field.discriminator) {
          return (
            <DiscriminatedUnionEditor
              field={field}
              value={value as Record<string, unknown> | undefined}
              onChange={(val) => onChange(val)}
              config={config}
              atStepId={atStepId}
              readOnly={readOnly}
              renderField={(vf, vfValue, vfOnChange) => (
                <EnhancedFieldRenderer
                  field={vf}
                  siblings={siblings}
                  value={vfValue}
                  onChange={vfOnChange}
                  config={config}
                  atStepId={atStepId}
                  readOnly={readOnly}
                />
              )}
            />
          );
        }
        // Record type (additionalProperties) — key-value editor
        if (field.additionalPropertiesSchema) {
          return (
            <KeyValueEditor
              value={value as Record<string, string> | undefined}
              onChange={(val) => onChange(val)}
              config={config}
              atStepId={atStepId}
              recordPath={field.path}
              disabled={readOnly}
            />
          );
        }
        // Nested object with explicit properties
        if (field.children && field.children.length > 0) {
          return (
            <div className="ml-1 mt-2 space-y-3 border-l-2 border-[var(--wui-border)] pl-4">
              {field.children.map((child) => (
                <EnhancedFieldRenderer
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
                  config={config}
                  atStepId={atStepId}
                  readOnly={readOnly}
                />
              ))}
            </div>
          );
        }
        // Fallback: raw JSON textarea
        return (
          <textarea
            value={value ? JSON.stringify(value, null, 2) : ''}
            onChange={(e) => {
              try { onChange(JSON.parse(e.target.value)); }
              catch { /* invalid JSON */ }
            }}
            disabled={readOnly}
            rows={4}
            className={cn(inputClasses, 'font-mono text-xs leading-relaxed')}
            placeholder="{}"
          />
        );

      case 'array':
        if (field.format === 'output-fields') {
          return (
            <OutputFieldsEditor
              value={value as Array<{ name: string; type: string }> | undefined}
              onChange={onChange}
              disabled={readOnly}
            />
          );
        }
        // Multi-select checkboxes: array + items with enum
        if (field.itemSchema?.['enum'] && Array.isArray(field.itemSchema['enum'])) {
          return (
            <MultiSelectCheckboxes
              options={field.itemSchema['enum'] as string[]}
              value={value as string[] | undefined}
              onChange={(val) => onChange(val)}
              disabled={readOnly}
            />
          );
        }
        // Tag input: array + items.type === 'string' (no enum)
        if (field.itemSchema?.['type'] === 'string' && !field.itemSchema['enum']) {
          return (
            <StringArrayInput
              value={value as string[] | undefined}
              onChange={(val) => onChange(val)}
              placeholder={field.description}
              disabled={readOnly}
            />
          );
        }
        // Structured array editor when itemSchema describes object items
        if (field.itemSchema && (field.itemSchema['type'] === 'object' || field.itemSchema['anyOf'] || field.itemSchema['oneOf'])) {
          return (
            <ArrayOfObjectsEditor
              itemSchema={field.itemSchema}
              value={value as Record<string, unknown>[] | undefined}
              onChange={onChange}
              config={config}
              atStepId={atStepId}
              arrayPath={field.path}
              readOnly={readOnly}
            />
          );
        }
        return (
          <textarea
            value={value ? JSON.stringify(value, null, 2) : ''}
            onChange={(e) => {
              try { onChange(JSON.parse(e.target.value)); }
              catch { /* invalid JSON */ }
            }}
            disabled={readOnly}
            rows={4}
            className={cn(inputClasses, 'font-mono text-xs leading-relaxed')}
            placeholder="[]"
          />
        );

      default:
        // Code editor — CodeMirror with autocomplete
        if (field.format === 'code') {
          return (
            <CodeEditor
              value={String(value ?? '')}
              onChange={onChange}
              config={config}
              atStepId={atStepId}
              readOnly={readOnly}
            />
          );
        }
        // All other string fields get the variable ref input with {{ }} picker
        return (
          <VariableRefInput
            value={value}
            onChange={onChange}
            config={config}
            atStepId={atStepId}
            placeholder={field.placeholder ?? field.description}
            disabled={readOnly}
            filterType={field.type}
            suggest={boundToVar ? undefined : suggestFrom}
          />
        );
    }
  };

  const renderInput = () => {
    if (suggestFrom && !boundToVar && !inExpression && field.type === 'array') {
      return (
        <OptionsField
          field={field.path}
          value={value}
          onChange={onChange}
          config={siblings}
          scope={suggestFrom.scope}
          multi
          placeholder={field.placeholder ?? 'Choose…'}
          disabled={readOnly}
        />
      );
    }
    return renderValueInput();
  };

  // Array-of-objects fields delegate the source control to each rendered row
  // (every array element is citable as a unit) — so we suppress it on the array
  // field itself. Generic: no field-name knowledge, just the schema shape.
  const isArrayOfObjects =
    field.type === 'array' &&
    !!field.itemSchema &&
    (field.itemSchema['type'] === 'object' || !!field.itemSchema['anyOf'] || !!field.itemSchema['oneOf']);

  return (
    <div className="relative space-y-1.5">
      <label className="flex items-center gap-1 text-xs font-medium text-[var(--wui-fg)]">
        {field.label}
        {field.required && <span className="text-red-400">*</span>}
        <span className="ml-auto flex items-center gap-1">
          {field.acceptsVariableRef && (
            <span className="rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-semibold text-indigo-500">
              {'{{var}}'}
            </span>
          )}
          {!isArrayOfObjects && <FieldSourceControl fieldPath={field.path} />}
        </span>
      </label>

      {renderInput()}

      {/* Kept below the input, where the old two-state toggle was: the label row
          already carries the ref badge and the source control, and a side panel
          is narrow. */}
      {!readOnly && !isAttachmentField && modes.length > 1 && (
        <div
          role="group"
          aria-label={`How to fill ${field.label}`}
          className="inline-flex rounded-md border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-0.5"
        >
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              title={MODE_TITLE[m]}
              aria-pressed={m === mode}
              onClick={() => {
                if (m === mode) return;
                // Clear on switch: a ref, an expression and a literal are not
                // convertible into one another, so carrying the old text over
                // would leave something invalid in the new mode.
                setPicked(m);
                onChange(undefined);
              }}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                m === mode
                  ? 'bg-white text-[var(--wui-primary)] shadow-sm'
                  : 'text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      {field.description && (
        <p className="text-[11px] leading-relaxed text-[var(--wui-fg-muted)]">
          {field.description}
        </p>
      )}

      {error && (
        <p className="flex items-center gap-1 text-[11px] text-red-500">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Array of objects editor ───

const DISC_PILL_COLORS: Record<string, { bg: string; text: string }> = {
  set: { bg: 'bg-sky-100', text: 'text-sky-700' },
  rename: { bg: 'bg-amber-100', text: 'text-amber-700' },
  remove: { bg: 'bg-rose-100', text: 'text-rose-700' },
  copy: { bg: 'bg-violet-100', text: 'text-violet-700' },
  text: { bg: 'bg-slate-100', text: 'text-slate-700' },
  textarea: { bg: 'bg-slate-100', text: 'text-slate-700' },
  number: { bg: 'bg-blue-100', text: 'text-blue-700' },
  select: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  checkbox: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  attachment: { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
};

const DISC_DEFAULT_PILL = { bg: 'bg-slate-100', text: 'text-slate-600' };

/** Build a short summary of an item for display in the header. */
function itemSummary(item: Record<string, unknown>, discField?: string): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(item)) {
    if (k === discField) continue;
    if (v === undefined || v === null || v === '') continue;
    const str = typeof v === 'string' ? v : JSON.stringify(v);
    const truncated = str.length > 40 ? str.slice(0, 37) + '...' : str;
    parts.push(truncated);
    if (parts.length >= 2) break;
  }
  return parts.join(' \u2192 ');
}

interface ArrayOfObjectsEditorProps {
  itemSchema: Record<string, unknown>;
  value: Record<string, unknown>[] | undefined;
  onChange: (value: unknown) => void;
  config: WorkflowConfig;
  atStepId: string;
  /** Path of this array field within the step config (e.g. `display`, `form.fields`). */
  arrayPath: string;
  readOnly?: boolean | undefined;
}

function ArrayOfObjectsEditor({
  itemSchema,
  value,
  onChange,
  config,
  atStepId,
  arrayPath,
  readOnly,
}: ArrayOfObjectsEditorProps) {
  const items = value ?? [];
  const discriminator = useMemo(
    () => detectItemDiscriminatedUnion(itemSchema),
    [itemSchema],
  );
  const simpleFields = useMemo(
    () => (discriminator ? null : itemSchemaToFields(itemSchema)),
    [itemSchema, discriminator],
  );

  const handleAdd = () => {
    const empty: Record<string, unknown> = {};
    if (discriminator) {
      const firstVariant = Object.keys(discriminator.variants)[0];
      if (firstVariant) empty[discriminator.field] = firstVariant;
    }
    onChange([...items, empty]);
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleUpdate = (index: number, updated: Record<string, unknown>) => {
    const next = [...items];
    next[index] = updated;
    onChange(next);
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= items.length) return;
    const next = [...items];
    [next[index], next[newIndex]] = [next[newIndex]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <ArrayItemRow
          key={index}
          item={item}
          index={index}
          total={items.length}
          itemPath={`${arrayPath}.${String(index)}`}
          simpleFields={simpleFields}
          discriminator={discriminator}
          config={config}
          atStepId={atStepId}
          readOnly={readOnly}
          onUpdate={(updated) => handleUpdate(index, updated)}
          onRemove={() => handleRemove(index)}
          onMoveUp={() => handleMove(index, -1)}
          onMoveDown={() => handleMove(index, 1)}
        />
      ))}
      {!readOnly && (
        <button
          onClick={handleAdd}
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2.5 text-[12px] font-medium text-slate-400 hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50/50 transition-all"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
          Add item
        </button>
      )}
    </div>
  );
}

interface ArrayItemRowProps {
  item: Record<string, unknown>;
  index: number;
  total: number;
  /** Path of this element within the step config (e.g. `display.0`, `form.fields.1`). */
  itemPath: string;
  simpleFields: SchemaFormField[] | null;
  discriminator: SchemaFormField['discriminator'] | null;
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
  onUpdate: (updated: Record<string, unknown>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function ArrayItemRow({
  item,
  index,
  total,
  itemPath,
  simpleFields,
  discriminator,
  config,
  atStepId,
  readOnly,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ArrayItemRowProps) {
  const discValue = discriminator ? String(item[discriminator.field] ?? '') : '';
  const fields = discriminator
    ? discriminator.variants[discValue] ?? []
    : simpleFields ?? [];
  const summary = itemSummary(item, discriminator?.field);
  const pillColor = DISC_PILL_COLORS[discValue] ?? DISC_DEFAULT_PILL;

  const handleFieldChange = (key: string, val: unknown) => {
    onUpdate({ ...item, [key]: val });
  };

  return (
    <div className="relative rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        {/* Index */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-400">
          {index + 1}
        </span>

        {/* Discriminator pill */}
        {discriminator && discValue && (
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            pillColor.bg, pillColor.text,
          )}>
            {discValue}
          </span>
        )}

        {/* Summary */}
        {summary && (
          <span className="min-w-0 truncate text-[11px] text-slate-400 font-mono">
            {summary}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Per-row source — every array element is citable as a unit (generic). */}
        <FieldSourceControl fieldPath={itemPath} />

        {/* Reorder + remove */}
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              onClick={onMoveUp}
              type="button"
              disabled={index === 0}
              className="flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
            <button
              onClick={onMoveDown}
              type="button"
              disabled={index === total - 1}
              className="flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div className="mx-0.5 h-3 w-px bg-slate-200" />
            <button
              onClick={onRemove}
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 px-3 py-3">
        {/* Discriminator selector as inline pills */}
        {discriminator && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              {discriminator.field.charAt(0).toUpperCase() + discriminator.field.slice(1)}
            </label>
            <div className="flex flex-wrap gap-1">
              {Object.keys(discriminator.variants).map((v) => {
                const isActive = v === discValue;
                const color = DISC_PILL_COLORS[v] ?? DISC_DEFAULT_PILL;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => !readOnly && onUpdate({ [discriminator.field]: v })}
                    disabled={readOnly}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-all',
                      isActive
                        ? `${color.bg} ${color.text} ring-1 ring-offset-0 ${color.bg.replace('bg-', 'ring-').replace('100', '300')}`
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100',
                      readOnly && 'opacity-60 cursor-not-allowed',
                    )}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Field inputs */}
        {fields.map((field) => {
          const key = field.path.split('.').pop() ?? field.path;
          return (
            <ArrayItemField
              key={key}
              field={field}
              value={item[key]}
              fieldPath={`${itemPath}.${key}`}
              config={config}
              atStepId={atStepId}
              readOnly={readOnly}
              onChange={(val) => handleFieldChange(key, val)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ArrayItemFieldProps {
  field: SchemaFormField;
  value: unknown;
  /** Path of this field within the step config (e.g. `form.fields.1.options`). */
  fieldPath: string;
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
  onChange: (value: unknown) => void;
}

function ArrayItemField({
  field,
  value,
  fieldPath,
  config,
  atStepId,
  readOnly,
  onChange,
}: ArrayItemFieldProps) {
  const inputClasses = 'w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-[12px] bg-white text-slate-700 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100';
  const isAttachmentField = field.format === 'attachment';

  const renderInput = () => {
    if (isAttachmentField) {
      return (
        <VariableRefInput
          value={value}
          onChange={onChange}
          config={config}
          atStepId={atStepId}
          placeholder="{{ select files }}"
          disabled={readOnly}
          compact
          filterType="attachment[]"
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
            className={inputClasses}
          />
        );

      case 'array': {
        // An array of objects nested inside an array row — e.g. a Wait step's
        // `form.fields[].options[]`. Recurse into the same editor the top level
        // uses; without this it fell through to raw JSON (or, for a single
        // object, to VariableRefInput, which stringified it to "[object Object]").
        const item = field.itemSchema;
        if (item && (item['type'] === 'object' || item['anyOf'] || item['oneOf'])) {
          return (
            <ArrayOfObjectsEditor
              itemSchema={item}
              value={Array.isArray(value) ? (value as Record<string, unknown>[]) : undefined}
              onChange={onChange}
              config={config}
              atStepId={atStepId}
              arrayPath={fieldPath}
              readOnly={readOnly}
            />
          );
        }
        return (
          <textarea
            value={value ? JSON.stringify(value, null, 2) : ''}
            onChange={(e) => {
              try { onChange(JSON.parse(e.target.value)); }
              catch { /* invalid JSON */ }
            }}
            disabled={readOnly}
            rows={3}
            className={cn(inputClasses, 'font-mono text-[11px]')}
            placeholder="[]"
          />
        );
      }

      case 'object': {
        // A nested object inside an array row. VariableRefInput would render it
        // through String(), which is where "[object Object]" came from.
        const nested = itemSchemaToFields(field.itemSchema ?? {});
        const current = (value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : {}) as Record<string, unknown>;
        if (nested.length > 0) {
          return (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-2">
              {nested.map((sub) => {
                const subKey = sub.path.split('.').pop() ?? sub.path;
                return (
                  <ArrayItemField
                    key={subKey}
                    field={sub}
                    value={current[subKey]}
                    fieldPath={`${fieldPath}.${subKey}`}
                    config={config}
                    atStepId={atStepId}
                    readOnly={readOnly}
                    onChange={(val) => onChange({ ...current, [subKey]: val })}
                  />
                );
              })}
            </div>
          );
        }
        return (
          <textarea
            value={value ? JSON.stringify(value, null, 2) : ''}
            onChange={(e) => {
              try { onChange(JSON.parse(e.target.value)); }
              catch { /* invalid JSON */ }
            }}
            disabled={readOnly}
            rows={3}
            className={cn(inputClasses, 'font-mono text-[11px]')}
            placeholder="{}"
          />
        );
      }

      default:
        return (
          <VariableRefInput
            value={value}
            onChange={onChange}
            config={config}
            atStepId={atStepId}
            placeholder={field.placeholder ?? field.description}
            disabled={readOnly}
            compact
            filterType={field.type}
          />
        );
    }
  };

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
        {field.label}
        {field.required && <span className="text-red-400 text-[10px]">*</span>}
        {field.description && (
          <span className="ml-auto text-[10px] font-normal text-slate-400 truncate max-w-[50%]" title={field.description}>
            {field.description}
          </span>
        )}
      </label>
      {renderInput()}
    </div>
  );
}
