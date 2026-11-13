import { useCallback, useMemo, useState } from 'react';
import { validateTriggerPayload } from '@xyne/workflow-sdk/common';

// ─── Field descriptor ───

export interface SchemaFormField {
  path: string;
  label: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  required: boolean;
  acceptsVariableRef: boolean;
  enumValues?: string[];
  defaultValue?: unknown;
  description?: string;
  placeholder?: string;
  format?: string;
  section?: string;
  /** For a `credential-name` field: the credential types it accepts. Absent means any. */
  credentialTypes?: string[];
  /**
   * The field offers choices rather than free text: the step or trigger that owns
   * it answers `getOptions`, and the editor shows a picker. Emitted by the SDK
   * wherever the config schema wraps a field in `withOptions` — never written by
   * hand. The value stored is still just the id the picker returns.
   */
  hasOptions?: boolean;
  children?: SchemaFormField[];
  itemSchema?: Record<string, unknown>;
  /** Attachment-field constraints (single: on the field; multiple: accept/maxSize live on itemSchema). */
  accept?: string[];
  maxSize?: number;
  minItems?: number;
  maxItems?: number;
  /** Present when type=object has additionalProperties — indicates a Record/Map type */
  additionalPropertiesSchema?: Record<string, unknown>;
  /** Present for discriminated unions (anyOf/oneOf with const discriminator) */
  discriminator?: {
    field: string;
    /** Map of discriminator value → fields for that variant */
    variants: Record<string, SchemaFormField[]>;
  };
}

// ─── JSON Schema → field list ───

function schemaToFields(
  schema: Record<string, unknown>,
  parentPath: string,
  requiredKeys: ReadonlySet<string>,
): SchemaFormField[] {
  const properties = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
  if (properties) {
    const fields: SchemaFormField[] = [];
    for (const [key, prop] of Object.entries(properties)) {
      const path = parentPath ? `${parentPath}.${key}` : key;
      const field = propToField(prop, path, key, requiredKeys.has(key));
      if (field) fields.push(field);
    }
    return fields;
  }

  // Root-level discriminated union (e.g. Wait step: z.discriminatedUnion('mode', [...]))
  const disc = detectDiscriminatedUnion(schema, parentPath);
  if (disc) {
    return [{
      path: parentPath,
      label: formatLabel(disc.field),
      type: 'object',
      required: true,
      acceptsVariableRef: false,
      discriminator: disc,
    }];
  }

  return [];
}

function propToField(
  prop: Record<string, unknown>,
  path: string,
  key: string,
  required: boolean,
): SchemaFormField | null {
  // A field that also accepts `{{...}}`: the SDK marks the union it builds.
  const acceptsVariableRef = detectVariableRef(prop);
  const resolved = acceptsVariableRef ? unwrapVariableRef(prop) : prop;

  // Detect discriminated union (anyOf with const discriminator) before resolving type
  const discUnion = detectDiscriminatedUnion(resolved, path);

  const type = discUnion ? 'object' : resolveType(resolved);
  if (!type) return null;

  const field: SchemaFormField = {
    path,
    label: (resolved['title'] as string | undefined) ?? formatLabel(key),
    type,
    required,
    acceptsVariableRef,
  };

  const description = resolved['description'] as string | undefined;
  if (description) field.description = description;
  if (resolved['default'] !== undefined) field.defaultValue = resolved['default'];
  // Host/step decorators attach UI-only formats to the outer schema property.
  // Preserve that metadata when variableRef() is unwrapped to its real value type.
  const format = (prop['format'] ?? resolved['format']) as string | undefined;
  if (format) field.format = format;
  const credentialTypes = prop['credentialTypes'] ?? resolved['credentialTypes'];
  if (Array.isArray(credentialTypes)) field.credentialTypes = credentialTypes as string[];
  if (prop['hasOptions'] === true || resolved['hasOptions'] === true) field.hasOptions = true;
  if (Array.isArray(resolved['accept'])) field.accept = resolved['accept'] as string[];
  if (typeof resolved['maxSize'] === 'number') field.maxSize = resolved['maxSize'];
  if (typeof resolved['minItems'] === 'number') field.minItems = resolved['minItems'];
  if (typeof resolved['maxItems'] === 'number') field.maxItems = resolved['maxItems'];

  if (resolved['enum']) {
    field.enumValues = resolved['enum'] as string[];
  }

  if (discUnion) {
    // Discriminated union — variant fields are in the discriminator, not children
    field.discriminator = discUnion;
  } else if (type === 'object') {
    // Regular object — check for additionalProperties (Record/Map type)
    const addlProps = resolved['additionalProperties'];
    if (addlProps && typeof addlProps === 'object' && !Array.isArray(addlProps)) {
      field.additionalPropertiesSchema = addlProps as Record<string, unknown>;
    }
    const reqSet = new Set((resolved['required'] as string[] | undefined) ?? []);
    field.children = schemaToFields(resolved, path, reqSet);
  }

  if (type === 'array' && resolved['items']) {
    field.itemSchema = resolved['items'] as Record<string, unknown>;
  }

  return field;
}

