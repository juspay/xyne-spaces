/**
 * The settings under a screen's content: one line each, stating what they are
 * set to.
 *
 * A panel of open sections asks you to read all of it to find the one thing you
 * came for. A list of closed rows that say their own value asks you to read one
 * line — and nothing is hidden, because the value is on the row. Open the one
 * you want to change.
 */
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../shared/cn.js';

export function SettingsList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col border-t border-[var(--wui-border)]">{children}</div>;
}

/**
 * A heading over a run of rows, for when the panel holds settings about two
 * different things — the conversation, and the screen you are on.
 */
export function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="border-b border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-5 py-1.5 text-[11.5px] font-semibold text-[var(--wui-fg-muted)]">
        {label}
      </h3>
      {children}
    </section>
  );
}

/** A row that opens: the label, what it is set to, and the controls inside. */
export function SettingRow({
  label,
  value,
  attention,
  defaultOpen,
  children,
}: {
  label: string;
  /** What it is set to — read without opening the row. */
  value: ReactNode;
  /** Worth looking at: shown as a dot beside the value. */
  attention?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group/row border-b border-[var(--wui-border)] last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-2.5 hover:bg-[var(--wui-bg-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--wui-primary)]">
        <span className="shrink-0 text-[13px] text-[var(--wui-fg)]">{label}</span>
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          {attention && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: 'var(--wui-cf-questions)' }}
            />
          )}
          <span className="truncate text-right text-[12.5px] text-[var(--wui-fg-muted)]">{value}</span>
        </span>
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-[var(--wui-fg-muted)] transition-transform group-open/row:rotate-90"
          aria-hidden
        />
      </summary>
      <div className="flex flex-col gap-2.5 px-5 pb-4 pt-0.5">{children}</div>
    </details>
  );
}

/** A row that is the setting: on or off, changed where it is read. */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-3 border-b border-[var(--wui-border)] px-5 py-2.5 last:border-b-0',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-[var(--wui-bg-subtle)]',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-[var(--wui-fg)]">{label}</span>
        {hint && <span className="block text-[12px] leading-snug text-[var(--wui-fg-muted)]">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--wui-primary)]"
      />
    </label>
  );
}
