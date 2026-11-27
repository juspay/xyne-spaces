import type { DependencyBadgeProps } from './Dependencies.types';
import { dependencyIcon, dependencyTone } from './Dependencies.utils';

export function DependencyBadge({ state, compact = false }: DependencyBadgeProps) {
  const count = state.blockedBy.length;
  if (!state.primary && !state.blocking.length) return null;
  return (
    <span className='inline-flex max-w-full items-center gap-1'>
      {state.primary && (
        <span
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${compact ? 'text-[10px]' : 'text-xs'} ${dependencyTone(state.primary)}`}
        >
          <span aria-hidden='true'>{dependencyIcon(state.primary)}</span>
          {state.primary}
          {state.primary === 'Blocked' || state.primary === 'Gated later' ? ` · ${count}` : ''}
          {state.primary === 'At risk' && state.atRiskDays ? ` · ${state.atRiskDays}d` : ''}
        </span>
      )}
      {state.blocking.length > 0 && (
        <span className='whitespace-nowrap text-xs text-muted-foreground'>
          ↗ Blocking {state.blocking.length}
        </span>
      )}
    </span>
  );
}