const VALID_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

function resolveType(prop: Record<string, unknown>): SchemaFormField['type'] | null {
  const t = prop['type'] as string | undefined;
  if (t && VALID_TYPES.has(t)) return t as SchemaFormField['type'];

  // For anyOf/oneOf without top-level type (non-discriminated unions like `body`):
  // prefer 'string' if any variant is string (renders as textarea), else first variant type
  const variants = (prop['anyOf'] ?? prop['oneOf']) as Record<string, unknown>[] | undefined;
  if (variants && variants.length > 0) {
    if (variants.some((v) => v['type'] === 'string')) return 'string';
    const first = variants[0]!['type'] as string | undefined;
    if (first && VALID_TYPES.has(first)) return first as SchemaFormField['type'];
    return 'string';
  }

  return null;
}

function detectVariableRef(prop: Record<string, unknown>): boolean {
  // The SDK marks the union `variableRef()` builds. The flag is the fact —
  // there is no sentence to parse, and `description` is the author's again.
  return prop['isVariableRef'] === true;
}

function unwrapVariableRef(prop: Record<string, unknown>): Record<string, unknown> {
  const variants = (prop['anyOf'] ?? prop['oneOf']) as Record<string, unknown>[] | undefined;
  if (!variants) return prop;
  // The real schema is the variant that is not the `{{ref}}` string — that one
  // is the only member carrying the reference pattern.
  const real = variants.find((v) => typeof v['pattern'] !== 'string');
  return real ?? variants[0] ?? prop;
}

/**
 * Detect discriminated union: anyOf/oneOf where all variants are objects and
 * share a common property with `const` values (the discriminator field).
 */
