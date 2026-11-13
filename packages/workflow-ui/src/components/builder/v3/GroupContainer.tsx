import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../shared/cn.js';

interface GroupContainerProps {
  title: string;
  description?: string | undefined;
  children: ReactNode;
  /** When true (builder), title/description are double-click editable. */
  editable?: boolean | undefined;
  /** Commit an edit to the group's title and/or description. */
  onUpdate?: ((patch: { title?: string; description?: string }) => void) | undefined;
}

/**
 * A labeled box wrapping a contiguous run of steps that share a `groupId`.
 * Documentation overlay only — no effect on execution. Used in both the
 * builder (`WorkflowTree`, editable) and the run view (`ExecutionTree`, read-only).
 */
export function GroupContainer({ title, description, children, editable, onUpdate }: GroupContainerProps) {
  const canEdit = !!editable && !!onUpdate;

  return (
    <div className="flex flex-col items-center">
      <div
        className={cn(
          'relative rounded-xl border border-dashed border-indigo-200 px-6 pt-6 pb-4',
          'bg-indigo-50/30',
        )}
      >
        {/* Group header — title pill */}
        <div className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          </svg>
          {canEdit ? (
            <EditableTitle value={title} onCommit={(v) => onUpdate!({ title: v })} />
          ) : (
            title
          )}
        </div>

        {/* Description */}
        {canEdit ? (
          <EditableDescription
            value={description ?? ''}
            onCommit={(v) => onUpdate!({ description: v })}
          />
        ) : (
          description && (
            <div className="mb-3 mx-auto max-w-xs text-center text-[11px] leading-snug text-slate-500">
              {description}
            </div>
          )
        )}

        <div className="flex flex-col items-center">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Inline editors (builder only) ───

function EditableTitle({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) { setDraft(value); ref.current?.focus(); ref.current?.select(); } }, [editing, value]);

  if (!editing) {
    return (
      <span
        onDoubleClick={() => setEditing(true)}
        title="Double-click to rename"
        className="cursor-text"
      >
        {value}
      </span>
    );
  }

  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== value) onCommit(v); };

  return (
    <input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
      }}
      // Inherit the pill's font; drop uppercase so editing reads naturally.
      className="w-28 rounded border border-indigo-300 bg-white px-1 py-0 text-[10px] font-semibold normal-case tracking-normal text-indigo-700 outline-none"
    />
  );
}

function EditableDescription({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) { setDraft(value); ref.current?.focus(); } }, [editing, value]);

  if (editing) {
    const commit = () => { setEditing(false); if (draft !== value) onCommit(draft); };
    return (
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
        rows={2}
        placeholder="Describe what this group does…"
        className="mb-3 mx-auto block w-64 resize-y rounded border border-indigo-300 bg-white px-2 py-1 text-center text-[11px] leading-snug text-slate-600 outline-none"
      />
    );
  }

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      title="Double-click to edit"
      className={cn(
        'mb-3 mx-auto max-w-xs cursor-text text-center text-[11px] leading-snug',
        value ? 'text-slate-500' : 'italic text-slate-300',
      )}
    >
      {value || 'Double-click to add a description'}
    </div>
  );
}
