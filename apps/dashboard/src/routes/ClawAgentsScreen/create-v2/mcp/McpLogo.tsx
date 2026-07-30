import { useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';

const MCP_ICON_BASE = '/assets/mcp';
const MCP_SVG_ONLY = new Set(['gmail', 'google-drive', 'sequentialthinking', 'xyne-spaces']);
const MCP_TRANSPARENT = new Set(['xyne-spaces']);

const SIZE: Record<'sm' | 'lg', string> = {
  sm: 'size-7 rounded-lg p-1 text-[10px]',
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
  size?: 'sm' | 'lg';
}): ReactElement {
  const [errored, setErrored] = useState(false);
  const background = MCP_TRANSPARENT.has(type) ? 'bg-transparent' : 'bg-card';

  if (errored || !type) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center border border-border font-semibold text-muted-foreground',
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
      src={`${MCP_ICON_BASE}/${type}.${MCP_SVG_ONLY.has(type) ? 'svg' : 'png'}`}
      alt=''
      aria-hidden='true'
      onError={() => setErrored(true)}
      className={cn('shrink-0 border border-border object-contain', SIZE[size], background)}
    />
  );
}