function detectDiscriminatedUnion(
  prop: Record<string, unknown>,
  path: string,
): SchemaFormField['discriminator'] | null {
  const variants = (prop['anyOf'] ?? prop['oneOf']) as Record<string, unknown>[] | undefined;
  if (!variants || variants.length < 2) return null;

  // All variants must be objects
  if (!variants.every((v) => v['type'] === 'object')) return null;

  // Find a common property that has a `const` value in every variant
  const firstProps = (variants[0]!['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  let discField: string | null = null;

  for (const [fieldName, fieldSchema] of Object.entries(firstProps)) {
    if (fieldSchema['const'] === undefined) continue;
    const allHaveConst = variants.every((v) => {
      const vProps = (v['properties'] ?? {}) as Record<string, Record<string, unknown>>;
      return vProps[fieldName]?.['const'] !== undefined;
    });
    if (allHaveConst) { discField = fieldName; break; }
  }

  if (!discField) return null;

  // Build variant map: constValue → fields (excluding discriminator field itself)
  const variantMap: Record<string, SchemaFormField[]> = {};
  for (const variant of variants) {
    const vProps = (variant['properties'] ?? {}) as Record<string, Record<string, unknown>>;
    const constVal = String(vProps[discField]!['const']);
    const vRequired = new Set((variant['required'] as string[] | undefined) ?? []);

    const fields: SchemaFormField[] = [];
    for (const [vKey, vProp] of Object.entries(vProps)) {
      if (vKey === discField) continue;
      const vPath = path ? `${path}.${vKey}` : vKey;
      const f = propToField(vProp, vPath, vKey, vRequired.has(vKey));
      if (f) fields.push(f);
    }
    variantMap[constVal] = fields;
  }

  return { field: discField, variants: variantMap };
}

function formatLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Public helpers ───

/**
 * Convert a JSON Schema (typically from field.itemSchema) into SchemaFormField[].
 * Used by renderers to build structured editors for array items.
 */
export function itemSchemaToFields(schema: Record<string, unknown>, basePath = ''): SchemaFormField[] {
  const reqSet = new Set((schema['required'] as string[] | undefined) ?? []);
  return schemaToFields(schema, basePath, reqSet);
}

/**
 * Detect a discriminated union from a JSON Schema (anyOf/oneOf with const discriminator).
 * Returns null if the schema is not a discriminated union.
 */
export function detectItemDiscriminatedUnion(
  schema: Record<string, unknown>,
  basePath = '',
): SchemaFormField['discriminator'] | null {
  return detectDiscriminatedUnion(schema, basePath);
}

// ─── Section layout (`x-layout`) ───

/**
 * The schema keyword that carries the trigger modal's section layout.
 */
export const LAYOUT_KEY = 'x-layout';

/**
 * One rendered block of the form: an optional heading plus the fields under it.
 */
export interface LayoutGroup {
  title: string | null;
  fieldNames: string[];
}

/**
 * How to read a layout. Display (the default) drops empty sections and merges
 * adjacent untitled blocks. Authoring keeps both — a just-added section is
 * empty, and merging would make clearing a heading swallow its neighbour.
 */
export interface LayoutOptions {
  authoring?: boolean;
}

function normalizeTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Collapse a layout to one canonical form: drop empty groups, merge runs of
 * adjacent untitled ones.
 *
 * Two untitled groups in a row look exactly like one, so without this a single
 * layout could be spelled many ways. Runs on read and on write, so what is
 * stored and what is drawn always agree.
 */
export function normalizeLayout(
  groups: readonly LayoutGroup[],
  opts?: LayoutOptions,
): LayoutGroup[] {
  const authoring = opts?.authoring === true;
  const out: LayoutGroup[] = [];
  for (const group of groups) {
    if (group.fieldNames.length === 0 && !(authoring && group.title !== null)) continue;
    const prev = out[out.length - 1];
    if (!authoring && prev && prev.title === null && group.title === null) {
      prev.fieldNames.push(...group.fieldNames);
      continue;
    }
    out.push({ title: group.title, fieldNames: [...group.fieldNames] });
  }
  return out;
}

/**
 * Read a schema's section layout — the one place `x-layout` is interpreted, so
 * the modal that renders it and the builder that authors it cannot disagree.
 *
 * Every rule assumes the layout may be stale or wrong:
 *
 * - **No usable `x-layout`** → one untitled group with every property, in
 *   declaration order. Schemas written before sections render as they always did.
 * - **A name that no longer exists** → skipped, so a deleted field leaves no hole.
 * - **A property listed nowhere** → appended at the end. A field must never go
 *   missing: hide a required one and the form can't be submitted.
 * - **A name listed twice** → first wins. A field renders once.
 * - **Empty groups** → dropped, so no heading stands over nothing.
 */
export function resolveLayout(
  schema: Record<string, unknown>,
  opts?: LayoutOptions,
): LayoutGroup[] {
  const properties = schema['properties'];
  const names =
    properties && typeof properties === 'object' && !Array.isArray(properties)
      ? Object.keys(properties as Record<string, unknown>)
      : [];
  const raw = schema[LAYOUT_KEY];

  if (names.length === 0 && !(opts?.authoring === true && Array.isArray(raw))) return [];
  if (!Array.isArray(raw)) {
    return names.length > 0 ? [{ title: null, fieldNames: names }] : [];
  }

  const known = new Set(names);
  const placed = new Set<string>();
  const groups: LayoutGroup[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { title, fields } = entry as { title?: unknown; fields?: unknown };
    if (!Array.isArray(fields)) continue;

    const fieldNames: string[] = [];
    for (const name of fields) {
      if (typeof name !== 'string') continue;
      if (!known.has(name) || placed.has(name)) continue;
      placed.add(name);
      fieldNames.push(name);
    }
    groups.push({ title: normalizeTitle(title), fieldNames });
  }

  const orphans = names.filter((name) => !placed.has(name));
  if (orphans.length > 0) groups.push({ title: null, fieldNames: orphans });

  const normalized = normalizeLayout(groups, opts);
  if (normalized.length > 0) return normalized;
  return names.length > 0 ? [{ title: null, fieldNames: names }] : [];
}

/**
 * Serialize groups back into the `x-layout` value, canonicalized. Returns
 * `undefined` when the layout carries no grouping information (a single
 * untitled group), so an unsectioned schema stays byte-identical to one
 * authored before this feature rather than gaining a redundant key.
 */
export function layoutToSchemaValue(
  groups: readonly LayoutGroup[],
  opts?: LayoutOptions,
): Array<{ title?: string; fields: string[] }> | undefined {
  const normalized = normalizeLayout(groups, opts);
  if (normalized.length === 0) return undefined;
  if (normalized.length === 1 && normalized[0]!.title === null) return undefined;
  return normalized.map((group) => ({
    ...(group.title === null ? {} : { title: group.title }),
    fields: [...group.fieldNames],
  }));
}

/**
 * Reorder a root field list into layout order and stamp each field's heading —
 * one decision, since the layout says both where a field sits and what it sits
 * under.
 *
 * Returns the input array unchanged when there is nothing to apply: no
 * `x-layout`, or no `properties` at all (a root-level discriminated union).
 * That keeps its memoized identity stable for callers with no layout.
 */export function applyLayout(
  fields: readonly SchemaFormField[],
  schema: Record<string, unknown>,
): SchemaFormField[] {
  const groups = resolveLayout(schema);
  if (groups.length === 0) return fields as SchemaFormField[];
  if (groups.length === 1 && groups[0]!.title === null) return fields as SchemaFormField[];

  const byName = new Map(fields.map((field) => [field.path, field]));
  const out: SchemaFormField[] = [];

  for (const group of groups) {
    for (const name of group.fieldNames) {
      const field = byName.get(name);
      if (!field) continue;
      byName.delete(name);
      out.push(group.title === null ? field : { ...field, section: group.title });
    }
  }

  for (const field of fields) if (byName.has(field.path)) out.push(field);
  return out;
}

/**
 * The render-ready form of a layout: groups carrying their actual fields. One
 * block per group, heading shown only when `title` is non-null.
 *
 * Groups come from the layout, not from `field.section` — two sections may
 * share a title, and grouping by label would silently fuse them.
 */
export function groupFieldsByLayout(
  fields: readonly SchemaFormField[],
  schema: Record<string, unknown>,
): Array<{ title: string | null; fields: SchemaFormField[] }> {
  const groups = resolveLayout(schema);
  if (groups.length === 0) return fields.length > 0 ? [{ title: null, fields: [...fields] }] : [];

  const byName = new Map(fields.map((field) => [field.path, field]));
  const out: Array<{ title: string | null; fields: SchemaFormField[] }> = [];

  for (const group of groups) {
    const picked: SchemaFormField[] = [];
    for (const name of group.fieldNames) {
      const field = byName.get(name);
      if (!field) continue;
      byName.delete(name);
      picked.push(field);
    }
    if (picked.length > 0) out.push({ title: group.title, fields: picked });
  }

  const unplaced = fields.filter((field) => byName.has(field.path));
  if (unplaced.length > 0) {
    const last = out[out.length - 1];
    if (last && last.title === null) last.fields.push(...unplaced);
    else out.push({ title: null, fields: unplaced });
  }

  return out;
}

// ─── Value access helpers ───

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

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  if (path === '') return (value as Record<string, unknown>) ?? {};
  const parts = path.split('.');
  const result = { ...obj };
  let target: Record<string, unknown> = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = target[part];
    const clone = (next !== null && typeof next === 'object') ? { ...(next as Record<string, unknown>) } : {};
    target[part] = clone;
    target = clone;
  }
  target[parts[parts.length - 1]!] = value;
  return result;
}

