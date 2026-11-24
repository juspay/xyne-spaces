import {
  ReduceMotion,
  withTiming,
  type EntryExitAnimationFunction,
  type WithTimingConfig,
} from 'react-native-reanimated';

type FadeScaleOptions = Readonly<{
  enterMs: number;
  exitMs: number;
  /** The scale it grows from on enter and shrinks back to on exit. */
  scale: number;
  /** How far below its place it starts and ends; omitted, it does not move. */
  offsetY?: number;
  /** Omitted, `withTiming`'s own default easing. */
  enterEasing?: WithTimingConfig['easing'];
  exitEasing?: WithTimingConfig['easing'];
}>;

function timing(duration: number, easing: WithTimingConfig['easing']): WithTimingConfig {
  // Leave `easing` out rather than undefined, which `withTiming` would take over its default.
  return easing
    ? { duration, easing, reduceMotion: ReduceMotion.System }
    : { duration, reduceMotion: ReduceMotion.System };
}

/**
 * A layout transition that fades and grows a view in, then fades and shrinks
 * it away, optionally rising into place. Create it once at module scope.
 */
export function fadeScaleTransition({
  enterMs,
  exitMs,
  scale,
  offsetY,
  enterEasing,
  exitEasing,
}: FadeScaleOptions): {
  entering: EntryExitAnimationFunction;
  exiting: EntryExitAnimationFunction;
} {
  const enter = timing(enterMs, enterEasing);
  const exit = timing(exitMs, exitEasing);
  const moves = offsetY !== undefined;
  const offset = offsetY ?? 0;

  const entering: EntryExitAnimationFunction = () => {
    'worklet';
    return {
      initialValues: {
        opacity: 0,
        transform: moves ? [{ translateY: offset }, { scale }] : [{ scale }],
      },
      animations: {
        opacity: withTiming(1, enter),
        transform: moves
          ? [{ translateY: withTiming(0, enter) }, { scale: withTiming(1, enter) }]
          : [{ scale: withTiming(1, enter) }],
      },
    };
  };

  const exiting: EntryExitAnimationFunction = () => {
    'worklet';
    return {
      initialValues: {
        opacity: 1,
        transform: moves ? [{ translateY: 0 }, { scale: 1 }] : [{ scale: 1 }],
      },
      animations: {
        opacity: withTiming(0, exit),
        transform: moves
          ? [{ translateY: withTiming(offset, exit) }, { scale: withTiming(scale, exit) }]
          : [{ scale: withTiming(scale, exit) }],
      },
    };
  };

  return { entering, exiting };
}
