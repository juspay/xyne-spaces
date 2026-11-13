import type { WorkflowStepConfig } from '@xyne/workflow-sdk/builder';
import { getCategoryTheme } from '../theme.js';
import { cn } from '../../shared/cn.js';

interface LoopContainerProps {
  category?: string | undefined;
  bodySteps: WorkflowStepConfig[];
  /** Badge text — defaults to "Iterates" (LOOP); MAP passes "Maps (concurrent)". */
  label?: string | undefined;
  renderBody: (steps: WorkflowStepConfig[]) => React.ReactNode;
}

export function LoopContainer({
  category,
  bodySteps,
  label,
  renderBody,
}: LoopContainerProps) {
  const theme = getCategoryTheme(category);

  return (
    <div className="flex flex-col items-center">
      {/* Loop body container */}
      <div
        className={cn(
          'relative rounded-xl border-2 border-dashed px-6 py-4',
          'bg-gradient-to-b from-slate-50/80 to-white',
        )}
        style={{ borderColor: `${theme.edgeColor}40` }}
      >
        {/* Loop indicator badge */}
        <div className={cn(
          'absolute -top-3 left-4 flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
          'text-[10px] font-semibold uppercase tracking-wider',
          theme.iconBg, theme.iconText,
        )}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          {label ?? 'Iterates'}
        </div>

        {/* Body steps */}
        <div className="mt-2 flex flex-col items-center">
          {renderBody(bodySteps)}
        </div>
      </div>
    </div>
  );
}