// ─── Hook ───

export interface UseSchemaFormOptions {
  schema: Record<string, unknown>;
  initialValues?: Record<string, unknown>;
  onChange?: (values: Record<string, unknown>) => void;
}

export interface UseSchemaFormReturn {
  fields: SchemaFormField[];
  values: Record<string, unknown>;
  errors: Record<string, string>;
  setFieldValue: (path: string, value: unknown) => void;
  validate: () => boolean;
  reset: (values?: Record<string, unknown>) => void;
}

export function useSchemaForm(opts: UseSchemaFormOptions): UseSchemaFormReturn {
  const { schema, initialValues, onChange } = opts;

  const [values, setValues] = useState<Record<string, unknown>>(initialValues ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fields = useMemo(() => {
    const requiredKeys = new Set((schema['required'] as string[] | undefined) ?? []);
    const built = schemaToFields(schema, '', requiredKeys);
    return applyLayout(built, schema);
  }, [schema]);

  const setFieldValue = useCallback(
    (path: string, value: unknown) => {
      setValues((prev) => {
        const next = setNestedValue(prev, path, value);
        onChange?.(next);
        return next;
      });
      // Clear error on edit
      setErrors((prev) => {
        if (!(path in prev)) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      });
    },
    [onChange],
  );

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    for (const field of fields) {
      if (field.required) {
        const val = getNestedValue(values, field.path);
        if (val === undefined || val === null || val === '') {
          newErrors[field.path] = `${field.label} is required`;
        }
      }
    }
    for (const e of validateTriggerPayload(schema, values)) {
      if (!newErrors[e.path]) newErrors[e.path] = e.message;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [fields, values, schema]);

  const reset = useCallback(
    (newValues?: Record<string, unknown>) => {
      setValues(newValues ?? initialValues ?? {});
      setErrors({});
    },
    [initialValues],
  );

  return { fields, values, errors, setFieldValue, validate, reset };
}
