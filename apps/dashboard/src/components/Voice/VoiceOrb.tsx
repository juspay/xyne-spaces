import { useEffect, useRef, type ReactElement } from 'react';
import { cn } from '../../utils/classNames';
import { voiceLevel } from './voiceLevel';
import type { VoicePhase } from './voiceSession';

interface VoiceOrbProps {
  phase: VoicePhase;
  className?: string;
}

// Styles: `.voice-orb` in global.css. The mic level swells it through a CSS variable.
export function VoiceOrb({ phase, className }: VoiceOrbProps): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const apply = (level: number): void => {
      node.style.setProperty('--voice-level', level.toFixed(3));
    };
    apply(voiceLevel.get());
    return voiceLevel.subscribe(apply);
  }, []);

  return <span ref={ref} className={cn('voice-orb', className)} data-phase={phase} aria-hidden />;
}
