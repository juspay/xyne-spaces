import type { FolderRecord } from '@xyne/workflow-sdk/client';

interface FolderCardProps {
  folder: FolderRecord;
  total: number;
  active: number;
  onClick: () => void;
  subFolderCount?: number | undefined;
}

export function FolderCard({ folder, total, active, onClick, subFolderCount }: FolderCardProps) {
  const isParent = subFolderCount !== undefined && subFolderCount > 0;
  const fillPct = total > 0 ? Math.min(100, Math.round((active / total) * 100)) : 0;
  const stopped = total - active;

  const barColor =
    fillPct >= 80
      ? 'var(--wui-status-completed)'
      : fillPct >= 50
        ? 'var(--wui-status-paused)'
        : 'var(--wui-status-failed)';

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full overflow-hidden rounded-xl border border-[var(--wui-border)] text-left transition-all hover:border-[var(--wui-primary)] hover:shadow-md"
      style={{ background: 'var(--wui-bg, #ffffff)' }}
    >
      {/* Left accent bar */}
      <div className="w-[3px] shrink-0 bg-[var(--wui-primary)] opacity-80" />

      {/* Right: content + footer stacked */}
      <div className="flex flex-1 flex-col">
        <div className="flex flex-col gap-4 p-4">
          {/* Header */}
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-bold text-[var(--wui-fg)]">{folder.name}</span>
            {isParent ? (
              <span className="text-xs text-[var(--wui-fg-muted)]">{subFolderCount} folders</span>
            ) : (
              <span className="text-xs text-[var(--wui-fg-muted)]">{total} workflows</span>
            )}
          </div>

          {!isParent && (
            <>
              {/* Active rate bar */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--wui-fg-muted)]">Active rate</span>
                  <span className="font-semibold text-[var(--wui-primary)]">{fillPct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--wui-border)]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${fillPct}%`, backgroundColor: barColor }}
                  />
                </div>
              </div>

              {/* Status dots */}
              <div className="flex items-center gap-4 text-xs text-[var(--wui-fg-muted)]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--wui-status-completed)]" />
                  <span className="font-medium text-[var(--wui-fg)]">{active}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--wui-status-failed)]" />
                  <span className="font-medium text-[var(--wui-fg)]">{stopped}</span>
                </span>
                <span className="text-[var(--wui-fg-muted)]">
                  {active} active · {stopped} stopped
                </span>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-auto flex justify-end border-t border-[var(--wui-border)] px-4 py-2.5">
          <span className="text-xs font-medium text-[var(--wui-primary)] transition-opacity group-hover:opacity-80">
            {isParent ? 'View folders →' : 'View workflows →'}
          </span>
        </div>
      </div>
    </button>
  );
}
