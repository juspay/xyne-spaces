import { cloneElement, useRef, type ReactElement, type ReactNode } from 'react';
import { HoverCard } from '../ui/HoverCard';
import { Tooltip } from '../ui/Tooltip/Tooltip';

export const QUICK_NAV_ROW_CLASS =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm leading-5 text-foreground no-underline transition-colors hover:bg-accent hover:text-accent-foreground';

const OPEN_GUARD_MS = 600;

export const QuickNavList = ({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}): ReactElement => (
  <div className='flex w-full flex-col gap-0.5'>
    <span className='px-2.5 pb-1 pt-1 text-xs font-medium text-muted-foreground'>{heading}</span>
    {children}
  </div>
);

export const RailQuickNavEntry = ({
  trigger,
  menu,
  tooltip,
  showQuickMenu,
  open,
  onOpenChange,
}: {
  trigger: ReactElement<{ onPointerDown?: (event: React.PointerEvent) => void }>;
  menu: ReactNode;
  tooltip: ReactNode;
  showQuickMenu: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement => {
  const ignoreOpenUntil = useRef(0);

  if (!showQuickMenu) {
    return (
      <Tooltip content={tooltip} side='right' delayDuration={0}>
        {trigger}
      </Tooltip>
    );
  }

  return (
    <HoverCard
      open={open}
      onOpenChange={next => {
        if (next && performance.now() < ignoreOpenUntil.current) return;
        onOpenChange(next);
      }}
      side='right'
      align='start'
      sideOffset={8}
      openDelay={200}
      closeDelay={120}
      className='w-56 rounded-xl p-1.5'
      trigger={cloneElement(trigger, {
        onPointerDown: event => {
          ignoreOpenUntil.current = performance.now() + OPEN_GUARD_MS;
          onOpenChange(false);
          trigger.props.onPointerDown?.(event);
        },
      })}
    >
      {menu}
    </HoverCard>
  );
};
