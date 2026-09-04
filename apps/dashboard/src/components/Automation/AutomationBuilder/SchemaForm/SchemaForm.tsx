import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Button } from '../../../ui/Button/Button';
import Input from '../../../ui/Input/Input';
import { VariableAwareInput } from './VariableAwareInput';
import Textarea from '../../../ui/Textarea/Textarea';
import { Checkbox } from '../../../ui/Checkbox/Checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import { MultiSelect } from '../../../ui/MultiSelect/MultiSelect';
import type { JsonSchema, ValidationIssue } from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import { findSoleMatchingVariable } from '../VariablePicker/VariablePicker.utils';
import type { SchemaFormProps } from './SchemaForm.types';
import { ReferenceChip, UseVariableButton } from './VariableFieldParts';
import { EntityField, MultiEntityField } from './EntityField';
import { AutomationRichTextField } from './AutomationRichTextField';
import { ChipArrayField } from './ChipArrayField';
import {
  coerceNumber,
  detectEntityArrayKind,
  detectEntityKind,
  detectFieldKind,
  EntityKind,
  getVariableRefInner,
  isRichTextField,
  isVariableRefValue,
  issuesForField,
  joinPath,
  labelForFieldKey,
  resolveSchema,
} from './SchemaForm.utils';

export function SchemaForm(props: SchemaFormProps): React.ReactElement {
  const root = useMemo(() => resolveSchema(props.schema), [props.schema]);
  return (
    <ObjectFields
      schema={root}
      value={props.value}
      onChange={props.onChange}
      issues={props.issues ?? null}
      pathPrefix={props.pathPrefix}
      variableSources={props.variableSources ?? []}
    />
  );
}

interface ObjectFieldsProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
}

interface DiscriminatorMeta {
  field: string;
  valueFields: string[];
  schemas: Record<string, { fieldKey?: string; schema: JsonSchema }>;
}

function readDiscriminator(schema: JsonSchema): DiscriminatorMeta | null {
  const raw = (schema as unknown as Record<string, unknown>)['x-discriminator'];
  if (!raw || typeof raw !== 'object') return null;
  const meta = raw as Partial<DiscriminatorMeta>;
  if (
    typeof meta.field !== 'string' ||
    !Array.isArray(meta.valueFields) ||
    !meta.schemas ||
    typeof meta.schemas !== 'object'
  ) {
    return null;
  }
  return meta as DiscriminatorMeta;
}

function ObjectFields({
  schema,
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
}: ObjectFieldsProps): React.ReactElement {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return <div className='text-xs text-muted-foreground italic'>No configuration required.</div>;
  }

  const handleFieldChange = (key: string, next: unknown): void => {
    onChange({ ...value, [key]: next });
  };

  const discriminator = readDiscriminator(schema);
  const discriminatorValue =
    discriminator && typeof value[discriminator.field] === 'string'
      ? (value[discriminator.field] as string)
      : null;
  const valueOverride =
    discriminator && discriminatorValue ? discriminator.schemas[discriminatorValue] : null;

  return (
    <div className='flex flex-col gap-4'>
      {entries.map(([key, childSchema]) => {
        const isDiscriminatedValueSlot =
          !!valueOverride && !!discriminator && discriminator.valueFields.includes(key);
        const effectiveSchema = isDiscriminatedValueSlot
          ? valueOverride.schema
          : resolveSchema(childSchema);
        const effectiveFieldKey =
          isDiscriminatedValueSlot && valueOverride.fieldKey ? valueOverride.fieldKey : key;
        return (
          <Field
            key={key}
            fieldKey={effectiveFieldKey}
            displayLabel={isDiscriminatedValueSlot ? humanise(key) : undefined}
            schema={effectiveSchema}
            required={required.has(key)}
            value={value[key]}
            onChange={next => handleFieldChange(key, next)}
            issues={issues}
            pathPrefix={pathPrefix}
            variableSources={variableSources}
          />
        );
      })}
    </div>
  );
}

interface FieldProps {
  fieldKey: string;
  displayLabel?: string | undefined;
  schema: JsonSchema;
  required: boolean;
  value: unknown;
  onChange: (next: unknown) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
}

