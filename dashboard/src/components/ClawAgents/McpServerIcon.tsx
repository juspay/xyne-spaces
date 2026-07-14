import { ReactElement, useState } from 'react';
import { cn } from '@/utils/classNames';
import type { McpServer } from '@/services/claw/clawMcpTypes';

// Brand icons copied from xyne-claw-auth into the dashboard's public dir, so
// they load same-origin (dev + prod) instead of from the cross-app /claw path.
const MCP_ICON_BASE = '/assets/mcp';

// Icons are PNG for every integration that has one. These few stay SVG: gmail &
// google-drive (logo.dev only returns the generic Google "G"), and
// sequentialthinking & xyne-spaces (not real brands, so no logo exists).
const MCP_SVG_ONLY = new Set(['gmail', 'google-drive', 'sequentialthinking', 'xyne-spaces']);
const MCP_ICON_BG: Record<string, string> = { 'xyne-spaces': 'bg-transparent' };

const SIZE: Record<'md' | 'lg', string> = {
  md: 'size-10 rounded-lg p-1.5 text-xs',
  lg: 'size-12 rounded-xl p-2 text-sm',
};

/** Initials from a name, e.g. "Google Drive" -> "GD". */
const getInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

/** Brand icon from the claw assets, falling back to initials on error. */
export const McpServerIcon = ({
  server,
  size = 'md',
}: {
  server: McpServer;
  size?: 'md' | 'lg';
}): ReactElement => {
  const [errored, setErrored] = useState(false);
  const bg = MCP_ICON_BG[server.type] ?? 'bg-muted';
  const sizeCls = SIZE[size];

  if (errored || !server.type) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center border border-border font-semibold text-muted-foreground',
          sizeCls,
          bg,
        )}
      >
        {getInitials(server.name)}
      </div>
    );
  }

  const ext = MCP_SVG_ONLY.has(server.type) ? 'svg' : 'png';
  return (
    <img
      src={`${MCP_ICON_BASE}/${server.type}.${ext}`}
      alt=''
      aria-hidden='true'
      onError={() => setErrored(true)}
      className={cn('shrink-0 border border-border object-contain', sizeCls, bg)}
    />
  );
};
