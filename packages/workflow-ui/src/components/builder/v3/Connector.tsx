import { cn } from '../../shared/cn.js';

interface ConnectorProps {
  showAddButton?: boolean;
  onAdd?: () => void;
}

export function Connector({ showAddButton, onAdd }: ConnectorProps) {
  if (!showAddButton) {
    return <div className="h-8 w-px bg-slate-300" />;
  }

  return (
    <div className="flex flex-col items-center">
      <div className="h-3 w-px bg-slate-300" />
      <button
        onClick={(e) => { e.stopPropagation(); onAdd?.(); }}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full',
          'border border-slate-200 bg-white text-slate-400 shadow-sm',
          'transition-all hover:border-indigo-400 hover:text-indigo-500 hover:shadow-md hover:scale-110',
        )}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M12 5v14" /><path d="M5 12h14" />
        </svg>
      </button>
      <div className="h-3 w-px bg-slate-300" />
    </div>
  );
}