function Field({
  fieldKey,
  displayLabel,
  schema,
  required,
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
}: FieldProps): React.ReactElement {
  const kind = detectFieldKind(schema);
  const label = displayLabel ?? schema.title ?? labelForFieldKey(fieldKey) ?? humanise(fieldKey);
  const description = sanitiseDescription(schema.description);
  const fieldIssues = issuesForField(issues, pathPrefix, fieldKey);
  const errorMessage = fieldIssues.length > 0 ? fieldIssues[0]?.message : undefined;
  const hasError = !!errorMessage;
  const labelText = required ? `${label} *` : label;
  const entityKind = detectEntityKind(fieldKey);

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    const isUnset = value === undefined || value === null || value === '';
    if (isUnset && schema.default !== undefined && schema.default !== null) {
      seededRef.current = true;
      onChange(schema.default);
      return;
    }

    if (isUnset && entityKind && variableSources.length > 0) {
      const sole = findSoleMatchingVariable(variableSources, entityKind);
      if (sole) {
        seededRef.current = true;
        onChange(sole.reference);
      }
    }
  }, [entityKind, onChange, schema.default, value, variableSources]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const insertAtCursor = (text: string): void => {
    const current = typeof value === 'string' ? value : '';
    const el = containerRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      'textarea, input',
    );
    if (!el) {
      onChange(current + text);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? start;
    const next = current.slice(0, start) + text + current.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + text.length;
      try {
        el.setSelectionRange(cursor, cursor);
      } catch {
        /* Intentionally ignored. */
      }
    });
  };

  if (kind === 'variableRef') {
    const inner = getVariableRefInner(schema);
    const innerKind = inner ? detectFieldKind(inner) : 'string';
    const isRef = isVariableRefValue(value);
    const isTextField = innerKind === 'string' || innerKind === 'textarea';
    const usesRichTextEditor = !entityKind && isRichTextField(fieldKey);
    const supportsInlineInsert = !entityKind && (usesRichTextEditor || isTextField);
    const fieldHeaderDescription = inner?.description ?? description;
    const inputPlaceholder =
      fieldKey === 'title'
        ? 'AI Generated Title'
        : schema.description
          ? ''
          : `Enter ${label.toLowerCase()}`;

    if (supportsInlineInsert) {
      if (usesRichTextEditor) {
        return (
          <div className='flex flex-col gap-1'>
            <FieldHeader label={labelText} description={fieldHeaderDescription} />
            <AutomationRichTextField
              value={typeof value === 'string' ? value : ''}
              onChange={next => onChange(next)}
              variableSources={variableSources}
              placeholder={`Enter ${label.toLowerCase()}…`}
            />
            {hasError && <FieldError message={errorMessage} />}
          </div>
        );
      }
      if (isRef) {
        return (
          <div className='flex flex-col gap-1'>
            <FieldHeader label={labelText} description={fieldHeaderDescription} />
            <ReferenceChip
              value={value}
              sources={variableSources}
              onClear={() => onChange(undefined)}
            />
            {hasError && <FieldError message={errorMessage} />}
          </div>
        );
      }
      return (
        <div className='flex flex-col gap-1' ref={containerRef}>
          <FieldHeader label={labelText} description={fieldHeaderDescription} />
          <div className='flex items-start gap-2'>
            <div className='flex-1'>
              <RawInput
                kind={innerKind}
                schema={inner ?? schema}
                value={value}
                onChange={onChange}
                placeholder={inputPlaceholder}
                error={hasError}
                variableSources={variableSources}
              />
            </div>
            {variableSources.length > 0 ? (
              <UseVariableButton sources={variableSources} onPick={insertAtCursor} />
            ) : null}
          </div>
          {hasError && <FieldError message={errorMessage} />}
        </div>
      );
    }

    return (
      <div className='flex flex-col gap-1'>
        <FieldHeader label={labelText} description={fieldHeaderDescription} />
        {isRef ? (
          <ReferenceChip
            value={value}
            sources={variableSources}
            onClear={() => onChange(undefined)}
          />
        ) : (
          <div className='flex items-start gap-2'>
            <div className='flex-1'>
              {entityKind ? (
                <EntityField
                  kind={entityKind}
                  value={typeof value === 'string' ? value : undefined}
                  onChange={onChange}
                  placeholder={`Pick a ${entityKindLabel(entityKind)}`}
                />
              ) : (
                <RawInput
                  kind={innerKind}
                  schema={inner ?? schema}
                  value={value}
                  onChange={onChange}
                  placeholder={inputPlaceholder}
                  error={hasError}
                  variableSources={variableSources}
                />
              )}
            </div>
            {variableSources.length > 0 ? (
              <UseVariableButton
                sources={variableSources}
                onPick={reference => onChange(reference)}
                targetEntityKind={entityKind ?? null}
              />
            ) : null}
          </div>
        )}
        {hasError && <FieldError message={errorMessage} />}
      </div>
    );
  }

  if (kind === 'string' || kind === 'textarea') {
    if (entityKind) {
      const isRef = isVariableRefValue(value);
      return (
        <div className='flex flex-col gap-1'>
          <FieldHeader label={labelText} description={description} />
          {isRef ? (
            <ReferenceChip
              value={value}
              sources={variableSources}
              onClear={() => onChange(undefined)}
            />
          ) : (
            <div className='flex items-start gap-2'>
              <div className='flex-1'>
                <EntityField
                  kind={entityKind}
                  value={typeof value === 'string' ? value : undefined}
                  onChange={onChange}
                  placeholder={`Pick a ${entityKindLabel(entityKind)}`}
                />
              </div>
              {variableSources.length > 0 ? (
                <UseVariableButton
                  sources={variableSources}
                  onPick={reference => onChange(reference)}
                  targetEntityKind={entityKind}
                />
              ) : null}
            </div>
          )}
          {hasError && <FieldError message={errorMessage} />}
        </div>
      );
    }

    return (
      <div className='flex flex-col gap-1' ref={containerRef}>
        <FieldHeader label={labelText} description={description} />
        <div className='flex items-start gap-2'>
          <div className='flex-1'>
            <RawInput
              kind={kind}
              schema={schema}
              value={value}
              onChange={onChange}
              placeholder={`Enter ${label.toLowerCase()}`}
              error={hasError}
              variableSources={variableSources}
            />
          </div>
          {variableSources.length > 0 ? (
            <UseVariableButton sources={variableSources} onPick={insertAtCursor} />
          ) : null}
        </div>
        {hasError && <FieldError message={errorMessage} />}
      </div>
    );
  }

  if (kind === 'array') {
    const entityArrayKind = detectEntityArrayKind(fieldKey);
    if (entityArrayKind) {
      const arrayValue = Array.isArray(value)
        ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      return (
        <div className='flex flex-col gap-1'>
          <FieldHeader label={labelText} description={description} />
          <MultiEntityField
            kind={entityArrayKind}
            value={arrayValue}
            onChange={next => onChange(next)}
            placeholder={`Pick ${entityKindLabel(entityArrayKind)}s`}
          />
          {hasError && <FieldError message={errorMessage} />}
        </div>
      );
    }

    const itemSchemaRaw = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    const itemSchema = itemSchemaRaw ? resolveSchema(itemSchemaRaw) : undefined;
    const enumValues = itemSchema && Array.isArray(itemSchema.enum) ? itemSchema.enum : null;
    if (enumValues && enumValues.length > 0) {
      const arrayValue = Array.isArray(value)
        ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      const options = enumValues.map(v => ({ value: String(v), label: String(v) }));
      return (
        <div className='flex flex-col gap-1'>
          <FieldHeader label={labelText} description={description} />
          <MultiSelect
            options={options}
            selectedValues={arrayValue}
            onChange={next => onChange(next)}
            placeholder={`Pick ${label.toLowerCase()}…`}
          />
          {hasError && <FieldError message={errorMessage} />}
        </div>
      );
    }

    const itemKind = itemSchema ? itemSchema.type : undefined;
    const itemIsRef = !!(itemSchema && itemSchema.$ref);
    if (itemKind === 'string' && !itemIsRef) {
      const arrayValue = Array.isArray(value)
        ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      return (
        <div className='flex flex-col gap-1'>
          <FieldHeader label={labelText} description={description} />
          <ChipArrayField
            value={arrayValue}
            onChange={next => onChange(next)}
            placeholder={
              fieldKey === 'fromDomains'
                ? 'e.g. acme.com — Enter to add'
                : fieldKey === 'fromEmails'
                  ? 'e.g. alice@acme.com — Enter to add'
                  : 'Type and press Enter'
            }
            error={hasError}
          />
          {hasError && <FieldError message={errorMessage} />}
        </div>
      );
    }

    return (
      <ArrayField
        schema={schema}
        value={Array.isArray(value) ? (value as unknown[]) : []}
        onChange={onChange}
        labelText={labelText}
        description={description}
        issues={issues}
        pathPrefix={pathPrefix}
        fieldKey={fieldKey}
        variableSources={variableSources}
        error={hasError}
        errorMessage={errorMessage}
      />
    );
  }

  if (kind === 'object') {
    const nestedValue =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return (
      <div className='flex flex-col gap-2 rounded-lg border border-border bg-background/40 px-3 py-3'>
        <FieldHeader label={labelText} description={description} />
        <ObjectFields
          schema={schema}
          value={nestedValue}
          onChange={onChange as (v: Record<string, unknown>) => void}
          issues={issues}
          pathPrefix={`${joinPath(pathPrefix, fieldKey)}.`}
          variableSources={variableSources}
        />
        {hasError && <FieldError message={errorMessage} />}
      </div>
    );
  }

  if (kind === 'record') {
    const mapValue =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return (
      <div className='flex flex-col gap-2 rounded-lg border border-border bg-background/40 px-3 py-3'>
        <FieldHeader label={labelText} description={description} />
        <RecordField
          schema={schema}
          value={mapValue}
          onChange={onChange as (v: Record<string, unknown>) => void}
          pathPrefix={`${joinPath(pathPrefix, fieldKey)}.`}
          variableSources={variableSources}
        />
        {hasError && <FieldError message={errorMessage} />}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-1'>
      <FieldHeader label={labelText} description={description} />
      <RawInput
        kind={kind}
        schema={schema}
        value={value}
        onChange={onChange}
        placeholder={`Enter ${label.toLowerCase()}`}
        error={hasError}
      />
      {hasError && <FieldError message={errorMessage} />}
    </div>
  );
}

