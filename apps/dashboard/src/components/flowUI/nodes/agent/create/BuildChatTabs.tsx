import type { ReactElement } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/utils/classNames';

export type CreateSideTab = 'build' | 'chat';

interface BuildChatTabsProps {
  tab: CreateSideTab;
  onTabChange: (tab: CreateSideTab) => void;
  /** Drop the shared-layout pill while the side card width is dragging. */
  suspendLayout?: boolean;
}

const TABS = [
  { id: 'build', label: 'Build', width: 'w-[55px]' },
  { id: 'chat', label: 'Chat', width: 'w-[52px]' },
] as const;

/** Figma 1931:27010 — track 107×32 at x=12 y=12. Spring stays inside that track. */
const PILL_SPRING = { type: 'spring' as const, duration: 0.24, bounce: 0 };

const PILL_CLASS =
  'absolute inset-0 rounded-[12px] border border-border bg-background';

export function BuildChatTabs({
  tab,
  onTabChange,
  suspendLayout = false,
}: BuildChatTabsProps): ReactElement {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className='absolute left-3 top-3 z-10 inline-flex h-8 w-[107px] items-center overflow-hidden rounded-[12px] bg-muted'
      style={{ position: 'absolute', top: 12, left: 12 }}
      role='tablist'
      aria-label='Agent builder'
      data-component='BuildChatTabs'
    >
      {TABS.map(({ id, label, width }) => {
        const selected = tab === id;
        return (
          <button
            key={id}
            type='button'
            role='tab'
            aria-selected={selected}
            onClick={() => onTabChange(id)}
            className={cn(
              'relative inline-flex h-8 items-center justify-center text-[14px] font-[450] leading-[1.3] tracking-[-0.1px]',
              width,
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            data-track-category='Claw Agents'
            data-track-name={`Create agent: ${id} tab`}
            data-testid={`create-tab-${id}`}
          >
            {selected ? (
              suspendLayout ? (
                <span className={PILL_CLASS} aria-hidden />
              ) : (
                <motion.span
                  layoutId='create-agent-tab-pill'
                  className={PILL_CLASS}
                  transition={reduceMotion ? { duration: 0 } : PILL_SPRING}
                  aria-hidden
                />
              )
            ) : null}
            <span className='relative'>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
