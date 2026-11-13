import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FieldOption, FieldOptionsPage } from '@xyne/workflow-sdk';
import { useWorkflowClient } from '../../../hooks/use-workflow-client.js';
import { cn } from '../../shared/cn.js';

/**
 * Pickers for config fields whose choices only the server can know.
 *
 * A field marked `hasOptions` in its schema is answered by the step or trigger
 * that owns it — `getOptions` runs server-side with that component's credentials
 * and the half-filled form. What lands in the workflow's config is only the id it
 * returns; the label is for the author, and is fetched again when the workflow is
 * reopened.
 */

export interface FieldOptionsScope {
  kind: 'steps' | 'triggers';
  /** The step or trigger type that owns the field. */
  type: string;
  /** The workflow being edited… */
  workflowId?: string | undefined;
  /** …or the folder a new one will live in. Options need one of the two. */
  folderId?: string | undefined;
}

const ScopeCtx = createContext<FieldOptionsScope | null>(null);

/** Mounted by the config panels, which know which component is being edited. */
export function FieldOptionsScopeProvider({
  scope,
  children,
}: {
  scope: FieldOptionsScope;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => scope,
    [scope.kind, scope.type, scope.workflowId, scope.folderId],
  );
  return <ScopeCtx.Provider value={value}>{children}</ScopeCtx.Provider>;
}

export function useFieldOptionsScope(): FieldOptionsScope | null {
  return useContext(ScopeCtx);
}

/**
 * The form values a loader may filter by.
 *
 * References are dropped here as well as on the server, for a different reason:
 * they are what the cache is keyed on, and a field holding `{{trigger.x}}` never
 * changes what the loader can answer, so it must not cause a refetch. Nested
 * objects are walked, because a field path may point inside one.
 */
function literalValues(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isPlainObject(value)) {
      out[key] = literalValues(value);
      continue;
    }
    if (value === undefined || holdsRef(value)) continue;
    out[key] = value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mirrors the server's rule, so the key reflects exactly what a loader sees. */
function holdsRef(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('{{');
  if (Array.isArray(value)) return value.some(holdsRef);
  if (isPlainObject(value)) return Object.values(value).some(holdsRef);
  return false;
}

function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

interface UseFieldOptionsArgs {
  scope: FieldOptionsScope;
  field: string;
  config: Record<string, unknown>;
  search: string;
  cursor?: string | undefined;
  enabled: boolean;
}

export function useFieldOptions({
  scope,
  field,
  config,
  search,
  cursor,
  enabled,
}: UseFieldOptionsArgs) {
  const client = useWorkflowClient();
  const literal = useMemo(() => literalValues(config), [config]);
  const settledKey = useDebounced(JSON.stringify([literal, search]));

  return useQuery<FieldOptionsPage>({
    queryKey: ['wui', 'field-options', scope.kind, scope.type, field, settledKey, cursor],
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      client.schema.fieldOptions({
        kind: scope.kind,
        type: scope.type,
        field,
        config,
        ...(search ? { search } : {}),
        ...(cursor ? { cursor } : {}),
        ...(scope.workflowId ? { workflowId: scope.workflowId } : {}),
        ...(scope.folderId ? { folderId: scope.folderId } : {}),
      }),
  });
}

/** Turns stored ids back into names — one call, however many are selected. */
function useResolvedLabels(
  scope: FieldOptionsScope,
  field: string,
  values: readonly string[],
): Record<string, string> {
  const client = useWorkflowClient();
  const key = [...values].sort().join(',');

  const { data } = useQuery<FieldOptionsPage>({
    queryKey: ['wui', 'field-options-labels', scope.kind, scope.type, field, key],
    enabled: values.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () =>
      client.schema.fieldOptions({
        kind: scope.kind,
        type: scope.type,
        field,
        values,
        ...(scope.workflowId ? { workflowId: scope.workflowId } : {}),
        ...(scope.folderId ? { folderId: scope.folderId } : {}),
      }),
  });

  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const item of data?.items ?? []) out[item.value] = item.label;
    return out;
  }, [data]);
}

export interface OptionsFieldProps {
  field: string;
  value: unknown;
  onChange: (value: unknown) => void;
  /** The form as it stands — sent so the loader can narrow by its siblings. */
  config: Record<string, unknown>;
  scope: FieldOptionsScope;
  /**
   * Many choices rather than one.
   *
   * Read from the field's own type in the schema, never declared beside the
   * mark: `z.array(...)` already says how many may be picked, and a second
   * declaration could only ever disagree with it.
   */
  multi?: boolean | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
}

