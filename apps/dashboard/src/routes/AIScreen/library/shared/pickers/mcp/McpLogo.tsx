import { useEffect, useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';

const MCP_ICON_BASE = '/assets/mcp';
const EXTENSIONS = ['png', 'svg'] as const;
const MCP_TRANSPARENT = new Set(['xyne-spaces']);

const SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'size-7 rounded-lg p-1 text-[10px]',
  md: 'size-10 rounded-lg p-1.5 text-xs',
  lg: 'size-11 rounded-xl p-2 text-xs',
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function McpLogo({
  type,
  name,
  size = 'sm',
}: {
  type: string;
  name: string;
  size?: keyof typeof SIZE;
}): ReactElement {
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setAttempt(0), [type]);

  const extension = EXTENSIONS[attempt];
  const background = MCP_TRANSPARENT.has(type) ? 'bg-transparent' : 'bg-card';

  if (!type || !extension) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center border border-border font-semibold text-muted-foreground shadow-sm',
          SIZE[size],
          background,
        )}
        aria-hidden
      >
        {initials(name)}
      </div>
    );
  }

  return (
    <img
      key={extension}
      src={`${MCP_ICON_BASE}/${type}.${extension}`}
      alt=''
      aria-hidden='true'
      onError={() => setAttempt(next => next + 1)}
      className={cn(
        'shrink-0 border border-border object-contain shadow-sm',
        SIZE[size],
        background,
      )}
    />
  );
}
