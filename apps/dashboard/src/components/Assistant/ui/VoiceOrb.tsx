import { useEffect, useRef, type ReactElement } from 'react';
import type { AssistantPhase } from '../transcript';
import type { VoiceLevelStore } from '../audio/levelStore';
import { cn } from '../../../utils/classNames';

/**
 * State-aware voice orb (styles: `.voice-guide-orb` in global.css). With a `levelStore` it
 * swells with the speaker's voice; the level is written straight to a CSS variable so the
 * meter's ticks never re-render React.
 */
export function VoiceOrb({
  phase,
  active,
  stage = false,
  levelStore,
  className,
}: {
  phase: AssistantPhase;
  active: boolean;
  /** The large centrepiece of the voice view. */
  stage?: boolean;
  levelStore?: VoiceLevelStore | undefined;
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!levelStore || !node) return undefined;
    const apply = (level: number): void => {
      node.style.setProperty('--voice-level', level.toFixed(3));
    };
    apply(levelStore.get());
    const unsubscribe = levelStore.subscribe(apply);
    return (): void => {
      unsubscribe();
      node.style.removeProperty('--voice-level');
    };
  }, [levelStore]);

  return (
    <span
      ref={ref}
      className={cn('voice-guide-orb', stage && 'voice-guide-orb--stage', className)}
      data-phase={phase}
      data-active={active}
      aria-hidden='true'
    />
  );
}
