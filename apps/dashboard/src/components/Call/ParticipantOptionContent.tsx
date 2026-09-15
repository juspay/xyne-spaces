import type { ReactNode } from 'react';

interface ParticipantOptionContentProps {
  icon: ReactNode;
  label: string;
  subtitle?: string | null | undefined;
  isDeactivated?: boolean;
}

/** Shared full-width participant row used by the call pickers. */
export function ParticipantOptionContent({
  icon,
  label,
  subtitle,
  isDeactivated = false,
}: ParticipantOptionContentProps): ReactNode {
  return (
    <div className='flex flex-1 items-center gap-2 min-w-0'>
      <span className='shrink-0'>{icon}</span>
      <div className='flex flex-1 min-w-0 items-center gap-2 text-left'>
        <span
          className={`shrink-0 truncate max-w-[50%] text-sm ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
        >
          {label}
        </span>
        {isDeactivated && (
          <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
            Deactivated
          </span>
        )}
        {subtitle && (
          <span className='flex-1 min-w-0 truncate text-xs text-muted-foreground'>{subtitle}</span>
        )}
      </div>
    </div>
  );
}
