import { cn } from '../../../../utils/classNames';
import type { DiffMark, ResolvedDiffMark } from './DiffHighlight';

const LABELS: Record<DiffMark, string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  moved: 'Moved',
};

export function DiffBadge({ diff }: { diff: ResolvedDiffMark }): React.ReactElement {
  return (
    <span
      className={cn(
        'self-start rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        diff.tone === 'old'
          ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400'
          : 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400',
      )}
    >
      {LABELS[diff.mark]}
    </span>
  );
}
