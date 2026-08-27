import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { AlertCircle, Spinner } from '@xyne/icons';
import { Button } from '../../../../components/ui/Button/Button';
import XyneAIStar from '../../../../components/icons/xyne-ai/XyneAIStar';
import { cn } from '../../../../utils/classNames';
import {
  INITIAL_PROGRESS_WIDTH,
  animateSummaryProgress,
  buildFadeTransition,
  buildLayoutTransition,
  getPlaceholderGroupAnimate,
  getPlaceholderGroupTransition,
  getStageOffset,
} from './summarygeneration.util';

export interface SummaryGenerationPanelProps {
  isAwaiting: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  onRetry: () => void;
  hasFailed?: boolean;
  onReadTranscript?: (() => void) | undefined;
  generationRunId?: number;
  initialProgress?: number;
  initialStageIndex?: number;
  onProgressPause?: (progress: number, stageIndex: number) => void;
  /** The word the copy uses for what is being summarized: 'recording' or 'call'. */
  summarySubject?: string;
  /** Analytics namespace of the host screen. */
  trackCategory?: string;
}

/** A status line shown while Scribe works, swapped in once `atMs` has elapsed. */
interface GenerationStage {
  label: string;
  atMs: number;
}

/** One skeleton block standing in for a section of the summary being written. */
interface PlaceholderGroup {
  label: string;
  dotClassName?: string;
  lineClassNames: ReadonlyArray<string>;
}

const GENERATION_STAGES: ReadonlyArray<GenerationStage> = [
  { label: 'Reading through the transcript…', atMs: 0 },
  { label: 'Generating summary…', atMs: 9_000 },
  { label: 'Pulling out decisions & action items…', atMs: 24_000 },
];

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

