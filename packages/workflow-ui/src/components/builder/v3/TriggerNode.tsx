import { cn } from '../../shared/cn.js';
import { getTriggerIcon } from '../icons.js';

export interface TriggerNodeProps {
  label?: string | undefined;
  icon?: string | undefined;
  isSelected: boolean;
  isConfigured: boolean;
  /** Trigger has validation issues — shows a red accent + badge (builder mode). */
  hasIssues?: boolean | undefined;
  onClick: () => void;
}

export function TriggerNode({
  label,
  icon,
  isSelected,
  isConfigured,
  hasIssues,
  onClick,
}: TriggerNodeProps) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        'relative flex h-16 w-48 cursor-pointer items-center gap-3 border-2 bg-white px-4 transition-all',
        // Asymmetric border-radius: pill-left, rounded-right
        'rounded-l-[2rem] rounded-r-xl',
        isConfigured
          ? isSelected
            ? 'border-indigo-400 ring-2 ring-indigo-200 shadow-md'
            : 'border-indigo-300 shadow-sm hover:shadow-md hover:border-indigo-400'
          : 'border-dashed border-slate-300 hover:border-indigo-300',
        hasIssues && 'border-red-300 ring-2 ring-red-300',
      )}
      style={{ animation: 'wui-scale-in 200ms ease-out' }}
    >
      {hasIssues && (
        <span className="absolute -left-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow ring-2 ring-white" title="Trigger has issues">!</span>
      )}
      {isConfigured ? (
        <>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            {getTriggerIcon(icon, { size: 18 })}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">
              {label}
            </div>
            <div className="text-[10px] text-indigo-500 uppercase tracking-wider font-medium">
              Trigger
            </div>
          </div>
        </>
      ) : (
        <div
          className="flex w-full items-center justify-center gap-2 text-slate-400"
          style={{ animation: 'wui-pulse 2s ease-in-out infinite' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span className="text-sm font-medium">Select Trigger</span>
        </div>
      )}
    </div>
  );
}
