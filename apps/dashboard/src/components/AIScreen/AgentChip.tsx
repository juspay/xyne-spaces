import type { ReactElement } from 'react';
import type { AccessibleClawAgent } from '../../services/clawAgentListService';
import { cn } from '../../utils/classNames';

interface AgentChipProps {
  /** The row's agent slug (from the consolidated list). */
  slug: string;
  /** Resolved agent, if still in the user's accessible list. */
  agent?: AccessibleClawAgent | undefined;
  className?: string;
}

/**
 * Subtle agent identifier for a consolidated-list row (recents + search). Shows
 * a color dot + agent name. Falls back to the raw slug when the agent is no
 * longer in the user's accessible list (deleted/renamed) so the row is never
 * blank. Callers skip rendering this for the default 'ask-ai' agent.
 */
export function AgentChip({ slug, agent, className }: AgentChipProps): ReactElement {
  const label = agent?.name ?? slug;
  return (
    <span
      className={cn(
        'inline-flex max-w-[120px] shrink-0 items-center gap-1 rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground',
        className,
      )}
      title={label}
    >
      <span
        className={cn('inline-block size-1.5 shrink-0 rounded-full', !agent?.color && 'bg-muted-foreground')}
        style={agent?.color ? { backgroundColor: agent.color } : {}}
        aria-hidden
      />
      <span className='truncate'>{label}</span>
    </span>
  );
}
