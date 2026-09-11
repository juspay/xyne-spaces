import React, { useState } from 'react';
import { cn } from '../../../../utils/classNames';

/**
 * Brand tile for a capability chip — the 28px dashed-outline square the agent
 * design puts in front of an integration's name.
 *
 * Reuses the icon assets the dashboard already ships at /assets/mcp (same files
 * McpServerIcon draws from), keyed by the capability's `iconKey` (an MCP
 * serverType). That component isn't reused directly because its tile is a fixed
 * solid-border, shadowed frame and this design calls for a dashed 28px one; the
 * asset convention is what matters and that is shared.
 *
 * Falls back png → svg → initials, so a capability with no brand asset (custom
 * tools, new connectors) still renders something stable rather than a broken
 * image.
 */

type Stage = 'png' | 'svg' | 'initials';

const initialsFor = (label: string): string => {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return (words[0] ?? '').slice(0, 2).toUpperCase();
  }
  return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
};

export const CapabilityIcon: React.FC<{
  iconKey?: string | undefined;
  label: string;
  className?: string;
}> = ({ iconKey, label, className }) => {
  const [stage, setStage] = useState<Stage>(iconKey ? 'png' : 'initials');

  // No fill, no border: the logo sits directly on the chip. Brand marks carry
  // their own colour and shape, and a framed tile around them was a second
  // surface inside an already bordered pill.
  const tile = cn(
    'flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg',
    className,
  );

  if (!iconKey || stage === 'initials') {
    return (
      <span aria-hidden className={cn(tile, 'text-[10px] font-medium text-muted-foreground')}>
        {initialsFor(label)}
      </span>
    );
  }

  return (
    <span aria-hidden className={tile}>
      <img
        src={`/assets/mcp/${iconKey}.${stage}`}
        alt=''
        aria-hidden='true'
        // png first (most integrations), then svg (gmail, google-drive,
        // xyne-spaces…), then give up and show initials.
        onError={(): void => setStage(stage === 'png' ? 'svg' : 'initials')}
        className='size-full object-contain p-1'
      />
    </span>
  );
};