function FieldHeader({
  label,
  description,
}: {
  label: string;
  description?: string | undefined;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-xs font-medium text-foreground'>{label}</span>
      {description ? (
        <span className='text-[11px] text-muted-foreground'>{description}</span>
      ) : null}
    </div>
  );
}

function FieldError({ message }: { message?: string | undefined }): React.ReactElement | null {
  if (!message) return null;
  return <span className='text-[11px] text-red-600'>{message}</span>;
}

interface RawInputProps {
  kind: ReturnType<typeof detectFieldKind>;
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  placeholder?: string | undefined;
  error?: boolean | undefined;
  variableSources?: VariablePickerSource[];
}

function RawInput({
  kind,
  schema,
  value,
  onChange,
  placeholder,
  error,
  variableSources,
}: RawInputProps): React.ReactElement {
  if (kind === 'enum' && Array.isArray(schema.enum)) {
    const items = schema.enum.map(option => ({
      label: primitiveToString(option),
      value: primitiveToString(option),
    }));
    const selected = primitiveToString(value);
    return (
      <Select value={selected} onValueChange={v => onChange(v)}>
        <SelectTrigger
          className={cn('w-full', error && 'border-destructive')}
          aria-invalid={error ? true : undefined}
        >
          <SelectValue placeholder={placeholder ?? 'Select…'} />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (kind === 'boolean') {
    return (
      <Checkbox
        checked={value === true}
        onChange={checked => onChange(checked === true)}
        label={
          schema.description ? (sanitiseDescription(schema.description) ?? 'Enabled') : 'Enabled'
        }
      />
    );
  }

  if (kind === 'number' || kind === 'integer') {
    return (
      <Input
        type='number'
        placeholder={placeholder ?? ''}
        value={primitiveToString(value)}
        onChange={e => onChange(coerceNumber(e.target.value, kind))}
        aria-invalid={error ? true : undefined}
      />
    );
  }

  if (kind === 'datetime') {
    return (
      <Input
        type='datetime-local'
        placeholder={placeholder ?? ''}
        value={typeof value === 'string' ? value : ''}
        onChange={e => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
    );
  }

  if (kind === 'textarea') {
    return (
      <Textarea
        placeholder={placeholder ?? ''}
        value={typeof value === 'string' ? value : ''}
        onChange={e => onChange(e.target.value)}
        rows={3}
        aria-invalid={error ? true : undefined}
      />
    );
  }

  if (variableSources && variableSources.length > 0) {
    return (
      <VariableAwareInput
        placeholder={placeholder ?? ''}
        value={typeof value === 'string' ? value : ''}
        onChange={next => onChange(next)}
        variableSources={variableSources}
        ariaInvalid={!!error}
        showVariableButton={false}
      />
    );
  }

  return (
    <Input
      placeholder={placeholder ?? ''}
      value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value)}
      aria-invalid={error ? true : undefined}
    />
  );
}

interface ArrayFieldProps {
  schema: JsonSchema;
  value: unknown[];
  onChange: (next: unknown) => void;
  labelText: string;
  description?: string | undefined;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  fieldKey: string;
  variableSources: VariablePickerSource[];
  error?: boolean | undefined;
  errorMessage?: string | undefined;
}

function ArrayField({
  schema,
  value,
  onChange,
  labelText,
  description,
  issues,
  pathPrefix,
  fieldKey,
  variableSources,
}: ArrayFieldProps): React.ReactElement {
  const itemSchemaRaw = Array.isArray(schema.items) ? schema.items[0] : schema.items;
  const itemSchema = itemSchemaRaw ? resolveSchema(itemSchemaRaw) : { type: 'string' as const };

  const handleAdd = (): void => {
    onChange([...value, defaultValueFor(itemSchema)]);
  };

  const handleRemove = (index: number): void => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleChangeAt = (index: number, next: unknown): void => {
    const copy = value.slice();
    copy[index] = next;
    onChange(copy);
  };

  return (
    <div className='flex flex-col gap-2 rounded-lg border border-border bg-background/40 px-3 py-3'>
      <FieldHeader label={labelText} description={description} />
      {value.length === 0 ? (
        <div className='text-[11px] text-muted-foreground italic'>No entries.</div>
      ) : (
        <div className='flex flex-col gap-2'>
          {value.map((item, index) => (
            <div key={index} className='flex items-start gap-2'>
              <div className='flex-1'>
                <Field
                  fieldKey={String(index)}
                  schema={itemSchema}
                  required={false}
                  value={item}
                  onChange={next => handleChangeAt(index, next)}
                  issues={issues}
                  pathPrefix={`${joinPath(pathPrefix, fieldKey)}`}
                  variableSources={variableSources}
                />
              </div>
              <button
                type='button'
                onClick={() => handleRemove(index)}
                aria-label='Remove entry'
                data-track-category='automation-builder'
                data-track-name='schema-form-array-remove'
                className='mt-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-500/10'
              >
                <Trash2 className='size-4' />
              </button>
            </div>
          ))}
        </div>
      )}
      <Button
        variant='outline'
        size='sm'
        onClick={handleAdd}
        data-track-category='automation-builder'
        data-track-name='ADD_SCHEMA_FIELD'
        className='self-start'
      >
        <Plus className='size-4' />
        Add entry
      </Button>
    </div>
  );
}

interface RecordFieldProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
}

