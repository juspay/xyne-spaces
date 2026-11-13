import * as React from 'react';
import { cn } from './cn.js';

interface ErrorBoundaryState {
  error: Error | null;
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  className?: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          className={cn(
            'rounded-[var(--wui-radius)] border border-[var(--wui-status-failed)]/30 bg-[var(--wui-status-failed)]/5 p-4',
            this.props.className,
          )}
        >
          <h3 className="text-sm font-medium text-[var(--wui-status-failed)]">
            Something went wrong
          </h3>
          <p className="mt-1 text-xs text-[var(--wui-fg-muted)]">
            {this.state.error.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
