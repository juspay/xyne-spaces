import type { ReactElement } from 'react';
import { BarchartDefault, ChevronDown, Circle, UserDefault } from '@xyne/icons';
import { Button } from '../../components/ui/Button/Button';
import { cn } from '../../utils/classNames';

export const COLLAPSIBLE_FILTER_IDS = ['assignee', 'priority', 'stages'] as const;
export type CollapsibleFilterId = (typeof COLLAPSIBLE_FILTER_IDS)[number];

export const COLLAPSIBLE_FILTER_META: Record<
  CollapsibleFilterId,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  assignee: { label: 'Assignee', icon: UserDefault },
  priority: { label: 'Priority', icon: BarchartDefault },
  stages: { label: 'Status', icon: Circle },
};

/** The toolbar row's `gap-2`, in pixels. */
export const TOOLBAR_GAP = 8;

/** `px-4` both sides, plus a margin so we fold one step early rather than land flush
 *  against the actions group. */
export const TOOLBAR_ROW_INSET = 32 + 16;

/**
 * Rendered both on the real bar and in the hidden measuring twin, so the fit calculation
 * uses the exact widths the triggers will occupy.
 */
export const DeskFilterTrigger = ({
  id,
  active,
  open,
  className,
  ...props
}: {
  id: CollapsibleFilterId;
  active?: boolean;
  open?: boolean;
} & React.ComponentProps<'button'>): ReactElement => {
  const { label, icon: Icon } = COLLAPSIBLE_FILTER_META[id];
  return (
    <Button
      variant='outline'
      size='sm'
      className={cn('rounded-[10px] border-border hover:bg-muted text-muted-foreground', className)}
      {...props}
    >
      <div className='flex items-center gap-1.5'>
        <Icon className='w-3 h-3 p-px font-medium' />
        <span className='font-medium'>{label}</span>
        {active && <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />}
        <ChevronDown className={cn('w-3 h-3 ml-1 transition-transform', open && 'rotate-180')} />
      </div>
    </Button>
  );
};