export const SummaryGenerationPanel = ({
  isAwaiting,
  canGenerate,
  onGenerate,
  onRetry,
  hasFailed = false,
  onReadTranscript,
  generationRunId = 0,
  initialProgress = 0,
  initialStageIndex = 0,
  onProgressPause,
  summarySubject = 'recording',
  trackCategory = 'RecordingDetailV2',
}: SummaryGenerationPanelProps): ReactElement => {
  // —— State and hooks ———
  const shouldReduceMotion = useReducedMotion() ?? false;
  const clampedInitialStageIndex = Math.min(
    Math.max(0, initialStageIndex),
    GENERATION_STAGES.length - 1,
  );
  const [stageIndex, setStageIndex] = useState(clampedInitialStageIndex);
  const stageIndexRef = useRef(clampedInitialStageIndex);
  const progressWidth = useMotionValue(INITIAL_PROGRESS_WIDTH);

  useEffect(() => {
    stageIndexRef.current = stageIndex;
  }, [stageIndex]);

  useEffect(() => {
    setStageIndex(clampedInitialStageIndex);
    if (!isAwaiting) return;
    const baseMs = GENERATION_STAGES[clampedInitialStageIndex]?.atMs ?? 0;
    const timers = GENERATION_STAGES.map((stage, index) => ({ stage, index }))
      .filter(({ index }) => index > clampedInitialStageIndex)
      .map(({ stage, index }) =>
        window.setTimeout(() => setStageIndex(index), Math.max(0, stage.atMs - baseMs)),
      );
    return (): void => {
      timers.forEach(window.clearTimeout);
    };
  }, [isAwaiting, generationRunId]);

  useLayoutEffect(() => {
    if (!isAwaiting) return;
    const controls = animateSummaryProgress(progressWidth, initialProgress);
    return (): void => {
      controls.stop();
    };
  }, [initialProgress, isAwaiting, generationRunId, progressWidth]);

  // Saves the current loading-bar percentage and stage label before the panel
  // stops or disappears, so a remount resumes both in sync instead of just the bar.
  useEffect((): (() => void) | undefined => {
    if (!isAwaiting || !onProgressPause) return undefined;
    return (): void => {
      const progress = Number.parseFloat(progressWidth.get());
      if (Number.isFinite(progress)) {
        onProgressPause(progress, stageIndexRef.current);
      }
    };
  }, [isAwaiting, onProgressPause, progressWidth]);

  // —— Derived values ———
  const fadeTransition = buildFadeTransition(shouldReduceMotion);
  const layoutTransition = buildLayoutTransition(shouldReduceMotion);
  const showFailed = hasFailed && !isAwaiting;
  const showIdle = !isAwaiting && !hasFailed;

  // —— Render ———
  return (
    <div className='mt-4 flex flex-col gap-8'>
      <motion.div
        layout
        transition={layoutTransition}
        className={cn(
          'w-full overflow-hidden border',
          hasFailed
            ? 'rounded-[11px] border-destructive/[0.22] bg-destructive/[0.055]'
            : 'rounded-xl border-border/70 bg-card',
        )}
      >
        <AnimatePresence initial={false} mode='popLayout'>
          {showFailed && (
            <motion.div
              key='failed'
              layout='position'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fadeTransition}
              className='flex w-full gap-2 px-3 py-3'
              role='alert'
            >
              <span className='mt-px shrink-0 text-destructive' aria-hidden='true'>
                <AlertCircle size={17} strokeWidth={1.8} />
              </span>
              <div className='min-w-0 flex-1'>
                <p className='font-semibold text-foreground'>Something went wrong</p>
                <p className='mt-1 text-pretty text-sm text-muted-foreground'>
                  Scribe couldn&rsquo;t generate a summary for this {summarySubject}. Your notes and
                  transcript are untouched.
                </p>
                <div className='mt-3 flex flex-wrap items-center gap-2.5'>
                  <Button
                    variant='default'
                    size={null}
                    onClick={onRetry}
                    disabled={!canGenerate}
                    className='shrink-0 gap-1.5 bg-foreground py-2 px-3 text-sm rounded-xl font-medium text-background transition-opacity duration-150 hover:bg-foreground hover:opacity-90'
                    data-track-category={trackCategory}
                    data-track-name='retry_summary'
                  >
                    <XyneAIStar size={12} />
                    Try again
                  </Button>
                  {onReadTranscript && (
                    <Button
                      type='button'
                      size={null}
                      variant='outline'
                      onClick={onReadTranscript}
                      className='shrink-0 rounded-xl border-border bg-background px-3 py-2 text-sm font-semibold text-foreground shadow-none transition-[border-color,color] duration-150 hover:bg-background hover:text-foreground'
                      data-track-category={trackCategory}
                      data-track-name='read_transcript_after_summary_failure'
                    >
                      Read the transcript
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {showIdle && (
            <motion.div
              key='idle'
              layout='position'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fadeTransition}
              className='flex w-full items-center justify-between gap-4 px-5 py-4'
            >
              <div className='flex min-w-0 gap-3'>
                <span className='mt-0.5 shrink-0' aria-hidden='true'>
                  <XyneAIStar size={12} />
                </span>
                <div className='min-w-0'>
                  <p className='text-sm font-medium text-foreground'>
                    This {summarySubject} hasn&rsquo;t been summarized yet
                  </p>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    {canGenerate
                      ? 'Transcript ready. Scribe takes up to 2 minutes to write the recap, decisions and action items — often less.'
                      : `A summary needs a transcript. This ${summarySubject} doesn’t have one yet.`}
                  </p>
                </div>
              </div>
              <Button
                variant='default'
                size='sm'
                onClick={onGenerate}
                disabled={!canGenerate}
                className='h-8 shrink-0 gap-2 rounded-xl px-3 text-xs font-medium bg-foreground text-background hover:bg-foreground/80 hover:text-background disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed'
                data-track-category={trackCategory}
                data-track-name='generate_summary'
              >
                <XyneAIStar size={12} />
                Generate summary
              </Button>
            </motion.div>
          )}

          {isAwaiting && (
            <motion.div
              key='awaiting'
              layout='position'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fadeTransition}
              className='flex w-full flex-col justify-center gap-2.5 px-5 py-3.5'
            >
              <div className='flex min-w-0 items-center gap-3'>
                <Spinner strokeWidth={2} size={16} className='animate-spin text-primary' />
                <span className='grid min-w-0 flex-1' aria-live='polite'>
                  {GENERATION_STAGES.map((stage, index) => (
                    <motion.span
                      key={stage.label}
                      className='[grid-area:1/1] truncate text-sm font-medium text-foreground'
                      animate={{
                        opacity: index === stageIndex ? 1 : 0,
                        y: getStageOffset(index, stageIndex, shouldReduceMotion),
                      }}
                      transition={fadeTransition}
                      aria-hidden={index !== stageIndex}
                    >
                      {stage.label}
                    </motion.span>
                  ))}
                </span>
              </div>

              <div className='h-1.5 w-full overflow-hidden rounded-full bg-muted'>
                <motion.div
                  className='h-full rounded-full bg-gradient-to-r from-primary/70 to-primary'
                  style={{ width: progressWidth }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

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
                animate={getPlaceholderGroupAnimate(shouldReduceMotion)}
                transition={getPlaceholderGroupTransition(shouldReduceMotion, groupIndex)}
              >
                <div className='flex items-center gap-2'>
                  {group.dotClassName && (
                    <span className={cn('size-1.5 rounded-full', group.dotClassName)} />
                  )}
                  <span className='text-xs font-medium uppercase tracking-wider text-muted-foreground/70'>
                    {group.label}
                  </span>
                </div>
                <div className='flex flex-col gap-2.5'>
                  {group.lineClassNames.map((lineClassName, index) => (
                    <div key={index} className={cn('h-2.5 rounded-full bg-muted', lineClassName)} />
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
