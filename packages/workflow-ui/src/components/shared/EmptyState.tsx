import * as React from 'react';
import { cn } from './cn.js';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 text-center',
        className,
      )}
    >
      <h3 className="text-sm font-medium text-[var(--wui-fg)]">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-[var(--wui-fg-muted)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
