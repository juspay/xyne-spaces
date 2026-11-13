import { useCallback, useEffect, useRef, useState } from 'react';
import type { Attachment } from '@xyne/workflow-sdk/common';
import { isExecutable, mimeAccepted } from '@xyne/workflow-sdk/common';
import type { SchemaFormField } from '../../hooks/use-schema-form.js';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { cn } from '../shared/cn.js';

/**
 * Renders an attachment-typed schema field (`format: 'attachment'`, single or
 * `attachment[]`) as an upload control: drop/browse → upload via the client →
 * the field value becomes the {@link Attachment} ref (single) or refs (array).
 * Per-file `accept`/`maxSize` and array `maxItems` come straight off the field.
 */
export function AttachmentFieldInput({
  field,
  value,
  onChange,
  readOnly,
  compact,
}: {
  field: SchemaFormField;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean | undefined;
  /**
   * Collapse the empty control to a single row, opening to the full drop target
   * only while a file is over it. Opt-in: a form of many uploads is unreadable
   * when each one is a 100px box, but a screen asking for one file is not, so
   * the big target stays the default and the dense form asks for the row.
   */
  compact?: boolean | undefined;
}) {
  const client = useWorkflowClient();
  const multiple = field.type === 'array';
  const accept = (multiple ? (field.itemSchema?.['accept'] as string[] | undefined) : field.accept);
  const maxSize = (multiple ? (field.itemSchema?.['maxSize'] as number | undefined) : field.maxSize);
  const { maxItems } = field;

  const [files, setFiles] = useState<UploadingFile[]>(() => seedFromValue(value, multiple));
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Push committed attachments (only the `done` ones) up as the field value.
  // onChange is intentionally excluded from deps — it's a fresh closure each
  // render and including it would loop. `files` is the only real trigger.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const done = files.filter((f) => f.status === 'done' && f.attachment).map((f) => f.attachment!);
    onChangeRef.current(multiple ? done : (done[0] ?? undefined));
  }, [files, multiple]);

  const validateFile = useCallback(
    (file: File): string | null => {
      const ex = isExecutable(file.type || 'application/octet-stream', file.name);
      if (ex) return `"${file.name}": ${ex}`;
      if (accept && !mimeAccepted(file.type || 'application/octet-stream', accept)) {
        return `"${file.name}" (${file.type || 'unknown type'}) is not an accepted type`;
      }
      if (maxSize && file.size > maxSize) {
        return `"${file.name}" exceeds max size (${formatBytes(file.size)} > ${formatBytes(maxSize)})`;
      }
      return null;
    },
    [accept, maxSize],
  );

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      let incoming = Array.from(list);
      // Single-value field: keep just the first; replace any prior selection.
      if (!multiple) incoming = incoming.slice(0, 1);
      else if (maxItems !== undefined) {
        const used = files.filter((f) => f.status !== 'error').length;
        const space = Math.max(0, maxItems - used);
        if (incoming.length > space) {
          setLocalError(`At most ${String(maxItems)} file${maxItems === 1 ? '' : 's'} allowed.`);
          incoming = incoming.slice(0, space);
        } else setLocalError(null);
      } else setLocalError(null);

      for (const f of incoming) {
        const id = `${String(Date.now())}_${Math.random().toString(36).slice(2, 8)}`;
        const err = validateFile(f);
        if (err) {
          setFiles((prev) => (multiple ? [...prev, { id, name: f.name, status: 'error', error: err }] : [{ id, name: f.name, status: 'error', error: err }]));
          continue;
        }
        setFiles((prev) => [...(multiple ? prev : []), { id, name: f.name, status: 'uploading' }]);
        try {
          const res = await client.uploads.create([f]);
          const att = res.attachments[0];
          if (!att) throw new Error('No attachment returned from upload');
          setFiles((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'done' as const, attachment: att } : e)));
        } catch (uploadErr) {
          const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          setFiles((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'error' as const, error: msg } : e)));
        }
      }
    },
    [client, multiple, maxItems, files, validateFile],
  );

  const remove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const usable = files.filter((f) => f.status !== 'error').length;
  const limitReached = multiple
    ? (maxItems !== undefined && usable >= maxItems)
    : usable >= 1;

  return (
    <div>
      <DropZone
        accept={accept?.join(',')}
        dragging={dragging}
        disabled={!!readOnly || limitReached}
        multiple={multiple}
        onDragChange={setDragging}
        onFiles={(f) => void addFiles(f)}
        hint={describeConstraints(accept, maxSize, multiple ? maxItems : 1)}
        compact={compact === true}
      />
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f) => (
            <FileRow key={f.id} file={f} onRemove={() => remove(f.id)} readOnly={readOnly} />
          ))}
        </ul>
      )}
      {localError && <p className="mt-1 text-[11px] text-[var(--wui-status-failed)]">{localError}</p>}
    </div>
  );
}

interface UploadingFile {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  attachment?: Attachment;
  error?: string;
}