function RecordField({
  schema,
  value,
  onChange,
  pathPrefix,
  variableSources,
}: RecordFieldProps): React.ReactElement {
  const valueSchema: JsonSchema =
    typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null
      ? schema.additionalProperties
      : { type: 'string' };
  const valueKind = detectFieldKind(valueSchema);

  const entries = Object.entries(value);

  const handleRenameKey = (oldKey: string, newKey: string): void => {
    if (!newKey || oldKey === newKey) return;
    if (Object.prototype.hasOwnProperty.call(value, newKey)) return; // collision guard
    const next: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(next);
  };

  const handleValueChange = (key: string, next: unknown): void => {
    onChange({ ...value, [key]: next });
  };

  const handleDelete = (key: string): void => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const handleAdd = (): void => {
    let i = entries.length + 1;
    while (Object.prototype.hasOwnProperty.call(value, `key_${i}`)) i++;
    const defaultValue =
      valueKind === 'boolean' ? false : valueKind === 'number' || valueKind === 'integer' ? 0 : '';
    onChange({ ...value, [`key_${i}`]: defaultValue });
  };

  return (
    <div className='flex flex-col gap-2'>
      {entries.length === 0 && (
        <div className='rounded-md border border-dashed border-border bg-muted/20 px-3 py-3 text-center text-xs text-muted-foreground'>
          No entries yet. Click &ldquo;Add row&rdquo; to create one.
        </div>
      )}
      {entries.map(([key, v]) => (
        <RecordRow
          key={key}
          fieldKey={key}
          fieldValue={v}
          valueSchema={valueSchema}
          onRenameKey={newKey => handleRenameKey(key, newKey)}
          onChangeValue={next => handleValueChange(key, next)}
          onDelete={() => handleDelete(key)}
          pathPrefix={pathPrefix}
          variableSources={variableSources}
        />
      ))}
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={handleAdd}
        data-track-category='automation-builder'
        data-track-name='ADD_SCHEMA_FIELD'
        className='self-start'
      >
        <Plus className='mr-1 size-3.5' />
        Add row
      </Button>
    </div>
  );
}

