import { useEffect, useRef, useState, type ReactElement } from 'react';

// Braille spinner — the small `.:` style loader that sits next to the
// "Reasoning" label in the xyne-search /ai chip.
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export function BrailleLoader(): ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect((): (() => void) => {
    const id = window.setInterval((): void => {
      setFrame((x): number => (x + 1) % BRAILLE_FRAMES.length);
    }, 90);
    return (): void => {
      window.clearInterval(id);
    };
  }, []);
  return (
    <span
      aria-hidden
      className='inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center font-mono text-[14px] leading-none text-foreground/70'
    >
      {BRAILLE_FRAMES[frame]}
    </span>
  );
}

// Minimum duration a phase label stays on screen before flipping to the
// next one. Below ~1s phase changes read as jitter; ~1.5s matches what
// Claude / Perplexity hold each step at.
const MIN_LABEL_DISPLAY_MS = 1500;

// Hold each label on-screen for at least MIN_LABEL_DISPLAY_MS before
// flipping to the next desired value. Coalesces rapid changes so the chip
// doesn't strobe; the most-recent desired value always wins.
export function useStableLabel(desired: string): string {
  const [display, setDisplay] = useState(desired);
  const lockedUntilRef = useRef(0);
  const pendingTimeoutRef = useRef<number | null>(null);
  const desiredRef = useRef(desired);

  useEffect((): (() => void) | undefined => {
    desiredRef.current = desired;
    if (desired === display) return;
    const now = Date.now();
    if (now >= lockedUntilRef.current) {
      setDisplay(desired);
      lockedUntilRef.current = now + MIN_LABEL_DISPLAY_MS;
      return;
    }
    if (pendingTimeoutRef.current !== null) {
      window.clearTimeout(pendingTimeoutRef.current);
    }
    const wait = lockedUntilRef.current - now;
    pendingTimeoutRef.current = window.setTimeout((): void => {
      setDisplay(desiredRef.current);
      lockedUntilRef.current = Date.now() + MIN_LABEL_DISPLAY_MS;
      pendingTimeoutRef.current = null;
    }, wait);
    return (): void => {
      // Don't cancel on re-run — the timeout owns the latest desiredRef.
    };
  }, [desired, display]);

  useEffect((): (() => void) => {
    return (): void => {
      if (pendingTimeoutRef.current !== null) {
        window.clearTimeout(pendingTimeoutRef.current);
      }
    };
  }, []);

  return display;
}

// Push-up text swap. When `text` changes we keep the previous value mounted
// for one animation cycle so old + new slide together: old translates up +
// fades out, new enters from below. `overflow-hidden` on the shell clips
// the off-stage halves.
export function AnimatedLabel({ text }: { text: string }): ReactElement {
  const [current, setCurrent] = useState(text);
  const [exiting, setExiting] = useState<string | null>(null);

  useEffect((): (() => void) | undefined => {
    if (text === current) return;
    setExiting(current);
    setCurrent(text);
    const t = window.setTimeout((): void => {
      setExiting(null);
    }, 280);
    return (): void => {
      window.clearTimeout(t);
    };
  }, [text, current]);

  return (
    <span
      className='relative inline-block overflow-hidden align-middle'
      style={{ height: '1.15em', lineHeight: '1.15' }}
    >
      {exiting !== null && (
        <span
          key={'out-' + exiting}
          className='animate-slide-up-out absolute left-0 top-0 inline-block whitespace-nowrap font-medium'
        >
          {exiting}
        </span>
      )}
      <span
        key={'in-' + current}
        className='animate-slide-up-in relative inline-block whitespace-nowrap font-medium'
      >
        {current}
      </span>
    </span>
  );
}
