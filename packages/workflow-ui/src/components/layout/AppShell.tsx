import React from 'react';
import { cn } from '../shared/cn.js';

export interface AppShellProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function AppShell({ sidebar, children, className }: AppShellProps) {
  return (
    <div
      data-workflow-ui
      className={cn(
        'flex h-screen w-full overflow-hidden',
        className
      )}
      style={{ background: 'var(--wui-bg)' }}
    >
      {/* Fixed-width sidebar */}
      <aside
        className="flex-none overflow-y-auto overflow-x-hidden"
        style={{ width: 240 }}
      >
        {sidebar}
      </aside>

      {/* Thin separator line */}
      <div
        className="flex-none"
        style={{
          width: 1,
          background: 'var(--wui-border)',
        }}
      />

      {/* Main content — fills remaining width */}
      <main
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ background: 'var(--wui-bg-subtle)' }}
      >
        {children}
      </main>
    </div>
  );
}
