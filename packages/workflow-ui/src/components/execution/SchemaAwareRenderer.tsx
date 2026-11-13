import { useState } from 'react';
import { cn } from '../shared/cn.js';
import { AttachmentCard, AttachmentList, isAttachment, isAttachmentArray } from '../shared/AttachmentCard.js';
import { CitationMarks } from '../shared/CitationArrow.js';
import { isCitationRefArray, citeAt, type CitationMap } from '../shared/citation.js';

export interface SchemaAwareRendererProps {
  data: Record<string, unknown>;
  schema: Record<string, unknown>;
  /**
   * Runtime citations, shaped like `data` so the walk indexes both at once
   * (`data.response.total` ↔ `citation.response.total`). Omit for uncited output.
   */
  citation?: CitationMap | undefined;
  className?: string | undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getSchemaProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> | undefined {
  return schema['properties'] as Record<string, Record<string, unknown>> | undefined;
}

function getSchemaType(schema: Record<string, unknown>): string | undefined {
  return schema['type'] as string | undefined;
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function getTypeBadge(type: string | undefined): { label: string; color: string } {
  switch (type) {
    case 'string': return { label: 'str', color: 'bg-emerald-100 text-emerald-700' };
    case 'number':
    case 'integer': return { label: 'num', color: 'bg-blue-100 text-blue-700' };
    case 'boolean': return { label: 'bool', color: 'bg-violet-100 text-violet-700' };
    case 'array': return { label: 'arr', color: 'bg-amber-100 text-amber-700' };
    case 'object': return { label: 'obj', color: 'bg-slate-100 text-slate-600' };
    default: return { label: 'any', color: 'bg-slate-100 text-slate-500' };
  }
}

function isComplexValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.length > 0;
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return false;
}

function formatPrimitive(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '\u2014';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.length > 120) return value.slice(0, 117) + '\u2026';
    return value;
  }
  return String(value);
}

function getArraySummary(arr: unknown[]): string {
  return `${String(arr.length)} item${arr.length === 1 ? '' : 's'}`;
}

function getObjectSummary(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  return `${String(keys.length)} key${keys.length === 1 ? '' : 's'}`;
}

// ── Inline JSON (for expanded complex values) ──────────────────────────────

