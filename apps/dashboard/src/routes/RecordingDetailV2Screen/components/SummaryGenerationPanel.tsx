import type { ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Spinner } from '@xyne/icons';
import { Button } from '../../../components/ui/Button/Button';
import XyneAIStar from '../../../components/icons/xyne-ai/XyneAIStar';

export interface SummaryGenerationPanelProps {
  isAwaiting: boolean;
  canGenerate: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
}

interface PlaceholderGroup {
  label: string;
  /** Leading dot, matching the summary's own section markers. Omitted for the recap. */
  dotClassName?: string;
  /** One class per line, sized to look like prose rather than a uniform block. */
  lineClassNames: ReadonlyArray<string>;
}

const PLACEHOLDER_GROUPS: ReadonlyArray<PlaceholderGroup> = [
  {
    label: 'Recap',
    lineClassNames: ['w-[92%]', 'w-[86%]', 'w-[94%]', 'w-[78%]', 'w-[52%]'],
  },
  {
    label: 'Decisions',
    dotClassName: 'bg-amber-400',
    lineClassNames: ['w-[88%]', 'w-[73%]', 'w-[84%]', 'w-[46%]'],
  },
  {
    label: 'Action items',
    dotClassName: 'bg-orange-400',
    lineClassNames: ['w-[90%]', 'w-[76%]', 'w-[82%]', 'w-[44%]'],
  },
];

/**
 * The groups pulse in sequence on a loop rather than arriving once, so the panel keeps
 * signalling that work is still happening however long the summary takes.
 *
 * Each group runs the same keyframe timeline offset by its own `delay`; because every
 * cycle is the same length, that offset holds for every repeat and the wave stays in
 * order. The timeline starts and ends on the same opacity so the loop point is
 * seamless — a keyframe list that ended anywhere else would snap back on repeat.
 */
const GROUP_STAGGER_S = 0.28;
const GROUP_CYCLE_S = 1.9;
/** The beat between one full sweep and the next. */
const GROUP_REPEAT_DELAY_S = 0.9;
/** Groups dim rather than vanish between sweeps; a full fade out reads as a glitch. */
const GROUP_REST_OPACITY = 0.35;

export const SummaryGenerationPanel = ({
  isAwaiting,
  canGenerate,
  isGenerating,
  onGenerate,
}: SummaryGenerationPanelProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();

  const fadeTransition = shouldReduceMotion ? { duration: 0 } : { duration: 0.25 };

  return (
    <div className='mt-4 flex flex-col gap-8'>
      <div className='flex w-full items-center justify-between gap-4 rounded-xl border border-border/70 bg-card px-5 py-4'>
        <div className='flex min-w-0 gap-3'>
          <span className='mt-0.5 shrink-0' aria-hidden='true'>
            <XyneAIStar size={14} />
          </span>
          <div className='grid min-w-0 flex-1'>
            <motion.div
              animate={{ opacity: isAwaiting ? 0 : 1 }}
              transition={fadeTransition}
              className='[grid-area:1/1] min-w-0'
              aria-hidden={isAwaiting}
            >
              <p className='text-sm font-medium text-foreground'>
                This recording hasn&rsquo;t been summarized yet
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {canGenerate
                  ? 'Transcript’s ready. Oats takes up to 2 minutes to write the recap, decisions and action items — often less.'
                  : 'A summary needs a transcript. This recording doesn’t have one yet.'}
              </p>
            </motion.div>
            <motion.div
              animate={{ opacity: isAwaiting ? 1 : 0 }}
              transition={fadeTransition}
              className='[grid-area:1/1] min-w-0'
              aria-hidden={!isAwaiting}
            >
              <p className='text-sm font-medium text-foreground'>Writing your summary…</p>
              <p className='mt-1 text-sm text-muted-foreground'>
                The recap, decisions and action items land here as soon as Oats is done.
              </p>
            </motion.div>
          </div>
        </div>

        {isAwaiting ? (
          <span
            className='flex size-8 shrink-0 items-center justify-center text-muted-foreground'
            role='status'
            aria-label='Generating summary'
          >
            <Spinner size={16} className='animate-spin' />
          </span>
        ) : (
          <Button
            type='button'
            size='sm'
            onClick={onGenerate}
            disabled={!canGenerate || isGenerating}
            className='h-8 shrink-0 gap-2 rounded-xl px-3 text-xs font-medium bg-foreground'
            data-track-category='RecordingDetailV2'
            data-track-name='generate_summary'
          >
            {isGenerating ? (
              <Spinner size={14} className='animate-spin' />
            ) : (
              <XyneAIStar size={12} />
            )}
            Generate summary
          </Button>
        )}
      </div>

      {/* Nothing stands in for the summary until it has actually been asked for. */}
      <AnimatePresence>
        {isAwaiting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fadeTransition}
            className='flex flex-col gap-7'
            aria-hidden='true'
          >
            {PLACEHOLDER_GROUPS.map((group, groupIndex) => (
              <motion.div
                key={group.label}
                className='flex flex-col gap-3'
                animate={
                  shouldReduceMotion
                    ? { opacity: 1 }
                    : { opacity: [GROUP_REST_OPACITY, 1, 1, GROUP_REST_OPACITY] }
                }
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : {
                        duration: GROUP_CYCLE_S,
                        times: [0, 0.3, 0.72, 1],
                        delay: groupIndex * GROUP_STAGGER_S,
                        repeat: Infinity,
                        repeatDelay: GROUP_REPEAT_DELAY_S,
                        ease: 'easeInOut',
                      }
                }
              >
                <div className='flex items-center gap-2'>
                  {group.dotClassName && (
                    <span className={`size-1.5 rounded-full ${group.dotClassName}`} />
                  )}
                  <span className='text-xs font-medium uppercase tracking-wider text-muted-foreground/70'>
                    {group.label}
                  </span>
                </div>
                <div className='flex flex-col gap-2.5'>
                  {group.lineClassNames.map((lineClassName, index) => (
                    <div key={index} className={`h-2.5 rounded-full bg-muted ${lineClassName}`} />
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SummaryGenerationPanel;
