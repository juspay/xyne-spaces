import { useState, type ReactElement, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CANVAS_LAYOUT_SPRING,
  CHIP_EXIT,
  CHIP_FROM,
  PILL_STAGGER_S,
  chipIn,
  useCanvasEntrance,
  useEntranceDelays,
} from '@/components/flowUI/nodes/agent/create/createMotion';
import { cn } from '@/utils/classNames';

export interface CapabilityPill {
  /**
   * The same key for an item whether it is suggested or selected, so accepting a
   * suggestion restyles the pill in place instead of popping it out and back in.
   */
  key: string;
  node: ReactNode;
}

interface CapabilityPillListProps {
  pills: CapabilityPill[];
  /** The "+ Add" button. The same element whether the row is empty or not, always last. */
  add: ReactNode;
  className?: string;
}

/**
 * Profile-layout pill row on the create canvas. Pills the chat (or the user)
 * adds pop in one after another; the rest, and the trailing "+ Add", slide to
 * make room. In a row that is itself arriving, the pills follow the row in, left
 * to right. Pills already there when the canvas loads stay put.
 */
export function CapabilityPillList({
  pills,
  add,
  className,
}: CapabilityPillListProps): ReactElement {
  const seen = new Set<string>();
  const unique = pills.filter(pill => {
    if (seen.has(pill.key)) return false;
    seen.add(pill.key);
    return true;
  });

  const entrance = useCanvasEntrance();
  // Read once: a list that mounts after the canvas has loaded (a row the chat just
  // filled) animates its first pills; one that loaded with the canvas doesn't.
  const [animateFirst] = useState(entrance.live);
  const delay = useEntranceDelays(animateFirst, PILL_STAGGER_S);
  const rowDelay = entrance.rowDelay;
  // Pills in an arriving row follow the row in, one step apart.
  const afterRow = (step: number): (() => number) | undefined =>
    rowDelay === null ? undefined : (): number => rowDelay + step * PILL_STAGGER_S;

  return (
    <div className={cn('relative flex flex-wrap items-center gap-2', className)}>
      <AnimatePresence initial={animateFirst} mode='popLayout'>
        {unique.map((pill, index) => (
          <motion.span
            key={pill.key}
            layout='position'
            className='inline-flex'
            initial={CHIP_FROM}
            animate={chipIn(delay(pill.key, afterRow(index + 1)))}
            exit={CHIP_EXIT}
            transition={{ layout: CANVAS_LAYOUT_SPRING }}
          >
            {pill.node}
          </motion.span>
        ))}
        <motion.span
          key='__add'
          layout='position'
          className='inline-flex self-center'
          initial={CHIP_FROM}
          animate={chipIn(delay('__add', afterRow(unique.length + 1)))}
          exit={CHIP_EXIT}
          transition={{ layout: CANVAS_LAYOUT_SPRING }}
        >
          {add}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