export function OptionsField({
  field,
  value,
  onChange,
  config,
  scope,
  multi,
  placeholder,
  disabled,
}: OptionsFieldProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const [pages, setPages] = useState<FieldOption[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const selected = useMemo<string[]>(() => {
    if (multi) {
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    }
    return typeof value === 'string' && value !== '' ? [value] : [];
  }, [value, multi]);

  // One call however many are held: the editor stores ids, and their names are
  // fetched again each time the workflow is opened.
  const labels = useResolvedLabels(scope, field, selected);
  const nameOf = (v: string): string => labels[v] ?? v;

  useEffect(() => {
    setPages([]);
    setCursor(undefined);
  }, [search]);

  const query = useFieldOptions({
    scope,
    field,
    config,
    search,
    cursor,
    enabled: open,
  });

  useEffect(() => {
    const items = query.data?.items;
    if (!items) return;
    setPages((prev) => (cursor ? [...prev, ...items] : [...items]));
  }, [query.data, cursor]);

  const notice = query.data?.notice;
  const failed = query.isError;
  const items = pages;

  return (
    <div className="relative">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between rounded-[var(--wui-radius-sm)] border px-2.5 py-1.5 text-left text-[13px]',
          'border-[var(--wui-border)] bg-[var(--wui-bg)] text-[var(--wui-fg)]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className={cn('truncate', selected.length === 0 && 'text-[var(--wui-fg-muted)]')}>
          {selected.length === 0 ? (placeholder ?? 'Choose…') : selected.map(nameOf).join(', ')}
        </span>
        <span className="text-[var(--wui-fg-muted)]">▾</span>
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-20 mt-1 w-full rounded-[var(--wui-radius-sm)] border shadow-lg',
            'border-[var(--wui-border)] bg-[var(--wui-bg)]',
          )}
        >
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            aria-label="Search options"
            className="w-full border-b border-[var(--wui-border)] bg-transparent px-2.5 py-1.5 text-[13px] outline-none"
          />

          <div className="max-h-56 overflow-y-auto py-1" role="listbox">
            {failed && (
              <p className="px-2.5 py-2 text-[12px] text-[var(--wui-status-failed)]">
                {/* An empty list would read as "you have none" — say what happened. */}
                Could not load choices. {(query.error as Error | undefined)?.message ?? ''}
              </p>
            )}
            {!failed && notice && (
              <p className="px-2.5 py-2 text-[12px] text-[var(--wui-fg-muted)]">{notice}</p>
            )}
            {!failed && !notice && items.length === 0 && !query.isFetching && (
              <p className="px-2.5 py-2 text-[12px] text-[var(--wui-fg-muted)]">Nothing to show</p>
            )}

            {items.map((item) => (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={selected.includes(item.value)}
                disabled={item.disabled === true}
                title={item.disabled === true ? item.disabledReason : undefined}
                onClick={() => {
                  // Only the id is kept: the label is display, and is fetched
                  // again next time this workflow is opened.
                  if (!multi) {
                    onChange(item.value);
                    setOpen(false);
                    return;
                  }
                  // Picking several is a series of decisions, so the list stays
                  // open and a second click takes one back off.
                  onChange(
                    selected.includes(item.value)
                      ? selected.filter((v) => v !== item.value)
                      : [...selected, item.value],
                  );
                }}
                className={cn(
                  'flex w-full items-start justify-between gap-2 px-2.5 py-1.5 text-left text-[13px]',
                  'hover:bg-[var(--wui-bg-subtle)]',
                  item.disabled === true && 'cursor-not-allowed opacity-50',
                  selected.includes(item.value) && 'bg-[var(--wui-bg-subtle)]',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{item.label}</span>
                  {item.description && (
                    <span className="block truncate text-[11px] text-[var(--wui-fg-muted)]">
                      {item.description}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {item.hint && (
                    <span className="text-[11px] text-[var(--wui-fg-muted)]">{item.hint}</span>
                  )}
                  {multi && selected.includes(item.value) && (
                    <span aria-hidden className="text-[var(--wui-accent)]">✓</span>
                  )}
                </span>
              </button>
            ))}

            {query.isFetching && (
              <p className="px-2.5 py-2 text-[12px] text-[var(--wui-fg-muted)]">Loading…</p>
            )}

            {query.data?.nextCursor && !query.isFetching && (
              <button
                type="button"
                onClick={() => setCursor(query.data?.nextCursor)}
                className="w-full px-2.5 py-1.5 text-left text-[12px] text-[var(--wui-accent)] hover:bg-[var(--wui-bg-subtle)]"
              >
                Load more
                {query.data.total ? ` (${String(items.length)} of ${String(query.data.total)})` : ''}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function OptionSuggestions({
  scope,
  field,
  config,
  search,
  onPick,
}: {
  scope: FieldOptionsScope;
  field: string;
  config: Record<string, unknown>;
  search: string;
  onPick: (value: string) => void;
}) {
  const query = useFieldOptions({ scope, field, config, search, enabled: true });
  const items = query.data?.items ?? [];
  const notice = query.data?.notice;

  if (!notice && items.length === 0 && !query.isError) return null;

  return (
    <div
      role="listbox"
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-[var(--wui-radius-sm)] border py-1 shadow-lg',
        'border-[var(--wui-border)] bg-[var(--wui-bg)]',
      )}
    >
      {query.isError && (
        <p className="px-2.5 py-2 text-[12px] text-[var(--wui-status-failed)]">
          {/* An empty list would read as "you have none" — say what happened. */}
          Could not load choices. {(query.error as Error | undefined)?.message ?? ''}
        </p>
      )}

      {!query.isError && notice && (
        <p className="px-2.5 py-2 text-[12px] text-[var(--wui-fg-muted)]">{notice}</p>
      )}

      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="option"
          aria-selected={false}
          disabled={item.disabled === true}
          title={item.disabled === true ? item.disabledReason : undefined}
          onClick={() => onPick(item.value)}
          className={cn(
            'flex w-full items-start justify-between gap-2 px-2.5 py-1.5 text-left text-[13px]',
            'hover:bg-[var(--wui-bg-subtle)]',
            item.disabled === true && 'cursor-not-allowed opacity-50',
          )}
        >
          <span className="min-w-0">
            <span className="block truncate">{item.label}</span>
            {item.description && (
              <span className="block truncate text-[11px] text-[var(--wui-fg-muted)]">
                {item.description}
              </span>
            )}
          </span>
          {item.hint && (
            <span className="shrink-0 text-[11px] text-[var(--wui-fg-muted)]">{item.hint}</span>
          )}
        </button>
      ))}

      {query.data?.nextCursor && (
        <p className="px-2.5 py-1.5 text-[11px] text-[var(--wui-fg-muted)]">
          {/* Paging a suggestion list is noise; narrowing it is the real answer. */}
          More available — keep typing to narrow.
        </p>
      )}
    </div>
  );
}
