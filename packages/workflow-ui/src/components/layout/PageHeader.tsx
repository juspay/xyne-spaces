import React from 'react';
import { cn } from '../shared/cn.js';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-start justify-between gap-6 px-7 py-5',
        className
      )}
      style={{
        background: 'var(--wui-bg-subtle)',
        borderBottom: '1px solid var(--wui-border)',
      }}
    >
      {/* ── Left: breadcrumb + title block ── */}
      <div className="flex min-w-0 flex-col gap-1">
        {breadcrumb && (
          <div className="mb-0.5">
            {breadcrumb}
          </div>
        )}

        <h1
          className="text-[18px] font-semibold leading-tight tracking-[-0.02em] truncate"
          style={{ color: 'var(--wui-fg)' }}
        >
          {title}
        </h1>

        {subtitle && (
          <p
            className="text-[13px] leading-snug truncate"
            style={{ color: 'var(--wui-fg-muted)' }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {/* ── Right: action slot ── */}
      {actions && (
        <div className="flex flex-none items-center gap-2 pt-0.5">
          {actions}
        </div>
      )}
    </header>
  );
}
