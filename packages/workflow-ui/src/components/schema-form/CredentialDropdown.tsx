import { useEffect, useRef, useState } from 'react';
import type { CredentialSummary } from '@xyne/workflow-sdk/common';
import { useWorkflowClient } from '../../hooks/use-workflow-client.js';
import { cn } from '../shared/cn.js';

/** The value that means "no credential selected". */
const NONE_VALUE = '';

// Renders the credential picker for a step or trigger: a searchable listbox of
// the workspace's ACTIVE credentials of the accepted types (metadata only —
// values are never fetched).
export function CredentialDropdown({
  value,
  onChange,
  readOnly,
  ariaLabel,
  accepts,
}: {
  /** Selected credential name; `''` means "No credential". */
  value: string;
  onChange: (name: string) => void;
  readOnly?: boolean | undefined;
  ariaLabel?: string | undefined;
  /**
   * Credential types the field accepts, e.g. `['GITHUB_WEBHOOK_SECRET']`. Only
   * credentials of these types are offered. Absent or empty offers every type.
   */
  accepts?: readonly string[] | undefined;
}) {
  const client = useWorkflowClient();
  // `null` = still loading; an array = loaded (possibly empty).
  const [credentials, setCredentials] = useState<CredentialSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load the safe summaries once. `cancelled` guards against setState after
  // unmount. This calls the metadata-only list endpoint — no values are fetched.
  useEffect(() => {
    let cancelled = false;
    client.credentials
      .list()
      .then((res) => {
        if (!cancelled) {
          setCredentials(res.credentials.map((credential) => credential.summary));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Close on outside-click / Escape (mirrors the shared Select behaviour).
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const loaded = credentials ?? [];
  const isAccepted = (credType: string): boolean =>
    !accepts || accepts.length === 0 || accepts.includes(credType);
  const activeCredentials = loaded.filter(
    (c) => c.status === 'ACTIVE' && isAccepted(c.credType),
  );
  const selected = value ? loaded.find((c) => c.name === value) : undefined;
  // Why the current value cannot be used: missing (deleted elsewhere), revoked,
  // or a type this field no longer accepts. Surfaced rather than dropped, so
  // the author sees exactly what the node references.
  const unavailableReason: string | null =
    !value || credentials === null
      ? null
      : !selected
        ? 'unavailable'
        : selected.status === 'REVOKED'
          ? 'revoked'
          : !isAccepted(selected.credType)
            ? 'wrong type'
            : null;
  const selectionUnavailable = unavailableReason !== null;

  const triggerLabel = (() => {
    if (!value) return 'Select...';
    if (selected) {
      return `${selected.name}${unavailableReason ? ` (${unavailableReason})` : ''}`;
    }
    // Loaded and missing, or still loading — show the raw name.
    return credentials === null ? value : `${value} (unavailable)`;
  })();

  const toggle = () => {
    if (readOnly) return;
    if (!open) {
      setQuery('');
      const rect = ref.current?.getBoundingClientRect();
      setOpenUp(!!rect && rect.bottom > window.innerHeight - 320);
    }
    setOpen((o) => !o);
  };

  // Autofocus the search box when the menu opens.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Keep the picker intentionally simple: search credential names only.
  const q = query.trim().toLowerCase();
  const filtered = activeCredentials.filter(
    (c) => !q || c.name.toLowerCase().includes(q),
  );

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={readOnly}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? 'Credential'}
        onClick={toggle}
        className={cn(
          'flex w-full items-center justify-between gap-1.5 rounded-lg border bg-white px-3 py-2 text-left text-sm text-[var(--wui-fg)] transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open
            ? 'border-[var(--wui-primary)] ring-1 ring-[var(--wui-primary)]'
            : 'border-[var(--wui-border)] hover:border-[var(--wui-border-strong)]',
        )}
      >
        <span
          className={cn(
            'min-w-0 truncate',
            !value && 'text-[var(--wui-fg-muted)]',
            selectionUnavailable && 'text-[var(--wui-danger,#e5484d)]',
          )}
        >
          {triggerLabel}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[var(--wui-fg-muted)] transition-transform',
            open && 'rotate-180',
          )}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute left-0 z-50 flex max-h-72 w-full flex-col overflow-hidden rounded-lg border border-[var(--wui-border)] bg-white shadow-lg',
            openUp ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {error ? (
            <div className="px-2.5 py-2 text-[13px] text-[var(--wui-danger,#e5484d)]">
              Failed to load credentials
            </div>
          ) : credentials === null ? (
            <div className="px-2.5 py-2 text-[13px] text-[var(--wui-fg-muted)]">
              Loading…
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-[var(--wui-border)] p-2">
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search credentials..."
                  aria-label="Search credentials"
                  className="w-full rounded-md border border-[var(--wui-border)] bg-white px-2.5 py-2 text-sm text-[var(--wui-fg)] outline-none placeholder:text-[var(--wui-fg-muted)] focus:border-[var(--wui-primary)]"
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {/* "No credential" — always available (unfiltered clear action). */}
                <OptionRow
                  label="Select..."
                  selected={!value}
                  muted
                  onClick={() => choose(NONE_VALUE)}
                />

                {/* Preserve a revoked/missing current selection as a disabled row
                    so the value is never silently dropped. */}
                {selectionUnavailable && (
                  <OptionRow
                    label={`${value} (${unavailableReason ?? 'unavailable'})`}
                    selected
                    disabled
                  />
                )}

                {filtered.map((c) => (
                  <OptionRow
                    key={c.name}
                    label={c.name}
                    selected={c.name === value}
                    onClick={() => choose(c.name)}
                  />
                ))}

                {filtered.length === 0 && q ? (
                  <div className="px-2.5 py-2 text-center text-[13px] text-[var(--wui-fg-muted)]">
                    No credentials match “{query.trim()}”
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-2.5 py-2 text-center text-[13px] text-[var(--wui-fg-muted)]">
                    No credentials of the right type yet. Create one under Credentials.
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A single option row in the credential menu. Disabled rows are non-interactive. */
function OptionRow({
  label,
  selected,
  disabled,
  muted,
  onClick,
}: {
  label: string;
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  muted?: boolean | undefined;
  onClick?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={!!selected}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm transition-colors',
        disabled && 'cursor-not-allowed opacity-50',
        selected
          ? 'font-medium text-[var(--wui-fg)]'
          : muted
            ? 'text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)]'
            : 'text-[var(--wui-fg)] hover:bg-[var(--wui-bg-muted)]',
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {selected && !disabled && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        )}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
