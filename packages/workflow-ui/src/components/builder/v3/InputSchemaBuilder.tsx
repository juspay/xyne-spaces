import { useCallback, useEffect, useState } from 'react';
import {
  LAYOUT_KEY,
  layoutToSchemaValue,
  resolveLayout,
} from '../../../hooks/use-schema-form.js';
import { cn } from '../../shared/cn.js';

type FieldKind = 'string' | 'date' | 'number' | 'boolean' | 'object' | 'array' | 'document' | 'documents';

interface SchemaField {
  name: string;
  kind: FieldKind;
  description: string;
  required: boolean;
  /** Document kinds only — comma-separated accept list, e.g. "application/pdf, image/*". */
  accept?: string | undefined;
  /** Document kinds only — max size per file, in MB. */
  maxSizeMb?: number | undefined;
  /** "Documents" only — max number of files. */
  maxItems?: number | undefined;
}

interface SchemaGroup {
  title: string | null;
  fields: SchemaField[];
}

const TYPE_OPTIONS: { value: FieldKind; label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'Array' },
  { value: 'document', label: 'Document' },
  { value: 'documents', label: 'Documents' },
];

const MB = 1024 * 1024;

export interface InputSchemaBuilderProps {
  value: Record<string, unknown> | undefined;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean | undefined;
}

function isDocKind(k: FieldKind): boolean {
  return k === 'document' || k === 'documents';
}

function detectKind(prop: Record<string, unknown>): FieldKind {
  if (prop['format'] === 'attachment') return 'document';
  if (prop['type'] === 'string' && prop['format'] === 'date') return 'date';
  if (prop['type'] === 'array') {
    const items = prop['items'] as Record<string, unknown> | undefined;
    if (items?.['format'] === 'attachment') return 'documents';
  }
  const t = prop['type'];
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object' || t === 'array') return t;
  return 'string';
}

function parseFields(schema: Record<string, unknown> | undefined): SchemaField[] {
  if (!schema) return [];
  const props = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
  if (!props) return [];
  const requiredSet = new Set((schema['required'] as string[] | undefined) ?? []);

  return Object.entries(props).map(([name, prop]) => {
    const kind = detectKind(prop);
    const isDocs = kind === 'documents';
    // For "documents", per-file constraints live on items; cardinality on the array.
    const item = (isDocs ? (prop['items'] as Record<string, unknown> | undefined) : prop) ?? {};
    const acceptArr = item['accept'] as string[] | undefined;
    const maxSize = item['maxSize'] as number | undefined;
    const minItems = prop['minItems'] as number | undefined;

    const field: SchemaField = {
      name,
      kind,
      description: (prop['description'] as string) ?? '',
      required: isDocs ? typeof minItems === 'number' && minItems >= 1 : requiredSet.has(name),
    };
    if (isDocKind(kind)) {
      if (acceptArr && acceptArr.length > 0) field.accept = acceptArr.join(', ');
      if (typeof maxSize === 'number') field.maxSizeMb = Math.round((maxSize / MB) * 100) / 100;
      if (isDocs && typeof prop['maxItems'] === 'number') field.maxItems = prop['maxItems'] as number;
    }
    return field;
  });
}

/**
 * Bucket the parsed fields by the schema's `x-layout`.
 *
 * Reads in authoring mode, so a section the author added but has not filled yet
 * survives the round trip instead of being normalized away as "nothing to draw".
 */
function parseGroups(schema: Record<string, unknown> | undefined): SchemaGroup[] {
  if (!schema) return [];
  const byName = new Map(parseFields(schema).map((f) => [f.name, f]));

  return resolveLayout(schema, { authoring: true }).map((group) => ({
    title: group.title,
    fields: group.fieldNames
      .map((name) => byName.get(name))
      .filter((f): f is SchemaField => f !== undefined),
  }));
}

function applyFileConstraints(target: Record<string, unknown>, f: SchemaField): void {
  const accept = f.accept
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (accept && accept.length > 0) target['accept'] = accept;
  if (f.maxSizeMb !== undefined && f.maxSizeMb > 0) target['maxSize'] = Math.round(f.maxSizeMb * MB);
}

/** One field → its JSON Schema property, and whether it belongs in `required[]`. */
function fieldToProperty(f: SchemaField): { prop: Record<string, unknown>; required: boolean } {
  let prop: Record<string, unknown>;
  let inRequired = false;

  if (f.kind === 'document') {
    prop = { type: 'object', format: 'attachment' };
    applyFileConstraints(prop, f);
    inRequired = f.required;
  } else if (f.kind === 'documents') {
    const item: Record<string, unknown> = { type: 'object', format: 'attachment' };
    applyFileConstraints(item, f);
    prop = { type: 'array', items: item };
    if (f.required) prop['minItems'] = 1; // "at least one" — the standard form
    if (f.maxItems !== undefined && f.maxItems > 0) prop['maxItems'] = f.maxItems;
  } else if (f.kind === 'date') {
    prop = { type: 'string', format: 'date' };
    inRequired = f.required;
  } else {
    prop = { type: f.kind };
    inRequired = f.required;
  }
  if (f.description) prop['description'] = f.description;

  return { prop, required: inRequired };
}

