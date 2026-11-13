import { useCallback, useState } from 'react';
import type { WorkflowStepConfig } from '@xyne/workflow-sdk/builder';
import type { DetectedBranch } from '../../../utils/branch-detection.js';
import { cn } from '../../shared/cn.js';
import { getCategoryTheme } from '../theme.js';

interface BranchContainerProps {
  stepId: string;
  branches: Record<string, DetectedBranch>;
  category?: string | undefined;
  /** Box header label (the step's name, e.g. "Parallel" / "Conditional" / "Switch"). */
  label?: string | undefined;
  /** For dynamic branch containers (PARALLEL) — the config key holding the record */
  dynamicContainer?: string | undefined;
  readOnly: boolean;
  onAddBranch?: (branchName: string) => void;
  onRenameBranch?: (oldName: string, newName: string) => void;
  /** Render function for branch content — provided by WorkflowTree */
  renderBranch: (branchKey: string, steps: WorkflowStepConfig[]) => React.ReactNode;
}

export function BranchContainer({
  branches,
  category,
  label,
  dynamicContainer,
  readOnly,
  onAddBranch,
  onRenameBranch,
  renderBranch,
}: BranchContainerProps) {
  const theme = getCategoryTheme(category);
  const entries = Object.entries(branches);
  const [showInput, setShowInput] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = useCallback(() => {
    const name = branchName.trim();
    if (name && onAddBranch) {
      onAddBranch(name);
      setBranchName('');
      setShowInput(false);
    }
  }, [branchName, onAddBranch]);

  return (
    <div className="flex flex-col items-center">
      {/* Fanout box — mirrors LoopContainer so parallel/conditional/switch read
          as a contained unit. */}
      <div
        className={cn(
          'relative rounded-xl border-2 border-dashed px-6',
          'bg-gradient-to-b from-slate-50/80 to-white',
        )}
        style={{ borderColor: `${theme.edgeColor}40` }}
      >
        {/* Header badge */}
        <div className={cn(
          'absolute -top-3 left-4 flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
          'text-[10px] font-semibold uppercase tracking-wider',
          theme.iconBg, theme.iconText,
        )}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          {label ?? 'Branches'}
        </div>

        {/* Spur from box top edge into the fork bar (no top padding → continuous line) */}
        <div className="mx-auto h-4 w-px bg-slate-300" />

        {/* Horizontal fork bar */}
        <div
          className="h-px rounded-full"
          style={{
            backgroundColor: theme.edgeColor,
            opacity: 0.4,
            width: '100%',
            minWidth: `${entries.length * 200}px`,
          }}
        />

        {/* Branch lanes — items-stretch so every lane reaches the merge bar even
            when branches differ in length. */}
        <div className="flex items-stretch gap-4">
        {entries.map(([branchKey, branch]) => (
          <div
            key={branchKey}
            className="flex flex-col items-center"
            style={{ minWidth: '200px' }}
          >
            {/* Branch label — editable for dynamic containers */}
            {editingKey === branchKey ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    const name = editValue.trim();
                    if (name && name !== branchKey && onRenameBranch) {
                      onRenameBranch(branchKey, name);
                    }
                    setEditingKey(null);
                  }
                  if (e.key === 'Escape') setEditingKey(null);
                }}
                onBlur={() => {
                  const name = editValue.trim();
                  if (name && name !== branchKey && onRenameBranch) {
                    onRenameBranch(branchKey, name);
                  }
                  setEditingKey(null);
                }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                className={cn(
                  'mb-2 mt-1 w-24 rounded-full px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-center outline-none',
                  'border border-indigo-300 ring-1 ring-indigo-100',
                  theme.lightBg, theme.iconText,
                )}
              />
            ) : (
              <div
                className={cn(
                  'mb-2 mt-1 rounded-full px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                  theme.lightBg, theme.iconText,
                  dynamicContainer && !readOnly && 'cursor-pointer hover:ring-1 hover:ring-indigo-200 transition-all',
                )}
                onDoubleClick={() => {
                  if (dynamicContainer && !readOnly) {
                    setEditingKey(branchKey);
                    setEditValue(branchKey);
                  }
                }}
                title={dynamicContainer && !readOnly ? 'Double-click to rename' : undefined}
              >
                {branch.label}
              </div>
            )}

            {/* Vertical connector into branch */}
            <div className="h-4 w-px bg-slate-300" />

            {/* Branch content */}
            <div className="flex flex-col items-center">
              {renderBranch(branchKey, branch.steps)}
            </div>

            {/* Vertical connector out of branch — grows so shorter branches
                still reach the merge bar at the bottom. */}
            <div className="min-h-[16px] w-px flex-1 bg-slate-300" />
          </div>
        ))}

        {/* Add branch button for dynamic containers */}
        {dynamicContainer && !readOnly && !showInput && (
          <div className="flex flex-col items-center justify-start pt-1">
            <button
              onClick={(e) => { e.stopPropagation(); setShowInput(true); }}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full border border-dashed px-3',
                'border-slate-300 text-slate-400 text-[11px] font-medium',
                'hover:border-indigo-400 hover:text-indigo-500 transition-all',
              )}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14" /><path d="M5 12h14" />
              </svg>
              Branch
            </button>
          </div>
        )}

        {/* Inline branch name input */}
        {showInput && (
          <div className="flex flex-col items-center justify-start pt-1">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') handleAdd();
                  if (e.key === 'Escape') { setShowInput(false); setBranchName(''); }
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="Branch name..."
                autoFocus
                className="w-28 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100"
              />
              <button
                onClick={(e) => { e.stopPropagation(); handleAdd(); }}
                className="flex h-6 w-6 items-center justify-center rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </button>
            </div>
          </div>
        )}
        </div>

        {/* Merge connector bar */}
        <div
          className="h-px rounded-full"
          style={{
            backgroundColor: theme.edgeColor,
            opacity: 0.4,
            width: '100%',
            minWidth: `${entries.length * 200}px`,
          }}
        />

        {/* Spur from merge bar to box bottom edge (no bottom padding → continuous line) */}
        <div className="mx-auto h-4 w-px bg-slate-300" />
      </div>

      {/* Merge point — below the box, into the next connector */}
      <div className="h-4 w-px bg-slate-300" />
    </div>
  );
}
