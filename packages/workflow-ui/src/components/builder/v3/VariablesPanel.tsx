import { useState } from 'react';
import type {
  WorkflowVariable,
  WorkflowVariableType,
  VariableValue,
} from '@xyne/workflow-sdk/builder';
import type { Attachment } from '@xyne/workflow-sdk/common';
import type { SchemaFormField } from '../../../hooks/use-schema-form.js';
import { AttachmentFieldInput } from '../../schema-form/AttachmentFieldInput.js';
import { cn } from '../../shared/cn.js';

/**
 * VariablesPanel — authors a workflow's fixed values (author-time constants).
 *
 * Each row is a {@link WorkflowVariable}: a key (referenced by steps as
 * `{{vars.key}}`), a type, and a value editor. Documents reuse the shared
 * upload control, so a policy PDF chosen here is the same file for every run —
 * no per-execution upload.
 */
export interface VariablesPanelProps {
  variables: WorkflowVariable[];
  onChange: (next: WorkflowVariable[]) => void;
  readOnly: boolean;
}

/** Editing draft — `value` may be transiently empty (e.g. before a doc upload). */
type Draft = { key: string; type: WorkflowVariableType; value: unknown; description?: string };

const TYPES: { value: WorkflowVariableType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'json', label: 'JSON' },
  { value: 'document', label: 'Document' },
  { value: 'documents', label: 'Documents' },
];

const inputCls =
  'w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 disabled:bg-slate-50 disabled:text-slate-400';

function emptyValueFor(type: WorkflowVariableType): VariableValue {
  switch (type) {
    case 'text': return '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'json': return {};
    case 'documents': return [];
    case 'document': return undefined as unknown as Attachment; // filled on upload
  }
}

/** Minimal SchemaFormField for the shared uploader — it only reads type/accept/maxSize. */
function attachmentField(multiple: boolean): SchemaFormField {
  return {
    name: 'value',
    type: multiple ? 'array' : 'attachment',
    format: 'attachment',
    ...(multiple ? { itemSchema: { format: 'attachment' } } : {}),
  } as unknown as SchemaFormField;
}

function JsonValueEditor({ value, onChange, readOnly }: {
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly: boolean;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <textarea
        className={cn(inputCls, 'min-h-[84px] font-mono text-[12px] leading-snug')}
        value={text}
        disabled={readOnly}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError(null);
          } catch {
            setError('Invalid JSON');
          }
        }}
      />
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

function ValueEditor({ variable, onChange, readOnly }: {
  variable: Draft;
  onChange: (v: unknown) => void;
  readOnly: boolean;
}) {
  switch (variable.type) {
    case 'text':
      return (
        <input
          className={inputCls}
          value={String(variable.value ?? '')}
          disabled={readOnly}
          placeholder="Value"
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <input
          className={inputCls}
          type="number"
          value={variable.value === undefined || variable.value === null ? '' : String(variable.value)}
          disabled={readOnly}
          placeholder="0"
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={!!variable.value}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.checked)}
          />
          {variable.value ? 'true' : 'false'}
        </label>
      );
    case 'json':
      return <JsonValueEditor value={variable.value} onChange={onChange} readOnly={readOnly} />;
    case 'document':
      return <AttachmentFieldInput field={attachmentField(false)} value={variable.value} onChange={onChange} readOnly={readOnly} />;
    case 'documents':
      return <AttachmentFieldInput field={attachmentField(true)} value={variable.value ?? []} onChange={onChange} readOnly={readOnly} />;
  }
}

export function VariablesPanel({ variables, onChange, readOnly }: VariablesPanelProps) {
  const drafts = variables as Draft[];

  const commit = (next: Draft[]): void => onChange(next as WorkflowVariable[]);
  const update = (i: number, patch: Partial<Draft>): void =>
    commit(drafts.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const changeType = (i: number, type: WorkflowVariableType): void =>
    update(i, { type, value: emptyValueFor(type) });
  const add = (): void => commit([...drafts, { key: '', type: 'text', value: '' }]);
  const remove = (i: number): void => commit(drafts.filter((_, idx) => idx !== i));

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">Variables</div>
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-500">Workflow</div>
          </div>
        </div>
        <p className="mt-2 text-[12px] leading-snug text-slate-500">
          Fixed values available to every run — reference them in any step as{' '}
          <code className="rounded bg-slate-100 px-1 text-[11px]">{'{{vars.key}}'}</code>.
        </p>
      </div>

      {/* Rows */}
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {drafts.length === 0 && (
          <p className="text-[13px] text-slate-400">No variables yet. Add one below.</p>
        )}
        {drafts.map((v, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2">
              <input
                className={cn(inputCls, 'flex-1 font-mono')}
                value={v.key}
                disabled={readOnly}
                placeholder="key"
                onChange={(e) => update(i, { key: e.target.value })}
              />
              <select
                className={cn(inputCls, 'w-32')}
                value={v.type}
                disabled={readOnly}
                onChange={(e) => changeType(i, e.target.value as WorkflowVariableType)}
              >
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  title="Remove"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              )}
            </div>
            <ValueEditor key={v.type} variable={v} readOnly={readOnly} onChange={(value) => update(i, { value })} />
            <input
              className={cn(inputCls, 'text-[12px]')}
              value={v.description ?? ''}
              disabled={readOnly}
              placeholder="Description (optional)"
              onChange={(e) => update(i, { description: e.target.value })}
            />
          </div>
        ))}
      </div>

      {/* Add */}
      {!readOnly && (
        <div className="border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={add}
            className="w-full rounded-md border border-dashed border-slate-300 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-600"
          >
            + Add variable
          </button>
        </div>
      )}
    </div>
  );
}