/**
 * Groups → schema. `properties` and `x-layout` come from the same walk, so a
 * renamed field moves in both at once and they cannot drift.
 *
 * Fields are emitted in visual order, so JSON key order matches what the author
 * sees. `x-layout` is omitted when there is no grouping to record, leaving an
 * unsectioned schema identical to one written before sections existed.
 */
function groupsToSchema(groups: SchemaGroup[]): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const group of groups) {
    for (const f of group.fields) {
      const { prop, required: isRequired } = fieldToProperty(f);
      if (isRequired) required.push(f.name);
      properties[f.name] = prop;
    }
  }

  const layout = layoutToSchemaValue(
    groups.map((g) => ({ title: g.title, fieldNames: g.fields.map((f) => f.name) })),
    { authoring: true },
  );

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(layout ? { [LAYOUT_KEY]: layout } : {}),
  };
}

function nextFieldName(groups: SchemaGroup[]): string {
  const taken = new Set(groups.flatMap((g) => g.fields.map((f) => f.name)));
  for (let n = 1; ; n++) {
    const name = `field${String(n)}`;
    if (!taken.has(name)) return name;
  }
}

function TitleInput({
  value,
  onCommit,
  disabled,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  disabled?: boolean | undefined;
  className: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
      }}
      disabled={disabled}
      className={className}
      placeholder="Section name (optional)"
      aria-label="Section name"
    />
  );
}

