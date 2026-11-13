import type { WorkflowRecord, FolderRecord } from '@xyne/workflow-sdk/client';
import type { StatusVariant } from '../shared/StatusBadge.js';
import { cn } from '../shared/cn.js';
import { StatusBadge } from '../shared/StatusBadge.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParseMeta(raw: string | null): { name?: string } {
  if (!raw) return {};
  try { return JSON.parse(raw) as { name?: string }; }
  catch { return {}; }
}

function safeParseConfig(raw: string | null): {
  steps?: unknown[];
  trigger?: { type?: string };
} {
  if (!raw) return {};
  try { return JSON.parse(raw) as { steps?: unknown[]; trigger?: { type?: string } }; }
  catch { return {}; }
}

function statusToVariant(status: string): StatusVariant {
  if (status === 'active') return 'completed';
  return 'pending';
}

// ─── Trigger icon ─────────────────────────────────────────────────────────────

const TRIGGER_COLORS: Record<string, string> = {
  manual:  'bg-violet-500',
  webhook: 'bg-sky-500',
  webhook_v2: 'bg-sky-500',
  cron:    'bg-amber-500',
  event:   'bg-emerald-500',
};

function triggerLabel(type: string): string {
  return type.toUpperCase() === 'WEBHOOK_V2'
    ? 'Webhook V2'
    : type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

function TriggerIcon({ type }: { type: string }) {
  const key = type.toLowerCase();
  const colorClass = TRIGGER_COLORS[key] ?? 'bg-slate-400';
  const title = triggerLabel(type);

  return (
    <span
      className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', colorClass)}
      title={`${title} trigger`}
      aria-label={`${title} trigger`}
    >
      {(key === 'webhook' || key === 'webhook_v2') && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/>
          <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/>
          <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>
        </svg>
      )}
      {key === 'cron' && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      )}
      {key === 'event' && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      )}
      {key === 'manual' && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      )}
      {!['manual','webhook','webhook_v2','cron','event'].includes(key) && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
        </svg>
      )}
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AutomationCardProps {
  workflow: WorkflowRecord;
  onClick: () => void;
  onRun?: (() => void) | undefined;
  /** Folders available to move this workflow into. Enables the move control. */
  folders?: FolderRecord[] | undefined;
  /** Move this workflow to another folder. */
  onMove?: ((folderId: string) => void) | undefined;
  /** Visual layout: a grid card (default) or a compact list row. */
  layout?: 'card' | 'row' | undefined;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AutomationCard({ workflow, onClick, onRun, folders, onMove, layout = 'card' }: AutomationCardProps) {
  const meta   = safeParseMeta(workflow.metadata);
  const config = safeParseConfig(workflow.config);

  const name        = meta.name ?? workflow.id;
  const stepCount   = config.steps?.length ?? 0;
  const triggerType = config.trigger?.type ?? 'Unknown';
  const triggerName = triggerLabel(triggerType);
  const variant     = statusToVariant(workflow.status);

  const moveControl = folders && onMove ? (
    <select
      value={workflow.folderId}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { e.stopPropagation(); onMove(e.target.value); }}
      title="Move to folder"
      aria-label={`Move ${name} to folder`}
      className={cn(
        'max-w-[8rem] truncate rounded-[var(--wui-radius)] px-1.5 py-1 text-xs',
        'border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] text-[var(--wui-fg-muted)]',
        'outline-none focus-visible:ring-2 focus-visible:ring-[var(--wui-primary)]',
      )}
    >
      {folders.map((f) => (
        <option key={f.id} value={f.id}>{f.name}</option>
      ))}
    </select>
  ) : null;

  const runControl = onRun ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRun(); }}
      className={cn(
        'flex items-center gap-1.5 rounded-[var(--wui-radius)] px-2.5 py-1',
        'text-xs font-medium text-[var(--wui-fg-muted)]',
        'border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)]',
        'transition-colors hover:border-[var(--wui-primary)] hover:text-[var(--wui-primary)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wui-primary)]',
      )}
      aria-label={`Run ${name}`}
    >
      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      Run
    </button>
  ) : null;

  // ─── List row layout ───
  if (layout === 'row') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
        className={cn(
          'group flex items-center gap-3 border-b border-[var(--wui-border)] px-4 py-2.5 text-left outline-none',
          'cursor-pointer transition-colors hover:bg-[var(--wui-bg-subtle)]',
          'focus-visible:ring-2 focus-visible:ring-[var(--wui-primary)] focus-visible:ring-inset',
        )}
      >
        <TriggerIcon type={triggerType} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--wui-fg)]" title={name}>
          {name}
        </span>
        <span className="hidden w-24 shrink-0 truncate text-xs text-[var(--wui-fg-muted)] sm:block">
          {triggerName}
        </span>
        <span className="hidden w-16 shrink-0 text-xs text-[var(--wui-fg-muted)] md:block">
          {stepCount} {stepCount === 1 ? 'step' : 'steps'}
        </span>
        <span className="w-20 shrink-0">
          <StatusBadge status={variant} label={workflow.status} />
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {moveControl}
          {runControl}
        </div>
      </div>
    );
  }

  // ─── Grid card layout (default) ───
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={cn(
        'group relative flex flex-col gap-3 rounded-xl border border-[var(--wui-border)]',
        'bg-[var(--wui-bg)] p-4 text-left outline-none',
        'cursor-pointer transition-all duration-150',
        'hover:shadow-[var(--wui-shadow-sm)] hover:-translate-y-px',
        'focus-visible:ring-2 focus-visible:ring-[var(--wui-primary)] focus-visible:ring-offset-2',
      )}
    >
      {/* Top row: trigger icon + name */}
      <div className="flex items-start gap-2.5">
        <TriggerIcon type={triggerType} />
        <h3
          className="flex-1 truncate text-sm font-semibold leading-tight text-[var(--wui-fg)]"
          title={name}
        >
          {name}
        </h3>
      </div>

      {/* Middle row: trigger type + step count */}
      <div className="flex items-center gap-3 text-xs text-[var(--wui-fg-muted)]">
        <span className="flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6"/>
          </svg>
          {triggerName}
        </span>

        <span className="text-[var(--wui-border)]">·</span>

        <span className="flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
          </svg>
          {stepCount} {stepCount === 1 ? 'step' : 'steps'}
        </span>
      </div>

      {/* Bottom row: status badge + move + run button */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <StatusBadge status={variant} label={workflow.status} />
        <div className="ml-auto flex items-center gap-2">
          {moveControl}
          {runControl}
        </div>
      </div>
    </article>
  );
}