function RecordRow({
  fieldKey,
  fieldValue,
  valueSchema,
  onRenameKey,
  onChangeValue,
  onDelete,
  pathPrefix,
  variableSources,
}: {
  fieldKey: string;
  fieldValue: unknown;
  valueSchema: JsonSchema;
  onRenameKey: (k: string) => void;
  onChangeValue: (v: unknown) => void;
  onDelete: () => void;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
}): React.ReactElement {
  const [draftKey, setDraftKey] = useState(fieldKey);
  return (
    <div className='flex items-start gap-2'>
      <Input
        value={draftKey}
        onChange={e => setDraftKey(e.target.value)}
        onBlur={() => onRenameKey(draftKey)}
        placeholder='key'
        className='w-[200px] font-mono text-sm'
      />
      <div className='flex-1'>
        <Field
          fieldKey={fieldKey}
          schema={valueSchema}
          required={false}
          value={fieldValue}
          onChange={onChangeValue}
          issues={null}
          pathPrefix={pathPrefix}
          variableSources={variableSources}
          displayLabel=' '
        />
      </div>
      <button
        type='button'
        onClick={onDelete}
        aria-label='Remove row'
        data-track-category='automation-builder'
        data-track-name='schema-form-record-remove-row'
        className='flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground'
      >
        <Trash2 className='size-4' />
      </button>
    </div>
  );
}

function humanise(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^(.)/, c => c.toUpperCase());
}

function sanitiseDescription(description?: string): string | undefined {
  if (!description) return undefined;
  if (description.startsWith('__variableRef__')) {
    return undefined;
  }
  return description;
}

function defaultValueFor(schema: JsonSchema): unknown {
  if (schema.type === 'string') return '';
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') return [];
  if (schema.type === 'object') return {};
  return '';
}

function primitiveToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

function entityKindLabel(kind: EntityKind): string {
  if (kind === EntityKind.USER) return 'user';
  if (kind === EntityKind.USER_GROUP) return 'user group';
  if (kind === EntityKind.CHANNEL) return 'channel';
  if (kind === EntityKind.BOARD) return 'board';
  if (kind === EntityKind.STAGE) return 'stage';
  if (kind === EntityKind.SENDER) return 'sender';
  if (kind === EntityKind.CONVERSATION) return 'conversation';
  return 'project';
}