export function InputSchemaBuilder({ value, onChange, disabled }: InputSchemaBuilderProps) {
  const groups = parseGroups(value);
  const grouped = groups.length > 1 || (groups[0]?.title ?? null) !== null;
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const emitChange = useCallback((updated: SchemaGroup[]) => {
    setPendingDelete(null);
    onChange(groupsToSchema(updated));
  }, [onChange]);

  const patchGroup = useCallback((gi: number, patch: (group: SchemaGroup) => SchemaGroup) => {
    emitChange(groups.map((group, i) => (i === gi ? patch(group) : group)));
  }, [groups, emitChange]);

  const addSection = useCallback(() => {
    emitChange([...groups, { title: 'New section', fields: [] }]);
  }, [groups, emitChange]);

  const addField = useCallback(() => {
    const field: SchemaField = { name: nextFieldName(groups), kind: 'string', description: '', required: false };
    const last = groups[groups.length - 1];
    if (last && last.title === null) {
      emitChange(groups.map((g, i) => (i === groups.length - 1 ? { ...g, fields: [...g.fields, field] } : g)));
      return;
    }
    emitChange([...groups, { title: null, fields: [field] }]);
  }, [groups, emitChange]);

  const addFieldTo = useCallback((gi: number) => {
    const field: SchemaField = { name: nextFieldName(groups), kind: 'string', description: '', required: false };
    patchGroup(gi, (group) => ({ ...group, fields: [...group.fields, field] }));
  }, [groups, patchGroup]);

  const updateField = useCallback((gi: number, fi: number, patch: Partial<SchemaField>) => {
    patchGroup(gi, (group) => ({
      ...group,
      fields: group.fields.map((f, i) => (i === fi ? { ...f, ...patch } : f)),
    }));
  }, [patchGroup]);

  const removeField = useCallback((gi: number, fi: number) => {
    patchGroup(gi, (group) => ({ ...group, fields: group.fields.filter((_, i) => i !== fi) }));
  }, [patchGroup]);

  const setTitle = useCallback((gi: number, raw: string) => {
    const title = raw.trim() === '' ? null : raw;
    patchGroup(gi, (group) => ({ ...group, title }));
  }, [patchGroup]);

  const deleteGroup = useCallback((gi: number) => {
    emitChange(groups.filter((_, i) => i !== gi));
  }, [groups, emitChange]);

  const inputClasses = 'w-full rounded-md border border-slate-200 px-2 py-1.5 text-[12px] bg-white text-slate-700 outline-none focus:border-[var(--wui-primary)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--wui-primary)_22%,transparent)] transition-all';

  return (
    <div className={cn(
      'rounded-lg border border-[var(--wui-border)] bg-white overflow-hidden',
      disabled && 'opacity-60 cursor-not-allowed',
    )}>
      {groups.map((group, gi) => (
        <div key={gi} className="border-t border-slate-100 first:border-t-0">
          {/* Section heading — an empty name means this block has none. */}
          {grouped && (
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-2">
            <TitleInput
              value={group.title ?? ''}
              onCommit={(next) => setTitle(gi, next)}
              disabled={disabled}
              className={cn(inputClasses, 'bg-transparent border-transparent font-medium focus:bg-white')}
            />
            {!disabled && pendingDelete !== gi && (
              <button
                type="button"
                onClick={() => {
                  if (group.fields.length === 0) deleteGroup(gi);
                  else setPendingDelete(gi);
                }}
                title={group.title === null ? 'Delete these fields' : 'Delete section'}
                className="flex-shrink-0 p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            )}
          </div>
          )}

          {/* Deleting a section takes its fields with it — say so, and say how many. */}
          {pendingDelete === gi && (
            <div className="flex items-center gap-2 bg-red-50 px-3 py-2">
              <span className="flex-1 text-[11px] text-red-700">
                Delete {group.title === null ? 'these' : `"${group.title}"`} and its {group.fields.length} field{group.fields.length === 1 ? '' : 's'}?
              </span>
              <button
                type="button"
                onClick={() => deleteGroup(gi)}
                className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-100 transition-colors"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {group.fields.length > 0 && (
            <div className="divide-y divide-slate-100">
              {group.fields.map((field, fi) => (
                <div key={fi} className="px-3 py-2.5 space-y-2">
                  <div className="flex items-start gap-2">
                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Name</label>
                      <input
                        type="text"
                        value={field.name}
                        onChange={(e) => updateField(gi, fi, { name: e.target.value })}
                        disabled={disabled}
                        className={inputClasses}
                        placeholder="fieldName"
                      />
                    </div>
                    {/* Type */}
                    <div className="w-28 flex-shrink-0">
                      <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Type</label>
                      <select
                        value={field.kind}
                        onChange={(e) => updateField(gi, fi, { kind: e.target.value as FieldKind })}
                        disabled={disabled}
                        className={inputClasses}
                      >
                        {TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    {/* Required toggle */}
                    <div className="flex-shrink-0 pt-4">
                      <label
                        className="flex items-center gap-1.5 cursor-pointer"
                        title={field.kind === 'documents' ? 'Require at least one file' : 'Required'}
                      >
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(gi, fi, { required: e.target.checked })}
                          disabled={disabled}
                          className="rounded border-slate-300 text-[var(--wui-primary)]"
                        />
                        <span className="text-[10px] font-medium text-slate-500">Req</span>
                      </label>
                    </div>
                    {/* Remove */}
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => removeField(gi, fi)}
                        className="flex-shrink-0 mt-4 p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Document-only constraints */}
                  {isDocKind(field.kind) && (
                    <div className="flex items-end gap-2">
                      <div className="flex-1 min-w-0">
                        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Accept</label>
                        <input
                          type="text"
                          value={field.accept ?? ''}
                          onChange={(e) => updateField(gi, fi, { accept: e.target.value })}
                          disabled={disabled}
                          className={cn(inputClasses, 'font-mono text-[11px]')}
                          placeholder="application/pdf, image/*"
                        />
                      </div>
                      <div className="w-20 flex-shrink-0">
                        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Max MB</label>
                        <input
                          type="number"
                          min={0}
                          value={field.maxSizeMb ?? ''}
                          onChange={(e) => updateField(gi, fi, { maxSizeMb: e.target.value === '' ? undefined : Number(e.target.value) })}
                          disabled={disabled}
                          className={inputClasses}
                          placeholder="—"
                        />
                      </div>
                      {field.kind === 'documents' && (
                        <div className="w-20 flex-shrink-0">
                          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Max #</label>
                          <input
                            type="number"
                            min={1}
                            value={field.maxItems ?? ''}
                            onChange={(e) => updateField(gi, fi, { maxItems: e.target.value === '' ? undefined : Number(e.target.value) })}
                            disabled={disabled}
                            className={inputClasses}
                            placeholder="—"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Description */}
                  <input
                    type="text"
                    value={field.description}
                    onChange={(e) => updateField(gi, fi, { description: e.target.value })}
                    disabled={disabled}
                    className={cn(inputClasses, 'text-[11px] text-slate-500')}
                    placeholder="Description (optional)"
                  />
                </div>
              ))}
            </div>
          )}

          {!disabled && (
            <div className="px-3 pb-2 pt-1">
              <button
                type="button"
                onClick={() => addFieldTo(gi)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 py-1.5 text-[11px] font-medium text-slate-400 hover:border-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14" /><path d="M5 12h14" />
                </svg>
                Add field
              </button>
            </div>
          )}
        </div>
      ))}

      {groups.length === 0 && (
        <div className="px-3 py-4 text-center">
          <p className="text-[12px] text-slate-400">No fields defined yet</p>
        </div>
      )}

      {!disabled && (
        <div className="flex gap-2 border-t border-slate-100 px-3 py-2">
          <button
            type="button"
            onClick={addField}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 py-1.5 text-[11px] font-medium text-slate-400 hover:border-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
            Add field
          </button>
          <button
            type="button"
            onClick={addSection}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 py-1.5 text-[11px] font-medium text-slate-400 hover:border-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
            Add section
          </button>
        </div>
      )}
    </div>
  );
}