function InlineJson({ data, cite }: { data: unknown; cite?: unknown }) {
  // A cited scalar nested inside an expanded object still gets its marker — the
  // citation mirror is walked in lockstep with the value all the way down.
  const leaf = isCitationRefArray(cite) ? cite : undefined;
  const mark = (node: React.ReactNode): React.ReactNode =>
    leaf ? <span className="inline-flex items-baseline gap-1">{node}<CitationMarks refs={leaf} /></span> : node;

  if (data === null || data === undefined) {
    return mark(<span className="text-slate-400 italic">null</span>);
  }

  if (typeof data === 'string') {
    return mark(<span className="text-emerald-700 break-all">&quot;{data}&quot;</span>);
  }

  if (typeof data === 'number') {
    return mark(<span className="text-blue-600">{String(data)}</span>);
  }

  if (typeof data === 'boolean') {
    return mark(<span className="text-violet-600">{data ? 'true' : 'false'}</span>);
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return mark(<span className="text-slate-400">[]</span>);
    return (
      <div className="ml-3 space-y-0.5">
        {data.map((item, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="shrink-0 text-[10px] text-slate-400 font-mono mt-px w-4 text-right">{String(i)}</span>
            <InlineJson data={item} cite={citeAt(cite, i)} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return mark(<span className="text-slate-400">{'{}'}</span>);
    return (
      <div className="ml-3 space-y-0.5">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-start gap-1.5">
            <span className="shrink-0 text-slate-500 font-mono text-[11px]">{key}:</span>
            <InlineJson data={val} cite={citeAt(cite, key)} />
          </div>
        ))}
      </div>
    );
  }

  return mark(<span className="text-slate-600">{String(data)}</span>);
}

// ── Field Row ───────────────────────────────────────────────────────────────

function FieldRow({
  label,
  value,
  fieldSchema,
  description,
  cite,
}: {
  label: string;
  value: unknown;
  fieldSchema?: Record<string, unknown> | undefined;
  description?: string | undefined;
  cite?: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const type = fieldSchema ? getSchemaType(fieldSchema) : undefined;
  const isFile = isAttachment(value) || isAttachmentArray(value);
  const badge = isFile ? { label: 'file', color: 'bg-indigo-100 text-indigo-700' } : getTypeBadge(type);
  const complex = isComplexValue(value);
  const leaf = isCitationRefArray(cite) ? cite : undefined;

  return (
    <div className="group">
      <div className="flex items-start gap-3 py-1.5">
        {/* Label */}
        <div className="flex items-center gap-1.5 shrink-0 w-[140px] min-w-[100px]">
          <span className="text-[12px] text-slate-500 truncate" title={label}>
            {label}
          </span>
          <span className={cn('rounded px-1 py-px text-[9px] font-medium leading-tight', badge.color)}>
            {badge.label}
          </span>
        </div>

        {/* Value */}
        <div className="flex-1 min-w-0">
          {/* Attachment-typed values render as download/preview cards — generic
              across any field name or step, detected from the value shape. */}
          {isAttachment(value) ? (
            <AttachmentCard attachment={value} />
          ) : isAttachmentArray(value) ? (
            <AttachmentList attachments={value} />
          ) : complex ? (
            <div>
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-700 transition-colors"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn('transition-transform', expanded && 'rotate-90')}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span className="font-mono">
                  {Array.isArray(value) ? getArraySummary(value) : getObjectSummary(value as Record<string, unknown>)}
                </span>
              </button>
              {expanded && (
                <div className="mt-1 rounded-md border border-slate-100 bg-slate-50/50 p-2 font-mono text-[11px] leading-[1.6]">
                  <InlineJson data={value} cite={cite} />
                </div>
              )}
            </div>
          ) : (
            <span className="inline-flex items-baseline gap-1">
              <span className={cn(
                'text-[12px] break-all',
                typeof value === 'number' ? 'font-mono text-blue-600' :
                typeof value === 'boolean' ? 'font-mono text-violet-600' :
                value === null || value === undefined ? 'text-slate-400 italic' :
                'text-slate-800',
              )}>
                {formatPrimitive(value)}
              </span>
              {leaf && <CitationMarks refs={leaf} />}
            </span>
          )}
        </div>
      </div>

      {/* Description tooltip line */}
      {description && (
        <div className="ml-0 mb-1 text-[10px] text-slate-400 leading-tight">
          {description}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function SchemaAwareRenderer({ data, schema, citation, className }: SchemaAwareRendererProps) {
  const properties = getSchemaProperties(schema);

  if (!properties || Object.keys(properties).length === 0) {
    // No schema properties — render nothing (caller should fall back to JSON tree)
    return null;
  }

  // Split into: known schema fields (in order) and extra fields (not in schema)
  const schemaKeys = Object.keys(properties);
  const dataKeys = new Set(Object.keys(data));
  const extraKeys = [...dataKeys].filter((k) => !schemaKeys.includes(k));

  return (
    <div className={cn('divide-y divide-slate-100', className)}>
      {/* Schema-defined fields */}
      {schemaKeys.map((key) => {
        const fieldSchema = properties[key]!;
        const description = fieldSchema['description'] as string | undefined;
        return (
          <FieldRow
            key={key}
            label={formatFieldLabel(key)}
            value={data[key]}
            fieldSchema={fieldSchema}
            description={description}
            cite={citeAt(citation, key)}
          />
        );
      })}

      {/* Extra fields not in schema */}
      {extraKeys.length > 0 && (
        <>
          <div className="pt-2 pb-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Additional fields
            </span>
          </div>
          {extraKeys.map((key) => (
            <FieldRow
              key={key}
              label={formatFieldLabel(key)}
              value={data[key]}
              cite={citeAt(citation, key)}
            />
          ))}
        </>
      )}
    </div>
  );
}
