import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from './cn.js';

/**
 * Shared section toolbar — one consistent bar across the workflow tabs
 * (Workflows / Executions / Approvals) so every tab reads as the same surface.
 * `left` holds context (breadcrumb / label); `right` holds controls.
 */
export function SectionToolbar({
  left,
  right,
  className,
}: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        'flex h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5',
        'border-b border-[var(--wui-border)]',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">{left}</div>
      {right ? <div className="flex items-center gap-1.5">{right}</div> : null}
    </div>
  );
}

/** Base styling shared by every compact toolbar control (h-8, one radius). */
export const toolbarControl =
  'inline-flex h-7 items-center justify-center gap-1 rounded-[var(--wui-control-radius)] border border-[var(--wui-control-border)] ' +
  'bg-[var(--wui-control-bg)] text-[12px] font-medium text-[var(--wui-control-fg)] transition-colors ' +
  'hover:bg-[var(--wui-control-bg-hover)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--wui-primary)_30%,transparent)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function ToolbarButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn(toolbarControl, 'px-2', className)} {...props} />;
}

export function ToolbarIconButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn(toolbarControl, 'w-7', className)} {...props} />;
}

export function ToolbarSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(toolbarControl, 'cursor-pointer px-2 pr-7', className)} {...props}>
      {children}
    </select>
  );
}