function seedFromValue(value: unknown, multiple: boolean): UploadingFile[] {
  const arr: Attachment[] = multiple
    ? (Array.isArray(value) ? (value as Attachment[]) : [])
    : (value && typeof value === 'object' ? [value as Attachment] : []);
  return arr.map((a, i) => ({ id: `init_${String(i)}`, name: a.name, status: 'done' as const, attachment: a }));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const TYPE_WORDS: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/csv': 'CSV',
  'text/plain': 'text',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
};

/** A MIME type as a person would say it: `application/pdf` → `PDF`, `image/*` → `images`. */
function typeWord(mime: string): string {
  const known = TYPE_WORDS[mime];
  if (known) return known;
  const [type, sub] = mime.split('/');
  if (!type) return mime;
  if (sub === '*') return `${type}s`;
  const tail = (sub ?? '').split('+').pop() ?? '';
  return tail.length > 0 && tail.length <= 5 ? tail.toUpperCase() : type;
}

/**
 * What this field will accept, in words — the raw MIME list is noise to the
 * person being asked for a document. Empty when nothing is constrained: a line
 * reading "Any file" tells the reader less than no line at all.
 */
function describeConstraints(accept?: string[], maxSize?: number, maxCount?: number): string {
  const parts: string[] = [];
  if (accept && accept.length > 0) {
    const words = [...new Set(accept.map(typeWord))];
    const last = words.pop() as string;
    parts.push(words.length > 0 ? `${words.join(', ')} or ${last}` : last);
  }
  if (maxSize) parts.push(`up to ${formatBytes(maxSize)}`);
  if (maxCount && maxCount > 1) parts.push(`max ${String(maxCount)} files`);
  return parts.join(' · ');
}

function DropZone({
  accept,
  dragging,
  disabled,
  multiple,
  onDragChange,
  onFiles,
  hint,
  compact,
}: {
  accept?: string | undefined;
  dragging: boolean;
  disabled: boolean;
  multiple:boolean;
  onDragChange: (d: boolean) => void;
  onFiles: (files: FileList) => void;
  hint: string;
  compact: boolean;
}) {
  // The tall target is the resting shape unless asked otherwise, and is always
  // what a file hovering over the control opens into.
  const expanded = !compact || dragging;
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) onDragChange(true);
      }}
      onDragLeave={() => onDragChange(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDragChange(false);
        if (!disabled && e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
      }}
      className={cn(
        'flex cursor-pointer rounded-md border-2 border-dashed transition-colors',
        expanded
          ? 'flex-col items-center justify-center px-4 py-5 text-center'
          : 'items-center gap-2 px-3 py-2',
        disabled
          ? 'cursor-not-allowed border-[var(--wui-border)] bg-[var(--wui-bg-muted)] text-[var(--wui-fg-muted)]'
          : dragging
            ? 'border-[var(--wui-primary)] bg-[var(--wui-primary-light)] text-[var(--wui-primary)]'
            : 'border-[var(--wui-border-strong)] bg-[var(--wui-bg-muted)] text-[var(--wui-fg-muted)] hover:border-[var(--wui-border-strong)] hover:bg-[var(--wui-bg-muted)]',
      )}
    >
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <svg
        width={expanded ? 20 : 16} height={expanded ? 20 : 16}
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <span className={cn('text-[12px] font-medium', expanded && 'mt-1.5')}>
        {disabled
          ? 'Selected'
          : !compact
            ? 'Drop a file or click to browse'
            : dragging
              ? 'Drop to attach'
              : 'Attach a file'}
      </span>
      {hint && (
        <span
          className={cn(
            'text-[10px] text-[var(--wui-fg-muted)]',
            expanded ? 'mt-0.5' : 'ml-auto truncate pl-2',
          )}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

function FileRow({
  file,
  onRemove,
  readOnly,
}: {
  file: UploadingFile;
  onRemove: () => void;
  readOnly?: boolean | undefined;
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12px]',
        file.status === 'error'
          ? 'border-[var(--wui-status-failed)] bg-[color-mix(in_srgb,var(--wui-status-failed)_10%,transparent)]'
          : file.status === 'done'
            ? 'border-[var(--wui-status-completed)] bg-[color-mix(in_srgb,var(--wui-status-completed)_10%,transparent)]'
            : 'border-[var(--wui-border)] bg-[var(--wui-surface)]',
      )}
    >
      <div className="shrink-0">
        {file.status === 'uploading' && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin text-[var(--wui-fg-muted)]">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        )}
        {file.status === 'done' && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--wui-status-completed)]">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {file.status === 'error' && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-[var(--wui-status-failed)]">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-[var(--wui-fg)]">{file.name}</div>
        {file.status === 'error' && file.error && (
          <div className="truncate text-[10px] text-[var(--wui-status-failed)]" title={file.error}>{file.error}</div>
        )}
        {file.status === 'done' && file.attachment?.size !== undefined && (
          <div className="text-[10px] text-[var(--wui-fg-muted)]">{formatBytes(file.attachment.size)}</div>
        )}
      </div>
      {!readOnly && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]"
          aria-label="Remove"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </li>
  );
}
