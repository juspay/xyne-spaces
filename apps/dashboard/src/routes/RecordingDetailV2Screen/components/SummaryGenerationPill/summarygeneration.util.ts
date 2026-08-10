import {
  animate,
  type AnimationPlaybackControls,
  type MotionValue,
  type Transition,
  type ValueAnimationTransition,
} from 'framer-motion';

const PROGRESS_STOPS = [
  [0, 0],
  [0.4, 12],
  [1.5, 26],
  [4, 40],
  [10, 55],
  [22, 68],
  [45, 79],
  [80, 87],
  [130, 93],
  [180, 96],
] as const;

const PROGRESS_DURATION_SECONDS = 180;

export const INITIAL_PROGRESS_WIDTH = '0%';

export const buildFadeTransition = (shouldReduceMotion: boolean): Transition =>
  shouldReduceMotion ? { duration: 0 } : { duration: 0.25 };

/** Slightly longer than the cross-fade, so the box settles just after the content does. */
export const buildLayoutTransition = (shouldReduceMotion: boolean): Transition =>
  shouldReduceMotion ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] };

/** Stage lines share one grid cell: past lines sit above, upcoming ones below. */
export const getStageOffset = (
  index: number,
  stageIndex: number,
  shouldReduceMotion: boolean,
): number => {
  if (shouldReduceMotion || index === stageIndex) return 0;
  return index < stageIndex ? -4 : 4;
};

export const getPlaceholderGroupAnimate = (
  shouldReduceMotion: boolean,
): { opacity: number | number[] } =>
  shouldReduceMotion ? { opacity: 1 } : { opacity: [0.35, 1, 1, 0.35] };

export const getPlaceholderGroupTransition = (
  shouldReduceMotion: boolean,
  groupIndex: number,
): Transition =>
  shouldReduceMotion
    ? { duration: 0 }
    : {
        duration: 1.9,
        times: [0, 0.3, 0.72, 1],
        delay: groupIndex * 0.28,
        repeat: Infinity,
        repeatDelay: 0.9,
        ease: 'easeInOut',
      };

/**
 * Front-loaded so the bar moves immediately, then creeps.
 */
export const animateSummaryProgress = (
  progressWidth: MotionValue<string>,
): AnimationPlaybackControls => {
  const transition: ValueAnimationTransition<string> = {
    duration: PROGRESS_DURATION_SECONDS,
    times: PROGRESS_STOPS.map(([seconds]) => seconds / PROGRESS_DURATION_SECONDS),
    ease: 'linear',
  };

  progressWidth.set(INITIAL_PROGRESS_WIDTH);

  return animate(
    progressWidth,
    PROGRESS_STOPS.map(([, percent]) => `${percent}%`),
    transition,
  );
};
